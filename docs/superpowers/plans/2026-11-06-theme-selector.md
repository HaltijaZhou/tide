# 状态栏外观切换实施计划

> **For agentic workers:** Use superpowers:executing-plans task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 提供可记忆的系统、浅色、深色外观切换，并按用户指定精简正式版发布正文。

**Architecture:** 一个外观控制器统一偏好、系统主题和选中状态，启动脚本先应用有效主题；编辑器订阅同一控制器。状态栏提供独立的本地 SVG 图标控件。Tauri 原生标题栏按选择顺序同步。

**Tech Stack:** TypeScript、Vditor、CSS、Tauri 2、Vitest、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-06-theme-selector-design.md`

## Global Constraints

- 默认跟随系统，离线可用，无新增运行时依赖；保留现有排版、文件操作和用户未跟踪文件。
- 只改本次范围内的状态栏外观、主题切换和发布正文；三种模式在启动、运行中和重启后保持一致。
- 发布使用版本号与 tag 一致的正式版 `v0.1.6`，不覆盖已有 tag。

## Review Focus

- 储存不可用或含无效值时安全回退；手动偏好不被系统变化覆盖。
- 编辑器初始化未结束时多次切换，最终外壳、正文、代码高亮与页面保持一致。
- 选择后重新启动恢复偏好，且首次渲染不闪现相反配色。
- 原生标题栏调用慢或失败时不阻塞页面，快速切换最终保持最近选择。
- 长状态提示、冲突按钮及窄窗口下图标、字数和焦点仍可见；切换不改文档及选区。

### Task 1: 外观状态与编辑器同步

**Files:** Create `src/theme.ts`, `src/theme.test.ts`; modify `index.html`, `src/editor.ts`, `src/editor.test.ts`, `src/main.ts`, `src/main.test.ts`, `src/styles/tokens.css`, `src-tauri/capabilities/default.json`.

- [x] 编写失败测试：默认及损坏值回退系统；手动切换、持久化及重启；系统变化只影响系统模式；存储异常仍可切换；原生同步顺序和失败；初始化期间主题变化以最新值为准。
- [x] 运行 `npx vitest run src/theme.test.ts src/editor.test.ts`，确认新测试因功能缺失失败。
- [x] 实现 `createThemeController`，输出 `getPreference`、`isDark`、`setPreference`、`subscribe`；在首次绘制前应用有效模式，并让 Vditor 订阅同一状态。
- [x] 重新运行上述测试，全部通过。

### Task 2: 状态栏图标与发布内容

**Files:** Modify `index.html`, `src/theme.ts`, `src/theme.test.ts`, `src/styles/tide.css`, `DESIGN.md`, `README.md`, `CHANGELOG.md`, `.github/workflows/release.yml`.

- [x] 编写失败测试：三按钮可选、选中状态准确，点击不触发文档编辑；状态提示文本更新不移除控件。
- [x] 运行对应测试并确认失败；实现三枚一致线条的 SVG、焦点/选中/窄窗口状态及中文提示。
- [x] 更新设计说明、使用说明及 0.1.6 更新日志；Release 正文严格只保留用户指定的第一句话。
- [x] 运行 `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --offline`；在浏览器检查深浅两色、模式切换、持久化、键盘焦点及窄窗口。

### Task 3: 集成与正式发布

- [ ] 审查 diff，确认未加入用户原有未跟踪文件；提交到 `feat/theme-mode-selector`。
- [ ] 合入 main 并推送，等待 CI 通过；确认远端不存在 `v0.1.6` 后，对已验证的 main 提交打标签并推送。
- [ ] 跟进 Release 工作流至完成，核实正式 Release 正文及 Windows NSIS、MSI 产物。
