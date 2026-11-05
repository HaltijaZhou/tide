# tide 0.1.5 链接与焦点线修复实施计划

> **给执行 agent：** 用户要求本轮只写规格和计划，具体实现由另一个 agent 完成。执行时使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，先阅读规格；所有复选框从未完成开始。

**目标：** 让 Ctrl+左键及右键能正确打开网站与本地 Markdown 文件，修复编辑区底部焦点线被正文遮挡的问题，并发布 0.1.5。

**架构：** 编辑器捕获修饰键点击，复用现有链接源提取；右键与点击共用分类和打开回调。外部地址走现有 Tauri opener，本地 Markdown 交给 Rust 解析后走 `openPath`；焦点线在编辑区边缘的非滚动覆盖层上绘制。

**技术栈：** TypeScript、Vditor 4、Vitest、Tauri 2、Rust、Windows WebView2。

**规格：** `docs/superpowers/specs/2026-11-05-links-and-focus-line-design.md`

## 全局约束

- 常规点击保持编辑；Ctrl+左键（macOS 另支持 Command+左键）与右键菜单一致，单次最多打开一次。
- 外部只支持 `http:`、`https:`、`mailto:`；本地只打开真实存在的 `.md` / `.markdown` 文件。严禁默认导航或执行不安全目标。
- 相对路径基于点击时的源文档目录；未保存文档使用相对链接时提示先保存。绝对本地路径不依赖基准文档。
- 原样保留 Markdown 地址；支持 URL 中的 `?` / `#` 分隔以及文件名中的 `%3F` / `%23`，解码一次。文件后的片段本次不要求跳转；纯片段链接不在范围。
- 不破坏保存、冲突保护、监视、本地图片、右键格式化、主题、选择、滚动和无 Tauri 的开发模式。
- 不新增运行时依赖，不扩大 asset 协议授权；保留用户已有的未跟踪文件，不使用 `git add .` 或清理工作区。
- 版本号为 `0.1.5`，发布标签为 `v0.1.5`；标签和正式发布由执行 agent 在验证通过后处理。

## 重点审查场景

1. `%23` / `%3F` 在文件名中、原始 `#` / `?` 在地址后缀中：任务 1 和 2 覆盖。
2. `javascript:`、`data:`、协议相对地址、远程 `file:`、Windows 设备路径和非 Markdown 文件：任务 1 和 2 覆盖。
3. 源文档更换、重载或陷入冲突时延迟的解析 / 打开结果：任务 4 覆盖。
4. 未命名、保存失败、目标不存在或不是 UTF-8 时不得丢失当前内容：任务 2 和 4 覆盖。
5. 相同显示文字的引用式链接、嵌套节点、普通点击以及表格遮线：任务 3 和 5 覆盖。

## 文件职责与接口

- 新建 `src/links.ts`、`src/links.test.ts`：链接分类与可复用的修饰键点击安装器。
- 修改 `src/context-menu-model.ts`、`src/context-menu-model.test.ts`：对可打开的本地 Markdown 启用“打开链接”，继续禁止危险地址。
- 修改 `src/editor.ts`、`src/editor.test.ts`：安装和卸载点击处理器，继续用 `currentLinkSource` 提取目标，并把点击与菜单连接到同一回调。
- 新建 `src-tauri/src/local_paths.rs`，修改 `src-tauri/src/local_images.rs`、`src-tauri/src/lib.rs`：共用本地路径解析，注册 Markdown 解析命令，保持原图片接口和错误码。
- 修改 `src/main.ts`、`src/main.test.ts`：按目标类型分发，链接方式切换时校验源文档并复用 `openPath`。
- 修改 `src/styles/tide.css`：将焦点线从可滚动内容上移到编辑区底部覆盖层。
- 修改 `README.md`、`CHANGELOG.md`、`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`：说明功能并准备版本。

### 任务 1：统一分类与菜单能力

**接口：** 在 `src/links.ts` 导出 `LinkDestination = { kind: 'external'; target: string } | { kind: 'markdown'; target: string } | { kind: 'unsupported' }` 和 `classifyLinkDestination(value: string): LinkDestination`。`target` 保留原始字符串，不把解码后的路径写回 Markdown。

