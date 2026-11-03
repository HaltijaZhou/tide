# 本地 Markdown 图片渲染修复计划

> 后续实施时使用 `test-driven-development` 和 `verification-before-completion`；本文件只记录方案，不包含实现。

**目标：** 在 tide 中打开 Markdown 文件时，正确显示相对于该文件的本地图片，并保持图片链接的原有语义。

**方案：** 以当前 Markdown 文件所在目录解析图片地址，由 Rust 为实际引用的图片提供 Tauri asset URL。Vditor 中只替换用于显示的 `img.src`，保留编辑用的 Markdown 标记；文件切换、首次保存和编辑器重渲染时重新处理图片。

**技术栈：** Tauri 2、Rust、TypeScript、Vditor 4、Vitest。

**需求来源：** 本次用户报告的 README 图片无法显示问题及其截图。

## 已确认的原因

- README 的两个图片引用是 `docs/images/...`，对应图片在磁盘上确实存在。
- `src/main.ts` 将读取到的 Markdown 内容传给 `setMarkdown` 时，没有提供当前文档路径；`src/editor.ts` 也没有将图片路径解析为磁盘路径。
- Vditor 原样生成相对 `img.src`，WebView 因此相对应用页面请求图片。构建预览中两张图片被请求为 `http://127.0.0.1:4173/docs/images/...`，解码宽度为 0；同一页面的 Vditor 内置图片正常显示。
- 当前 `dist` 不含 `docs/images`。Tauri 的 asset 协议和访问范围也尚未启用，因此不能直接把本地绝对路径交给 WebView。
- Vditor 的 IR 模式会从编辑区 DOM 重新生成 Markdown。对普通和引用式图片的 Lute 对照实验表明，只修改生成的 `img.src` 可以保留示例中的 Markdown 引用；仍需回归测试实际编辑、重渲染和保存。

## 约束与验收

- 普通图片和引用式图片均支持相对路径，包括 `./`、`../`、空格、中文和 URL 百分号编码；同时支持本地绝对路径和本地 `file:` URL。
- `http:`、`https:`、协议相对地址、`data:`、`blob:` 等现有非本地来源不交给本地路径解析器，也不改变现有渲染行为。
- 相对地址中的原始 `?`、`#` 作为 URL 的查询和片段；文件名中的 `%3F`、`%23` 解码为文件名字符，避免混淆或重复解码。
- 新建未保存文档没有相对路径基准；首次成功保存后立即用新路径刷新图片。缺失、无权限或格式不支持的图片保留原有替代文字，其他内容仍可编辑保存。
- 图片显示 URL 不得写入 Markdown。以 Vditor 未修改图片显示地址时的序列化结果为基准；Vditor 本身已有的空格和百分号编码规范化不属于本次新增变更。
- 不配置全磁盘静态访问范围。运行时按引用的图片文件授权；Tauri 的动态授权在本次应用进程内有效，进程结束后消失。

## 重点回归场景

1. 两个不同目录中的 Markdown 使用相同的相对图片名：切换文档后必须显示各自的图片，旧异步结果不能覆盖新文档。
2. 图片链接在编辑、撤销、重做或引用定义变更后重渲染：显示地址应跟随变化，保存仍使用原始 Markdown 链接。
3. 中文、空格、`../`、`%23` 与带查询或片段的图片地址：解析到正确文件，URL 不重复解码。
4. 图片不存在、无读取权限或正在加载时切换文件：不阻塞编辑、保存、文件监视或退出。
5. 远程图片、已有 data/blob 地址和无文件路径的新文档：不错误调用本地文件解析，不改变现有行为。

## 文件与职责

- 修改 `src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`：启用 `protocol-asset`，开启 asset 协议并保留空的静态 scope。
- 新建 `src-tauri/src/local_images.rs`：解析图片文件路径、为图片文件单独授权，并生成 WebView 可访问的 URL；在同一模块编写 Rust 单元测试。
- 修改 `src-tauri/src/lib.rs`：注册图片解析命令。
- 新建 `src/images.ts`、`src/images.test.ts`：识别本地图片并维护图片显示地址，处理重渲染及异步结果失效。
- 修改 `src/editor.ts`、`src/main.ts`：关联编辑器和当前文档路径，并覆盖打开、切换、首次成功保存和外部重载。
- 修改 `src/editor.test.ts`、`src/main.test.ts`，并新增 `tests/local-image-roundtrip.test.js`：覆盖会话路径衔接及真实 Lute 的 Markdown 往返。

