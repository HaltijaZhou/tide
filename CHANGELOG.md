# 更新日志

本项目的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.1.1]: https://github.com/zhouhaltija/tide/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zhouhaltija/tide/releases/tag/v0.1.0