- [ ] 先在 `src/links.test.ts` 写分类测试，期望：`https://example.com/a#b`、`mailto:user@example.com` 分别得到 `external`；`docs/showcase.md`、`../中文%20笔记.MARKDOWN#heading`、`C:\notes\a.md`、`file:///C:/notes/a.md` 得到 `markdown`；`javascript:alert(1)`、`data:text/html,x`、`//server/share/a.md`、`file://server/share/a.md`、`docs/a.pdf`、`#heading` 和非法 `%GG` 得到 `unsupported`。检查 `%2E` 编码扩展名及 `%23`、`%3F` 不被当作分隔符。
- [ ] 在 `src/context-menu-model.test.ts` 先增加测试：`docs/showcase.md` 的“打开链接”可用，`javascript:`、远程 `file:` 和非 Markdown 本地路径仍不可用，“复制链接地址”仍存在。
- [ ] 如新模块尚不存在，先提供只返回 `unsupported` 的最小函数桩，让测试能执行到断言。运行 `npm test -- src/links.test.ts src/context-menu-model.test.ts`，确认新增测试因能力缺失而失败，而不是因导入或语法错误失败。
- [ ] 实现分类，正确区分 Windows 绝对盘符和 URL scheme；仅为判断扩展名解码，保留原始目标。菜单用此分类决定打开项是否可用；不改变复制项和图片菜单。
- [ ] 重跑同一命令，确认通过。将已通过的任务文件单独提交，避免混入用户未跟踪文件。

### 任务 2：解析本地 Markdown 路径

**接口：** `src-tauri/src/local_paths.rs` 提供 `resolve_markdown_path(document_path: Option<&Path>, source: &str) -> Result<PathBuf, String>`；注册 Tauri 命令 `resolve_markdown_link(document_path: Option<String>, source: String) -> Result<String, String>`。返回规范化的本地绝对路径；`document_path` 只作为相对地址的基准。错误码区分无基准、非法目标和目标不可用，以供前端提示。

- [ ] 先用 `tempfile` 在 Rust 测试中创建真实目录和文件，断言 `docs/showcase.md`、`../`、中文空格、`.MARKDOWN`、`a%23b.md#heading`、`a%3Fb.md?view=1`、本地绝对路径和本机 `file:` URL 解析到预期文件；不同源目录解析相同相对名字时得到各自文件。Windows 上文件名不能包含 `?`，该编码场景须在允许的测试平台执行或只验证候选路径的解析，而不是创建非法文件。
- [ ] 增加负例：无基准的相对路径、缺失文件、目录、非 Markdown 文件、无效百分号或 UTF-8 编码、`javascript:`、网络/设备路径及远程 `file:` 均返回错误；无基准的本地绝对 Markdown 路径仍可解析。对 Windows 盘符和设备路径使用平台条件测试。
- [ ] 添加只返回错误的最小函数桩，让测试能编译并执行。运行 `cargo test --manifest-path src-tauri/Cargo.toml`，确认新测试因路径解析能力缺失而失败。
- [ ] 提取或复用 `local_images.rs` 中的百分号校验、URL 后缀分离、本地路径/网络设备路径检查；仅解码一次，规范化并检查目标是普通 Markdown 文件。现有图片命令的公开行为、错误码、文件授权和已有测试保持不变。在 `src-tauri/src/lib.rs` 注册新命令。
- [ ] 重跑 `cargo test --manifest-path src-tauri/Cargo.toml`，确认新增及现有图片测试通过；单独提交本任务文件。

### 任务 3：在编辑器接入 Ctrl+左键

**接口：** `src/links.ts` 导出 `installLinkActivation(container: HTMLElement, source: (link: HTMLElement) => string | undefined, open: (target: string) => Promise<void> | void, reportError: (message: string) => void): () => void`。返回的函数移除监听器；`src/editor.ts` 在重新初始化时调用旧的卸载函数。

- [ ] 先写事件回归测试：Ctrl+左键点击链接内嵌套元素触发一次 `open` 并阻止原有导航；macOS Command+左键同样触发；普通左键、中键、右键、Ctrl+Shift、Ctrl+Alt 和非链接区域不触发。被识别但不支持或无法解析的目标不会被 WebView 或系统执行，并显示提示；异步打开失败会显示提示。
- [ ] 先在 `src/editor.test.ts` 测试两种入口都通过现有 `currentLinkSource` 传出原始地址，引用式链接同名但目标不同、存在脚注时仍取到各自目标；编辑器重建后旧监听器不再响应。使用现有测试中的轻量 DOM/事件替身，必要时在真实桌面端再确认事件顺序。
- [ ] 若新增安装器尚不存在，先提供一个不添加监听器的最小函数桩。运行 `npm test -- src/links.test.ts src/editor.test.ts`，确认新增测试因事件未处理而失败。
- [ ] 在捕获阶段读取 `[data-type="a"]`、`[data-type="link-ref"]` 或 `a`，只处理符合条件的左键事件；在 Vditor 改写链接节点前提取目标，用任务 1 的分类拦截不支持的目标，并阻止重复默认打开。普通点击保持 Vditor 的光标与编辑行为，同时检查 Vditor 自带的 `window.open` 不会绕过分类；不要仅靠禁用默认打开而牺牲链接编辑。菜单和点击统一调用 `onOpenLink`，捕获同步和异步错误。
- [ ] 重跑同一命令，确认通过；单独提交本任务文件。

### 任务 4：在应用中安全分发与切换文档