### 任务 1：解析并授权单张本地图片

**接口：**

- `resolve_image_path(document_path: &Path, source: &str) -> Result<PathBuf, String>`：依据文档路径解析并规范化本地图片地址，不处理远程来源；URL 查询和片段由调用方分离并保留。
- `resolve_document_image(webview: tauri::WebviewWindow, document_path: String, source: String) -> Result<String, String>`：检查图片、对该文件调用 `asset_protocol_scope().allow_file(...)`，通过 `webview.convert_file_src(..., None)` 返回 URL，并附回原查询和片段。

- [x] 为 `resolve_image_path` 增加先失败的 Rust 测试：同目录/子目录、`../`、空格与中文、百分号编码、`%23`、绝对路径、本地 `file:` URL、无效或缺失文件。使用 `tempfile` 创建真实文件并比较规范化路径。
- [x] 实现解析和命令；Windows 路径使用 Tauri 的 `convert_file_src` 处理，避免自行拼接 asset URL。只授权解析到的图片文件，不授权整个目录。
- [x] 在 `src-tauri/Cargo.toml` 启用 `tauri` 的 `protocol-asset` feature；在 `tauri.conf.json` 设置 `app.security.assetProtocol` 为 `enable: true`、`scope: []`，并在 `lib.rs` 注册命令。
- [x] 运行 `cargo test --manifest-path src-tauri/Cargo.toml`，确认新增与现有 Rust 测试通过。

### 任务 2：在编辑器中显示本地图片

**接口：**

- `installLocalImageRenderer(container: HTMLElement, resolve: (documentPath: string, source: string) => Promise<string>): { setDocumentPath(path: string | null): void; refresh(): void; dispose(): void }`。
- `src/editor.ts` 对外提供 `setDocumentPath(path: string | null): void`；`src/main.ts` 在成功切换文档及新文件首次成功保存后调用。

- [x] 在 `src/images.test.ts` 用模拟解析器写先失败的测试：本地图片调用解析器并替换显示 `src`；远程/data/blob 地址和未命名文档不调用；解析失败不影响其他图片；旧文档或旧图片地址的延迟结果不覆盖新状态。
- [x] 在 `src/main.test.ts` 增加先失败的会话测试：打开 A 后切换 B 使用 B 的目录；失败的文件切换不改变 A 的目录；未命名文件首次保存成功后启用新目录；外部重载和冲突处理保持原有状态。
- [x] 在 `tests/local-image-roundtrip.test.js` 用项目自带的 Lute 对普通和引用式图片分别比较替换显示 `img.src` 前后的 `VditorIRDOM2Md` 结果，断言均保持相同的相对链接；另覆盖带标题和编码的链接。
- [x] 实现图片处理。以 Vditor 生成的图片原地址为输入，而非假设 `.vditor-ir__marker--link` 总是文件路径：引用式图片的该标记可能只是 `[demo]`。使用 `MutationObserver` 处理新建、重绘的图片和引用定义变更，避免观察自身写入造成循环，并校验异步返回时的文档版本、节点和原地址。
- [x] 在 `src/editor.ts` 安装处理器，在 `src/main.ts` 的 `openPath` 成功后、首次成功保存后更新文档路径；外部变更或选择磁盘版本重载时刷新图片。浏览器开发模式不调用 Tauri 命令。
- [x] 运行 `npm test` 和 `npm run build`，确认前端测试和构建通过。

### 任务 3：桌面端验收

- [ ] 使用 `npm run tauri dev` 启动桌面窗口，通过 Ctrl+O 打开仓库根目录的 `README.md`，确认两张截图均正常显示。
- [ ] 在两个不同目录中各准备一个含同名相对图片的 Markdown 文件，依次打开、编辑图片路径、撤销/重做；确认显示随当前文档和当前链接更新。
- [ ] 对 README 先只打开关闭，再编辑并保存副本；确认只打开不会修改文件，保存后图片链接仍为相对地址且未出现 asset URL。
- [ ] 检查新建文件首次保存、外部修改后重载、图片缺失及远程图片；确认图片问题不会改变原有文件保存、冲突提示和自动保存行为。
- [ ] 运行 `npm run tauri build`，用构建后的桌面程序再次打开 README 验证，避免开发服务器恰好能提供仓库图片而掩盖问题。
