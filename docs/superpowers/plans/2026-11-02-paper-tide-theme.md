# Tide 纸面主题实施计划

> **For agentic workers:** Implement the cohesive change in this session, preserving the existing single-file workflow.

**Goal:** 将已选定的「纸面偏多」方向应用于真实编辑器，并记录可复用的设计语言。

**Architecture:** 在现有样式之后加载独立的语义令牌和 Tide 主题；用更高优先级覆盖 Vditor 在运行时加载的内容主题。仅修改冲突选项的描述，不改变保存和解决冲突的逻辑。

**Tech Stack:** Tauri 2、TypeScript、Vditor、CSS、Vitest。

**Spec:** `DESIGN.md`

## Global Constraints

- 明暗随系统；不添加远程资源或运行时依赖。
- 保留 720px 内容宽、至少 52px 的标记留白、全宽画布和窗口右侧滚动条。
- 冲突选项的文字必须准确描述会失去或覆盖的版本。
- 原子写入、自动保存、文件监视和冲突处理语义不变。

## Review Focus

- Vditor 动态载入浅色/深色内容 CSS 后，画布、文字和引用仍使用 Tide 颜色。
- 焦点与非焦点状态保持同一画布颜色。
- 窄窗口中标题标记、错误文字和冲突按钮不会被截断。
- 选区、链接和状态文字在两种模式下保持可读。
- 所有原有文件冲突和保存测试继续通过。

## Task: 主题和冲突提示

**Files:** Create `DESIGN.md`, `src/styles/tokens.css`, `src/styles/tide.css`; modify `src/main.ts`, `src/main.test.ts`, `src/editor.ts`, `src/editor.test.ts`, `vitest.config.ts`.

- [x] 增加覆盖冲突操作含义的测试，先确认其针对旧文案失败。
- [x] 增加明暗语义令牌和编辑器、状态栏样式，保持现有编辑器布局与行为。
- [x] 修改冲突选项文案，使其准确描述对本地和磁盘内容的影响。
- [x] 保证亮暗切换同步更新代码高亮主题，代码样式仍从本地加载。
- [x] 避免 Vitest 将 `.agents` 技能目录中的独立 `node:test` 脚本当作应用测试。
- [x] 运行前端测试和构建，并在真实 Vditor 中检查亮色、暗色、窄窗口与文件冲突展示。
- [x] 对照本计划的 Review Focus 和 `DESIGN.md` 完成最终检查。