**接口：** `src/main.ts` 的 `onOpenLink` 统一按 `classifyLinkDestination` 分发；本地目标调用 `invoke<string>('resolve_markdown_link', { documentPath, source })`，然后使用现有 `openPath`。为 `openPath` 增加可选的源文档有效性检查，并传入现有 `session.open(path, canReplace)` 检查。

- [ ] 扩展 `src/main.test.ts` 的 Tauri 边界替身，先写失败测试：外部链接只调用 opener；本地链接按源路径调用解析命令并在当前窗口显示目标；解析失败、目标缺失和非 UTF-8 时原文、路径不变并提示错误。
- [ ] 增加先失败的竞态与保护测试：当前文档有未保存修改时先成功保存再切换；保存失败或冲突时不切换；延迟解析期间切到另一个目录、外部重载或冲突时丢弃结果；目标读取期间源文档变化也不切换。未命名文档点击相对链接得到提示；绝对链接触发首次保存后仍可正常打开目标。
- [ ] 增加先失败的无 Tauri 测试：外部链接使用浏览器打开，本地链接提示不可用，不能请求 Vite 应用页面或覆盖编辑器。
- [ ] 运行 `npm test -- src/main.test.ts`，确认新增测试失败。
- [ ] 实现分发及错误提示。开始操作时捕获 `documentVersion` 和源路径；相对地址的源路径及文档版本必须在每个异步边界仍有效。绝对链接来自未命名文档时允许同一文档首次保存产生路径，但不得允许版本变更或另一个文档替换。把检查传入 `session.open`，并在等待现有 `openPath` 的外部检查、保存等步骤后再次检查，避免过时请求抢占当前文档。
- [ ] 重跑 `npm test -- src/main.test.ts` 和 `npm test`，确认全部通过；单独提交本任务文件。

### 任务 5：修复焦点线及桌面验收

**接口：** 继续使用主题令牌 `--tide-accent` 和原有可见焦点条件；焦点覆盖层随 `#editor` 底边定位，1px 高、全宽、`pointer-events: none`，绘制在滚动正文之上，状态栏及菜单仍正常可操作。

- [ ] 改 CSS 之前，在桌面应用打开有表格、行内代码、代码块和图片的 Markdown，将它们依次滚到编辑区底边，记录焦点线被遮挡的复现截图；至少检查一次亮色及一次暗色。不要用仅断言 CSS 文本的测试替代视觉检查。
- [ ] 修改 `src/styles/tide.css`：移除滚动 `pre` 的内阴影，改在编辑区非滚动层按原 `:focus-visible` 条件绘制覆盖线；不可拦截指针或遮盖状态栏。若能使用已有浏览器测试设施，可增加以实际渲染结果为断言的回归测试。
- [ ] 再次执行同样的桌面验收：在两种主题、不同窗口宽度及表格/行内代码/代码块/图片/普通文本经过底边时线连续；失焦时恢复正常；选择文字、滚动、编辑、右键及状态栏按钮正常。比较截图并记录结果。
- [ ] 使用实际桌面应用打开 `README.md`：Ctrl+左键打开技术栈网站，右键仍可打开；Ctrl+左键及右键打开“示例文档”，返回其他文件后重复；检查引用式同名链接、缺失文件和未保存内容。确认文本及链接没有因操作被意外改写。
- [ ] 如本机无法运行桌面应用或完成上述验收，明确记录未验证项；不要把它视作通过，也不要继续正式发布。验收通过后单独提交样式改动。

### 任务 6：准备并发布 0.1.5

- [ ] 更新 `README.md` 的功能说明，以及 `CHANGELOG.md` 中 `0.1.5` 的链接打开、文件切换和焦点线修复说明。
- [ ] 将 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 中 tide 包版本和 `src-tauri/tauri.conf.json` 统一到 `0.1.5`；不要改动依赖版本。检查锁文件里 tide 包版本与仓库发布工作流的三处版本校验一致。
- [ ] 完成全部修改后、提交前运行 `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`；运行 `npm run tauri build` 并检查生成的正式版安装包。任何失败先修复再重新运行受影响的检查。
- [ ] 复核工作区，只暂存本次文件，提交全部修复及计划/规格文档。确认远端 `main` 和本地提交关系、远端不存在 `v0.1.5`，不覆盖或强推其他人的变更。将经过验证的提交按仓库惯例推送到 `main`，等待该提交的 Windows CI 成功。
- [ ] 在通过 CI 的同一提交创建并推送 `v0.1.5` 标签，触发 `.github/workflows/release.yml`；监视 Release 工作流直到完成。确认 GitHub Release 是正式版且含对应版本的 Windows NSIS `.exe` 和 MSI 安装包；失败时排查、报告，绝不通过强推覆盖已有标签。
- [ ] 最终交付说明变更、验证结果和实际 Release 链接；如果远端权限、网络、构建或手动验收受阻，明确说明未发布及具体阻塞原因，不把标签推送或工作流启动等同于发布成功。
