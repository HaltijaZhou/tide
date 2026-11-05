# 更新日志

本项目的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.4] - 2026-11-05

### 新增

- 粘贴图片时保存到 Markdown 文件旁的 `images/` 目录，并插入相对路径；未命名文档会先提示保存
- 支持多张图片及常见的图文剪贴板来源，保存失败时提示并保留可恢复的内容
- 新增「潮笺」右键菜单：选中文字时提供加粗、斜体、删除线和行内代码，段落样式与插入操作收在子菜单中
- 右键链接和图片时提供相应的打开、复制操作；菜单适配系统明暗模式、键盘操作和窗口边缘

### 修复

- 防止图片保存期间切换文档、出现冲突或关闭窗口导致图片插入错误位置或丢失修改
- 右键格式化时保护含 HTML 特殊字符的文本，避免将文字误解析为页面元素；剪贴板读取期间光标移动时不会粘贴到错误位置
- 部分无法完整读取图片数据的 Word 图文会提示使用系统粘贴，避免静默遗漏图片

## [0.1.3] - 2026-11-03

打开 Markdown 时能正常显示相对于该文件的本地图片，图片链接的原有语义保持不变。

### 新增

- 本地图片显示：`![](images/a.png)` 这类相对路径此前一律显示不出来——WebView 会把它当成
  应用页面的资源请求（构建预览里请求成 `http://127.0.0.1:4173/docs/images/...`，解码宽度为 0）。
  新增 `src-tauri/src/local_images.rs`，以当前 Markdown 文件所在目录为基准解析图片路径，
  只为实际被引用的那个文件调用 `asset_protocol_scope().allow_file`，再用 `convert_file_src`
  换成 WebView 可加载的地址。不配置全磁盘静态访问范围，授权仅在本进程内有效
- 路径覆盖 `./`、`../`、空格、中文与 URL 百分号编码，也支持本地绝对路径和本地 `file:` URL；
  URL 的 `?`、`#` 仍作为查询与片段，文件名里的 `%3F`、`%23` 解码为文件名字符，不会重复解码
- 新增 `src/images.ts`：用 `MutationObserver` 跟随 Vditor 新建和重绘的图片节点，
  异步结果按文档版本、节点和原始地址三重校验，切换文档或改动链接后迟到的旧结果不会覆盖新状态；
  引用式图片的引用定义变化时重算一次

### 变更

- 启用 Tauri `protocol-asset` feature，`app.security.assetProtocol` 打开且静态 scope 留空，
  改由运行时按引用授权；新增 `percent-encoding` 与 `url` 依赖用于解码与 `file:` URL 解析
- 只替换用于显示的 `img.src`，Markdown 原文与保存内容不变：以 Vditor 未改动图片地址时的
  序列化结果为基准，`VditorIRDOM2Md` 往返一致
- 当前文档路径随打开、切换、未命名文件首次保存成功、外部重载和「使用磁盘版本」同步更新；
  浏览器开发模式（无 Tauri 外壳）不调用该命令
- `http(s)`、协议相对地址、`data:`、`blob:` 等非本地来源不进入本地解析器，渲染行为不变

### 修复

- 相对路径的本地图片在编辑器里空白：现在按文档目录解析并显示
- 图片缺失、无权限或格式不支持时保留原有替代文字，不阻塞编辑、保存、文件监视与退出；
  一张图片解析失败不影响其他图片

### 文档

- README 增加两张软件截图，并在核心特性里补上图片显示
- 新增计划文档 `docs/superpowers/plans/2026-11-03-local-image-rendering.md`
- `docs/showcase.md` 的图片一行改为支持本地相对路径，不再是「仅 http(s) 地址」

## [0.1.2] - 2026-11-02

引入「潮间」视觉主题，并让 Markdown 中的 `<details>` 折叠块在即编即显模式下真正折叠。

### 新增

- 「潮间」纸面主题：新增语义颜色令牌 `src/styles/tokens.css` 与独立主题层 `src/styles/tide.css`，
  以纸面画布配潮青色强调（链接、光标、选区、引用线、键盘焦点），统一编辑器与状态栏。
  主题层用 `#editor` 前缀提高优先级，覆盖 Vditor 运行时才加载的明暗内容主题
