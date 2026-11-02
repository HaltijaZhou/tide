# tide 改名与编辑区布局修复 设计文档

日期：2026-11-02
状态：已实施（待冒烟验收）
上游设计：[2026-10-30-oh-my-mark-design.md](./2026-10-30-oh-my-mark-design.md)

## 一、需求

1. **软件全面改名为 `tide`**，仓库地址同步改为 `git@github.com:zhouhaltija/tide.git`。
2. **编辑区幕布跟随窗口大小**：窗口放大后两侧不再出现底色留白，滚动条回到窗口右缘。
3. **标题标记完整显示**：IR 模式左侧的 `H1`/`H2` 标记此前被裁切，需完整可见。

## 二、改名清单

| 位置 | 原值 | 新值 | 说明 |
| --- | --- | --- | --- |
| `package.json` / `package-lock.json` | `oh-my-mark` | `tide` | npm 包名 |
| `index.html` | `<title>oh-my-mark</title>` | `<title>tide</title>` | 浏览器标题（dev 模式可见） |
| `src-tauri/tauri.conf.json` | `productName: oh-my-mark` | `tide` | 决定安装包与可执行文件名 |
| 同上 | `identifier: dev.ohmymark.app` | `dev.tide.editor` | 决定应用数据目录与注册表项。初版曾取 `dev.tide.app`，但以 `.app` 结尾与 macOS bundle 扩展名冲突（Tauri 告警），故改为 `.editor` |
| 同上 | 窗口 `title` | `tide` | 首帧标题，运行时被文件名覆盖 |
| 同上 | 文件关联 `name: ohmyMark` | `tide` | 右键「打开方式」显示名 |
| `src-tauri/Cargo.toml` | `name = "oh-my-mark"` / `oh_my_mark_lib` | `tide` / `tide_lib` | 包名与 lib 名 |
| `src-tauri/src/main.rs` | `oh_my_mark_lib::run()` | `tide_lib::run()` | 跟随 lib 名 |
| `src/main.ts` | `- oh-my-mark` / 两处对话框 `title` | `- tide` | 运行时窗口标题与原生对话框标题 |
| `src/main.test.ts` | 标题断言 | `b.md - tide` | 与实现同步 |
| `LICENSE` | `zhouyu and oh-my-mark contributors` | `tide contributors` | 版权署名 |
| `.github/workflows/release.yml` | releaseName、`oh-my-mark_*_x64-setup.exe` | `tide_*` | 发布页标题与产物名 |
| git remote | `.../Oh-My-Markdown.git` | `.../zhouhaltija/tide.git` | `git remote set-url` |

**不动的部分**：历史设计与实施文档的内容（`docs/superpowers/specs/`、`docs/superpowers/plans/` 下，仅按规范迁移位置，不改写——它们记录的是当时的执行事实，改写会让文档里的路径与代码片段失真）；本地仓库目录名 `oh-my-mark`；应用图标。

**副作用**：`identifier` 变更后，旧版留下的应用数据目录不再被读取。本项目不持久化任何配置（`cache.enable: false`），无迁移成本。

## 三、编辑区布局修复

### 3.1 现象与根因

两个现象来自同一个元素：`.vditor-reset`。

原样式 `max-width: 720px; margin: 0 auto; padding: 32px 24px 96px`。

- `.vditor-reset` 既是**幕布**（`background-color: var(--panel-background-color)`，聚焦时切 `--textarea-background-color`），又是**滚动容器**（Vditor 自带 `overflow: auto`）。用 `max-width` 居中，等于让幕布本身只有 720px 宽：窗口放大后左右露出 body 的 `#FFFFFF`，中间是 `#FAFBFC`，形成两段色差；滚动条也被顶到 720px 栏的右缘而不是窗口右缘。
- 标题标记由 Vditor 以 `float: left; margin-left: -29px` 绘制，需要内容框左侧留出 29px。原 `padding-left` 只有 24px，标记落在 padding 区外，被 `overflow: auto` 裁掉约 5px——即截图中 `H1` 左边缘被切。

### 3.2 方案

去掉 `max-width`，改用对称 `padding` 收窄正文，让幕布铺满、正文仍居中 720px：

```css
.vditor-reset {
  max-width: none !important;
  margin: 0 !important;
  padding: 32px max(52px, calc((100% - 720px) / 2)) 96px !important;
  font-size: 16px !important;
  line-height: 1.75 !important;
}
```

- 窗口够宽时左右各 `(100% - 720px) / 2`，正文恰好 720px 居中；幕布与滚动条铺满整个窗口。
- 下限 `52px = 24px 原内边距 + 29px 标记宽度`（留 1px 余量），保证窄窗口下标记仍在 padding 区内，不再被裁。
- 一处改动同时解决两个现象，不引入新的包裹元素，也不与 Vditor 内部 DOM 结构耦合。

### 3.3 备选方案

| 方案 | 取舍 |
| --- | --- |
| 去掉行宽限制，正文铺满窗口 | 大屏下一行过长，视线回扫吃力；且与上游设计「编辑区内容居中，最大行宽约 720px」冲突。已否决 |
| 外层加包裹元素承接背景，内层保留 720px | 需侵入 Vditor 内部结构（IR 的滚动元素就是 `pre.vditor-reset` 本身），升级 Vditor 时易碎 |
| 把标题标记整体隐藏（`content: none`） | 更「做减法」，但用户诉求是「显示全」而非「不要」。已否决 |

## 四、验证

- `npx tsc --noEmit` 通过。
- `npm test`：3 个测试文件、43 个用例全部通过（含改名后的标题断言）。
- 布局：无头 Chrome 1400×900 视口实测——幕布（`.vditor-reset` 背景）横跨 x=0–1400 全宽，正文列 x=340–1060 恰好 720px 居中，`H1`/`H2` 标记完整无裁切。
- 待办：`npm run tauri build` 出包，确认安装包名变为 `tide_0.1.0_x64-setup.exe`，并冒烟验证文件关联与标题。

## 五、版本号 0.1.1

改名与布局修复对外可见（窗口标题、安装包名、注册表项、编辑区排版），按语义化版本发一个 patch：
`package.json`、`package-lock.json`（两处）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 全部 `0.1.0 → 0.1.1`，
`Cargo.lock` 由 cargo 自动跟随。CI 的 `校验版本号与 tag 一致` 步骤要求这三处与 tag 对齐，发布时打 `v0.1.1`。

## 六、明确不做

- 不重命名本地仓库目录，不改应用图标。
- 不重写历史文档的内容（只按 superpowers 规范迁移目录）。
- 不调整窗口默认尺寸与最小尺寸（本次只修幕布跟随，不改窗口行为）。