- 折叠块显示：Vditor 会把跨段落的 `<details>` 拆成「HTML 块」与「正文块」两部分，
  此前只有 summary 会折叠，块外内容照常显示。新增 `src/details.ts`，按 summary 的打开状态
  隐藏或显示被拆到块外的内容，支持嵌套、未闭合与带 `open` 的折叠块；
  展开/收起只改变显示状态，不改写 Markdown 原文，也不影响保存与撤销
- `DESIGN.md`：记录设计原则、明暗配色、排版与空间、控件与状态，以及样式覆盖的实施边界

### 变更

- 代码高亮主题随系统明暗同步切换（`github` / `github-dark`）。此前只切外壳与正文主题，
  暗色模式下代码块仍是亮色
- 主题切换等到编辑器就绪后再应用；若初始化期间系统主题已变化，就绪时会补齐一次
- 冲突提示的两个按钮改为说明各自后果：「使用磁盘版本（丢弃当前修改）」「保留当前内容（覆盖磁盘版本）」
- 应用图标换成「潮汐书页」：深青圆角底 + 纸页 + 两层波浪，并补上 `src-tauri/icons/icon.svg` 源文件

### 修复

- 键盘焦点线由 2px 收窄到 1px，不再压住正文首行
- 折叠块的隐藏样式需要显式 `display: none !important`，否则盖不过 Vditor 预览节点的既有规则；
  undo 恢复的克隆节点可能带着过期的隐藏类，每次重算都会清理
- 折叠状态在 Vditor 重新渲染、切换文档、系统明暗切换后保持；切换文档时重置

### 文档

- 新增 `docs/showcase.md`：用于展示排版、代码块与折叠块的潮汐主题示例文档
- 新增计划文档 `docs/superpowers/plans/2026-11-02-paper-tide-theme.md` 与 `2026-11-02-details-folding.md`

## [0.1.1] - 2026-11-02

软件正式更名为 **tide**。

### 变更

- 全面改名为 `tide`：安装包与可执行文件名、窗口标题、原生对话框标题、文件关联显示名、MIT 版权署名、CI 发布产物名
- 应用标识符由 `dev.ohmymark.app` 改为 `dev.tide.editor`（旧的 `dev.tide.app` 以 `.app` 结尾，与 macOS 的 bundle 扩展名冲突，Tauri 会告警）
- 仓库迁移至 `github.com/zhouhaltija/tide`

### 修复

- 编辑区幕布不跟随窗口大小：放大窗口后两侧露出 body 纯白底、滚动条卡在 720px 栏的右缘。
  原因是 `.vditor-reset` 同时承担「幕布背景」与「滚动容器」两个角色，却被 `max-width: 720px` 收窄；
  改为对称 `padding` 收窄正文后，幕布与滚动条铺满窗口，正文仍 720px 居中
- IR 模式下 `H1`–`H6` 标题标记被裁切约 5px。标记由 `float: left; margin-left: -29px` 绘制，
  而左内边距只有 24px，负边距部分被 `overflow: auto` 裁掉；左内边距下限提高到 52px 后完整可见

### 文档

- 文档按 superpowers 规范迁移：设计文档 → `docs/superpowers/specs/`，实施计划 → `docs/superpowers/plans/`
- 新增 `docs/superpowers/specs/2026-11-02-tide-rename-and-layout-design.md`

## [0.1.0] - 2026-11-02

首个正式版本。

### 新增

- 单文件模型：一次只编辑一个 Markdown 文件，打开即用，没有工作区、标签页等概念
- Typora 式即编即显（Vditor IR 模式），无工具栏的极简界面
- 打开与保存：Ctrl+O / 拖拽打开，Ctrl+S 保存，未命名文档提示选择保存位置
- 双击 `.md`、右键「打开方式」、拖到图标均可直接打开（读取启动参数）
- 防抖自动保存（2s）+ 原子写入（临时文件 + rename），保存失败 5s 自动重试
- 外部变更监视：无未保存修改时静默重载，有修改时在状态栏内联提示冲突，由用户决定保留哪个版本
- 脏状态退出保护：关闭窗口前询问，防止误丢内容
- 暗色模式跟随系统
- 完全离线可用：Vditor 的 Lute 引擎、图标与主题 CSS 全部本地化，不依赖 CDN
- GitHub Actions 构建与发布流水线，产出 NSIS 与 MSI 安装包

[0.1.4]: https://github.com/HaltijaZhou/tide/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/zhouhaltija/tide/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/zhouhaltija/tide/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zhouhaltija/tide/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zhouhaltija/tide/releases/tag/v0.1.0
