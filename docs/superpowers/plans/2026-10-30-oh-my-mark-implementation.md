# oh-my-mark 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建轻量级单文件 markdown 编辑器（Typora 式即编即显），按设计文档 `docs/superpowers/specs/2026-10-30-oh-my-mark-design.md` 实现。

**Architecture:** Tauri 2 壳（Rust 只做文件 IO/监视/对话框）+ vanilla TS 前端（Vditor IR 模式承担全部编辑体验）。前端文件状态机与 Tauri IPC 通过注入式适配器解耦，可脱离 Rust 在浏览器中先行开发与测试。

**Tech Stack:** Tauri 2 / Vite 5 / TypeScript / Vditor / Vitest / notify(rust) / tauri-plugin-dialog

**环境现状（2026-10-30 已探测）：** Node v22.22.2 + npm 10.9.7 已就绪；**Rust 与 MSVC 构建工具未安装**；winget 可用。

**任务依赖：** Task 1（工具链）只阻塞 Task 5 起的 Rust 部分；Task 2-4（脚手架/Vditor/状态机）用 `npm run dev` 在浏览器中验证，不依赖 Rust。

---

### Task 1: 安装 Rust 工具链 + MSVC 构建工具（需管理员权限，执行前须用户确认）

**Files:** 无项目文件（系统级安装）

**Step 1: 询问用户授权安装**（数 GB 下载，涉及系统变更；若用户选择自行安装，本任务由用户完成后告知）

**Step 2: 安装 rustup + MSVC**

```powershell
winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --accept-source-agreements --accept-package-agreements
```

**Step 3: 验证**

```bash
rustc --version && cargo --version
```

Expected: 两个版本号输出（rustc 1.7x+）。若 link 相关报错，运行 VS 的 "x64 Native Tools Command Prompt" 一次或重开终端。

---

### Task 2: 脚手架初始化（不依赖 Rust）

**Files:**
- Create: 项目根下 Tauri vanilla-ts 模板全套（package.json / src / src-tauri / vite.config.ts / .gitignore / index.html 等）

**Step 1: 在子目录生成模板**

```bash
cd D:/Projects/HDK/oh-my-mark
npm create tauri-app@latest scaffold -- --template vanilla-ts --manager npm --yes
```

Expected: `scaffold/` 目录生成，无交互提问。

**Step 2: 合并进项目根（保留已有 docs/ 与 .git/）**

```bash
cp -r scaffold/. ./
rm -rf scaffold
```

**Step 3: 安装依赖并改标识符**

```bash
npm install
```

编辑 `src-tauri/tauri.conf.json`：`"identifier"` 改为 `"dev.ohmymark.app"`；`"productName"` 改为 `"oh-my-mark"`。

**Step 4: 浏览器内验证前端可跑**

```bash
npm run dev
```

Expected: Vite 起在 `http://localhost:1420`，浏览器显示默认 Hello World 页。

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: tauri vanilla-ts 脚手架"
```

---

### Task 3: Vditor 集成（editor.ts，IR 模式）

**Files:**
- Modify: `package.json`（依赖）
- Create: `src/editor.ts`
- Modify: `src/main.ts`、`index.html`、`src/styles/main.css`

**Step 1: 安装 Vditor 与静态拷贝插件**

```bash
npm install vditor
npm install -D vite-plugin-static-copy
```

vite.config.ts 用 viteStaticCopy 把 `node_modules/vditor/dist` 拷到 `/vditor/dist`（Vditor 会在 cdn 值下拼 `dist/...` 路径），保证 dev/build 双模式、断网环境离线可用——Vditor 默认从 unpkg CDN 运行时拉取 Lute 引擎，对离线桌面应用是发布阻断项。

**Step 2: 写 index.html 结构（极简三块）**

```html
<body>
  <div id="app">
    <div id="editor"></div>
    <footer id="statusbar">
      <span id="status-left"></span>
      <span id="status-right"></span>
    </footer>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

**Step 3: 写 src/editor.ts（全项目唯一 import Vditor 的文件）**

```ts
import Vditor from 'vditor'
import 'vditor/dist/index.css'

let vditor: Vditor | null = null

export function initEditor(
  container: HTMLElement,
  callbacks: { onInput: (markdown: string) => void; onReady: () => void },
): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  vditor = new Vditor(container, {
    mode: 'ir',               // 即编即显
    lang: 'zh_CN',
    height: '100%',
    cache: { enable: false }, // 单文件模型：禁用 localStorage 缓存
    cdn: '/vditor',           // 运行时资源本地化（离线可用）
    theme: dark ? 'dark' : 'classic',
    preview: { theme: { current: dark ? 'dark' : 'light' } }, // 内容区主题独立于外壳，否则暗壳白芯
    toolbar: [],
    input: (value) => callbacks.onInput(value),
    after: () => callbacks.onReady(),
  })
}

export function getMarkdown(): string {
  return vditor?.getValue() ?? ''
}

export function setMarkdown(value: string): void {
  vditor?.setValue(value)
}

export function focusEditor(): void {
  vditor?.focus()
}
```

**Step 4: 写 src/main.ts（本任务先做浏览器最小接线）**

```ts
import './styles/main.css'
import { initEditor } from './editor'

const statusLeft = document.querySelector<HTMLSpanElement>('#status-left')!
const editorEl = document.querySelector<HTMLElement>('#editor')!

initEditor(editorEl, {
  onInput: (md) => { statusLeft.textContent = `字数 ${md.replace(/\s+/g, '').length}` },
  onReady: () => focusEditor(),
})
```

**Step 5: 写 src/styles/main.css 基础布局**

```css
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
#app { display: flex; flex-direction: column; height: 100%; }
#editor { flex: 1; overflow: hidden; }
#statusbar {
  display: flex; justify-content: space-between; align-items: center;
  height: 24px; padding: 0 12px; font-size: 12px; color: #888;
  border-top: 1px solid rgba(128, 128, 128, 0.2); user-select: none;
}
```

**Step 6: 浏览器验证**

```bash
npm run dev
```

Expected: 编辑器占满窗口，输入 `# 标题` 回车后该行渲染为大标题，光标移开即渲染、移回即源码（IR 行为）；底部状态栏字数实时变化。

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: 集成 Vditor IR 模式编辑器"
```

---

### Task 4: file.ts 状态机（TDD，纯前端）

**Files:**
- Create: `src/file.ts`、`src/file.test.ts`
- Modify: `package.json`（test 脚本）

**Step 1: 装 Vitest**

```bash
npm install -D vitest
```

`package.json` scripts 增加 `"test": "vitest run"`。

**Step 2: 写失败测试 src/file.test.ts**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSession } from './file'

function fakeFs() {
  return {
    open: vi.fn(async (path: string) => ({ name: 'a.md', content: '# 旧', size: 4 })),
    save: vi.fn(async (path: string, content: string) => {}),
  }
}

describe('file session 状态机', () => {
  it('open 后为 clean，可读取内容', async () => {
    const s = createSession(fakeFs())
    await s.open('C:/x/a.md')
    expect(s.getState()).toMatchObject({ path: 'C:/x/a.md', name: 'a.md', status: 'clean' })
    expect(s.getContent()).toBe('# 旧')
  })

  it('edit 后变 dirty；改回已保存内容则回到 clean', async () => {
    const s = createSession(fakeFs())
    await s.open('C:/x/a.md')
    s.edit('# 新')
    expect(s.getState().status).toBe('dirty')
    s.edit('# 旧')
    expect(s.getState().status).toBe('clean')
  })

  it('save 成功后回到 clean，写入的是当前内容', async () => {
    const fs = fakeFs()
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 新')
    await s.save()
    expect(s.getState().status).toBe('clean')
    expect(fs.save).toHaveBeenCalledWith('C:/x/a.md', '# 新')
  })

  it('save 失败进入 error 状态，内容保留', async () => {
    const fs = fakeFs()
    fs.save.mockRejectedValueOnce(new Error('disk full'))
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 新')
    await s.save()
    expect(s.getState().status).toBe('error')
    expect(s.getContent()).toBe('# 新')
  })

  it('reload 外部内容后为 clean', async () => {
    const s = createSession(fakeFs())
    await s.open('C:/x/a.md')
    s.edit('# 我改的')
    s.reload('# 磁盘上的')
    expect(s.getState().status).toBe('clean')
    expect(s.getContent()).toBe('# 磁盘上的')
  })
})
```

**Step 3: 跑测试确认失败**

```bash
npm test
```

Expected: FAIL，`createSession` 未定义。

**Step 4: 写 src/file.ts 最小实现**

```ts
export interface OpenedFile { name: string; content: string; size: number }

/** 文件系统适配器：生产环境注入 Tauri invoke，测试注入 fake */
export interface FsAdapter {
  open(path: string): Promise<OpenedFile>
  save(path: string, content: string): Promise<void>
}

export type SessionStatus = 'empty' | 'clean' | 'dirty' | 'saving' | 'error'

export interface SessionState {
  path: string | null
  name: string
  status: SessionStatus
}

export function createSession(fs: FsAdapter, onChange?: (s: SessionState) => void) {
  let path: string | null = null
  let name = '未命名'
  let content = ''
  let savedContent = ''
  let status: SessionStatus = 'empty'
  let saving = false

  const notify = () => onChange?.(getState())
  const getState = (): SessionState => ({ path, name, status })

  return {
    getState,
    getContent: () => content,
    isDirty: () => status === 'dirty' || status === 'error',
    async open(p: string) {
      const r = await fs.open(p)
      path = p; name = r.name; content = r.content; savedContent = r.content; status = 'clean'
      notify()
      return r
    },
    edit(value: string) {
      content = value
      if (!saving) status = value === savedContent ? 'clean' : 'dirty'
      notify()
    },
    async save() {
      if (!path || saving || content === savedContent && status === 'clean') return
      saving = true; status = 'saving'; notify()
      try {
        await fs.save(path, content)
        savedContent = content; status = 'clean'
      } catch {
        status = 'error'
      } finally {
        saving = false
        notify()
      }
    },
    reload(newContent: string) {
      content = newContent; savedContent = newContent; status = 'clean'
      notify()
    },
  }
}

export type FileSession = ReturnType<typeof createSession>
```

**Step 5: 跑测试确认通过**

```bash
npm test
```

Expected: 5 passed。

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: 文件会话状态机（TDD）"
```

---

### Task 5: Rust 命令层 open_file / save_file 原子写（TDD，依赖 Task 1）

**Files:**
- Modify: `src-tauri/Cargo.toml`（dev-dep tempfile）
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: 加 dev 依赖**

```bash
cd src-tauri && cargo add tempfile --dev && cd ..
```

**Step 2: 写 src-tauri/src/commands.rs（含失败测试）**

```rust
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct OpenedFile {
    pub name: String,
    pub content: String,
    pub size: u64,
}

/// 错误以短码返回，前端映射为中文提示
#[tauri::command]
pub fn open_file(path: String) -> Result<OpenedFile, String> {
    let p = Path::new(&path);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".into());
    let bytes = fs::read(p).map_err(|_| "OPEN_FAILED".to_string())?;
    let size = bytes.len() as u64;
    let content = String::from_utf8(bytes).map_err(|_| "NOT_UTF8".to_string())?;
    Ok(OpenedFile { name, content, size })
}

/// 原子写：先写同目录临时文件，再 rename 覆盖目标
#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    let dir = p.parent().filter(|d| !d.as_os_str().is_empty()).ok_or("SAVE_FAILED")?;
    let name = p.file_name().ok_or("SAVE_FAILED")?;
    let tmp = dir.join(format!(".{}.{}.tmp", name.to_string_lossy(), std::process::id()));
    fs::write(&tmp, content.as_bytes()).map_err(|_| "SAVE_FAILED".to_string())?;
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("SAVE_FAILED:{e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_roundtrip_and_no_tmp_leftover() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        save_file(path.to_string_lossy().to_string(), "# 你好".into()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "# 你好");
        // 目录里只剩 a.md，没有临时文件
        let n = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(n, 1);
    }

    #[test]
    fn save_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        save_file(path.to_string_lossy().to_string(), "new".into()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn open_returns_utf8_and_name() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("笔记.md");
        fs::write(&path, "# hi").unwrap();
        let r = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(r.name, "笔记.md");
        assert_eq!(r.content, "# hi");
        assert_eq!(r.size, 4);
    }

    #[test]
    fn open_rejects_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gbk.md");
        fs::write(&path, [0xD6, 0xD0, 0xCE, 0xC4]).unwrap(); // GBK "中文"
        let err = open_file(path.to_string_lossy().to_string()).unwrap_err();
        assert_eq!(err, "NOT_UTF8");
    }

    #[test]
    fn open_missing_file_fails() {
        let err = open_file("Z:/不存在/x.md".into()).unwrap_err();
        assert_eq!(err, "OPEN_FAILED");
    }
}
```

**Step 3: 跑测试确认结果**

```bash
cd src-tauri && cargo test
```

Expected: 5 passed（首次编译需数分钟）。

**Step 4: 注册命令——src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running oh-my-mark");
}
```

**Step 5: 跑通 Tauri 窗口（首次全量编译）**

```bash
npm run tauri dev
```

Expected: 弹出原生窗口，显示 Task 3 的编辑器。

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: open_file/save_file 命令（原子写，TDD）"
```

---

### Task 6: watch_file 外部变更监视

**Files:**
- Modify: `src-tauri/src/commands.rs`、`src-tauri/src/main.rs`、`src-tauri/Cargo.toml`

**Step 1: 加依赖**

```bash
cd src-tauri && cargo add notify && cd ..
```

**Step 2: 在 commands.rs 追加（含监视状态）**

```rust
use notify::{recommended_watcher, RecursiveMode, Watcher};
use std::sync::Mutex;

pub struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

impl Default for WatchState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// 监视当前文件；重复调用会替换上一个 watcher（换文件时自动停旧启新）
#[tauri::command]
pub fn watch_file(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    path: String,
) -> Result<(), String> {
    let app = app.clone();
    let mut watcher = recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            if event.kind.is_modify() || event.kind.is_create() {
                let _ = app.emit("file-changed", ());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(state: tauri::State<WatchState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None; // drop 即停止
    Ok(())
}
```

（文件头部 `use std::path::Path;` 已有；`app.emit` 需要 `use tauri::Emitter;`。）

**Step 3: main.rs 注册**

```rust
        .manage(commands::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::watch_file,
            commands::unwatch_file
        ])
```

**Step 4: cargo check 快速验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 无错误。（notify 的事件回调无法单测，行为验证放 Task 8 手动进行。）

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: watch_file 单文件外部变更监视"
```

---

### Task 7: 打开/保存全链路（对话框 + 拖拽 + 防抖自动保存 + 标题栏 + 状态栏）

**Files:**
- Modify: `package.json`、`src/main.ts`、`src-tauri/capabilities/default.json`
- Modify: `src-tauri/Cargo.toml`、`src-tauri/src/main.rs`

**Step 1: 装对话框插件（前后两端）**

```bash
npm install @tauri-apps/plugin-dialog
cd src-tauri && cargo add tauri-plugin-dialog && cd ..
```

`src-tauri/src/main.rs` 的 Builder 加 `.plugin(tauri_plugin_dialog::init())`。

`src-tauri/capabilities/default.json` 的 permissions 数组追加 `"dialog:default"`。

**Step 2: 重写 src/main.ts 为完整接线**

```ts
import './styles/main.css'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { initEditor, setMarkdown, focusEditor, getMarkdown } from './editor'
import { createSession, type FsAdapter, type OpenedFile } from './file'

const inTauri = '__TAURI_INTERNALS__' in window
const statusLeft = document.querySelector<HTMLSpanElement>('#status-left')!
const statusRight = document.querySelector<HTMLSpanElement>('#status-right')!
const editorEl = document.querySelector<HTMLElement>('#editor')!

const tauriFs: FsAdapter = {
  async open(path: string): Promise<OpenedFile> {
    return invoke<OpenedFile>('open_file', { path })
  },
  async save(path: string, content: string): Promise<void> {
    return invoke('save_file', { path, content })
  },
}

const session = createSession(tauriFs, render)

function render() {
  const s = session.getState()
  const map = {
    empty: '',
    clean: '已保存',
    dirty: '未保存',
    saving: '保存中…',
    error: '保存失败，将自动重试',
  } as const
  statusLeft.textContent = s.path ? map[s.status] : ''
  statusLeft.dataset.status = s.status
  if (inTauri) {
    const dot = s.status === 'dirty' || s.status === 'error' ? '● ' : ''
    getCurrentWindow().setTitle(`${dot}${s.name} - oh-my-mark`)
  }
}

let autosaveTimer: number | undefined
function onInput(markdown: string) {
  session.edit(markdown)
  statusRight.textContent = `字数 ${markdown.replace(/\s+/g, '').length}`
  if (inTauri) {
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => session.save(), 2000) // 防抖 2s
  }
}

async function openPath(path: string) {
  if (session.isDirty()) {
    await session.save() // 单文件模型：打开前先保旧的
  }
  const r = await session.open(path)
  setMarkdown(r.content)
  focusEditor()
  if (inTauri) {
    invoke('watch_file', { path })
    // 自己的原子写会触发 watch 事件，保存后短窗口内忽略
    lastSavedAt = Date.now()
  }
}

let lastSavedAt = 0
const origSave = session.save.bind(session)
session.save = async () => {
  await origSave()
  if (session.getState().status === 'clean') lastSavedAt = Date.now()
}

initEditor(editorEl, { onInput, onReady: () => focusEditor() })

if (inTauri) {
  // Ctrl+O 打开
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      void openFileDialog({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      }).then((p) => p && openPath(p))
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void session.save()
    }
  })
  // 拖拽 .md 到窗口即打开
  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop' && event.payload.paths[0]) {
      void openPath(event.payload.paths[0])
    }
  })
  render()
}
```

**Step 3: 手动验证清单（`npm run tauri dev`）**

1. 拖一个 .md 文件到窗口 → 内容载入，标题变为「文件名 - oh-my-mark」
2. 敲几个字 → 标题出现「● 」前缀，状态栏「未保存」
3. 停手 2 秒 → 自动保存，「● 」消失，磁盘内容已更新（用别的编辑器确认）
4. Ctrl+O → 系统对话框选文件 → 打开
5. Ctrl+S → 立即保存

Expected: 全部通过。

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: 打开/保存全链路（对话框+拖拽+防抖自动保存）"
```

---

### Task 8: 外部变更处理（静默重载 + 冲突内联提示）

**Files:**
- Modify: `src/main.ts`、`src/styles/main.css`

**Step 1: main.ts 监听 file-changed 事件（接在 Task 7 的 inTauri 块内）**

```ts
import { listen } from '@tauri-apps/api/event'

async function handleExternalChange() {
  if (Date.now() - lastSavedAt < 1500) return // 自己保存引发的写入，忽略
  const path = session.getState().path
  if (!path) return
  if (!session.isDirty()) {
    // 本地干净：静默重载
    const r = await invoke<OpenedFile>('open_file', { path })
    session.reload(r.content)
    setMarkdown(r.content)
  } else {
    showConflict()
  }
}

let conflictActive = false
function showConflict() {
  if (conflictActive) return
  conflictActive = true
  statusLeft.dataset.status = 'conflict'
  statusLeft.textContent = '文件已被外部修改：'
  const overwrite = document.createElement('button')
  overwrite.textContent = '以磁盘版本覆盖'
  overwrite.onclick = async () => {
    const path = session.getState().path!
    const r = await invoke<OpenedFile>('open_file', { path })
    session.reload(r.content)
    setMarkdown(r.content)
    conflictActive = false
  }
  const keep = document.createElement('button')
  keep.textContent = '保留我的版本'
  keep.onclick = () => {
    conflictActive = false
    render()
    void session.save() // 尽快把本地版本写回磁盘，结束冲突态
  }
  statusLeft.append(overwrite, keep)
}

void listen('file-changed', () => void handleExternalChange())
```

（`render()` 需在冲突态跳过覆盖 statusLeft 的内容：`if (conflictActive) return` 加到 render 开头。）

**Step 2: 冲突按钮样式（main.css 追加）**

```css
#statusbar button {
  font-size: 12px; border: none; background: #b47714; color: #fff;
  border-radius: 4px; padding: 1px 8px; margin-left: 8px; cursor: pointer;
}
#status-left[data-status="error"] { color: #c0392b; }
```

**Step 3: 手动验证清单**

1. 打开 a.md，不改 → 在 VS Code 里改 a.md 并保存 → 编辑区**静默**更新，无弹窗
2. 打开 a.md，敲几个字（未保存）→ 外部修改 a.md → 状态栏出现琥珀色提示和两个按钮
3. 点「以磁盘版本覆盖」→ 编辑区变磁盘版本，状态恢复 clean
4. 点「保留我的版本」→ 本地内容写回磁盘

Expected: 全部通过。

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: 外部变更静默重载与冲突内联提示"
```

---

### Task 9: 退出保护

**Files:**
- Modify: `src/main.ts`

**Step 1: 拦截窗口关闭（inTauri 块内）**

```ts
import { ask } from '@tauri-apps/plugin-dialog'

const win = getCurrentWindow()
void win.onCloseRequested(async (event) => {
  // onInput 有 undoDelay 延迟（Vditor 默认 800ms）：敲完立即关窗时 session 可能还没变脏，
  // 用编辑器当前内容与会话内容比对兜底，防止丢最后一秒的输入
  if (!session.isDirty() && getMarkdown() === session.getContent()) return
  event.preventDefault()
  const save = await ask('有未保存的修改，保存后退出吗？', {
    title: 'oh-my-mark', kind: 'warning', okLabel: '保存并退出', cancelLabel: '取消',
  })
  if (save) {
    await session.save()
    if (session.getState().status === 'clean') await win.destroy()
    // 保存失败则不退出，留在 error 状态自动重试
  }
})
```

**Step 2: 手动验证**

改一个字 → 点窗口关闭 → 弹确认框 → 「保存并退出」退出且磁盘是新内容；「取消」留在应用。

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: 脏状态退出保护"
```

---

### Task 10: 极简主题与排版

**Files:**
- Modify: `src/styles/main.css`、`src/editor.ts`

**Step 1: 关工具栏 + 居中 720px 行宽（main.css 追加）**

```css
.vditor-toolbar { display: none !important; }
.vditor { border: none !important; }
.vditor-reset {
  max-width: 720px !important;
  margin: 0 auto !important;
  padding: 32px 24px 96px !important;
  font-size: 16px !important;
  line-height: 1.75 !important;
}
```

**Step 2: 暗色跟随系统（editor.ts 的 initEditor 中，初始化前监听）**

```ts
const dark = window.matchMedia('(prefers-color-scheme: dark)')
dark.addEventListener('change', () => {
  // 实例方法 setTheme(theme, contentTheme) 同时切外壳与内容主题
  // （注意：setContentTheme 是静态方法，不能在实例上调用——已在 40fd3ee 核实）
  vditor?.setTheme(dark.matches ? 'dark' : 'classic', dark.matches ? 'dark' : 'light')
})
```

（Vditor 主题选项已在 Task 3 设置；此处补运行时切换。）

**Step 3: 手动验证**

1. 无工具栏，编辑区居中窄栏，长文阅读舒适
2. 系统切暗色 → 应用跟随（重启应用生效亦可接受）

**Step 4: 回归测试 + Commit**

```bash
npm test
git add -A && git commit -m "style: 极简主题（无工具栏、720px 行宽、暗色跟随）"
```

---

### Task 11: 错误处理加固

**Files:**
- Modify: `src/main.ts`

**Step 1: 错误码映射与大文件预警（openPath 内）**

```ts
async function openPath(path: string) {
  if (session.isDirty()) await session.save()
  try {
    const r = await session.open(path)
    if (r.size > 5 * 1024 * 1024) {
      statusRight.textContent = '大文件，可能卡顿'
    }
    setMarkdown(r.content)
    focusEditor()
    if (inTauri) { invoke('watch_file', { path }); lastSavedAt = Date.now() }
  } catch (e) {
    const msg = e === 'NOT_UTF8' ? '文件不是 UTF-8 编码，无法打开'
      : e === 'OPEN_FAILED' ? '文件打开失败（已移动或无权限）'
      : `打开失败：${e}`
    statusLeft.dataset.status = 'error'
    statusLeft.textContent = msg
  }
}
```

**Step 2: 保存失败自动重试（render 或 session.save 包装处）**

```ts
session.save = async () => {
  await origSave()
  if (session.getState().status === 'clean') lastSavedAt = Date.now()
  else if (session.getState().status === 'error') {
    setTimeout(() => void session.save(), 5000) // 5s 后重试
  }
}
```

**Step 3: 手动验证**

1. 建一个 GBK 编码的 .md 拖入 → 状态栏红字提示，不白屏
2. 把文件设为只读 → 编辑 → 保存失败红字，解除只读后 5s 内自动保存成功恢复

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: 错误码映射与大文件/编码异常处理"
```

---

### Task 12: 收尾——LICENSE / README / 构建验证

**Files:**
- Create: `LICENSE`、`README.md`

**Step 1: 写 LICENSE（MIT，版权署名 `zhouyu and oh-my-mark contributors`，年份 2026）**

**Step 2: 写 README.md**——一段定位介绍 + 技术栈 + 开发命令（`npm install` / `npm run dev` / `npm run tauri dev` / `npm test`）+ 依赖协议表（Tauri MIT/Apache-2.0、Vditor MIT）

**Step 3: 发布构建验证（首次较久，NSIS 需下载）**

```bash
npm run tauri build
```

Expected: `src-tauri/target/release/bundle/nsis/oh-my-mark_*.exe` 生成；记录安装包体积，对照目标 5~8MB（预计 3~6MB）。

**Step 4: 全量回归**

```bash
npm test && cd src-tauri && cargo test
```

另：断网启动打包后的应用，确认编辑器初始化与输入正常（Vditor 资源本地化的端到端确认）。

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: MIT LICENSE、README 与首个可构建版本"
```

---

## 执行备注

- **设计偏差说明**：v0.1 用原生标题栏（通过 setTitle 显示「● 文件名」）而非设计文档的自定义无边框标题栏——后者涉及 `decorations: false` + 自绘拖拽区 + 窗口控制按钮，收益低风险高，列入后续迭代。
- **手动验证清单**是本项目的验收标准（Tauri GUI 无法全自动 E2E，按设计文档决策）。
- **编辑器内容与会话的一致性**：`setValue` 不触发 `input` 回调（已在 Vditor 源码核实），所以「打开文件 → setMarkdown → 状态机」不会误判 dirty；但 `input` 回调本身有 undoDelay 防抖（默认 800ms，可在 editor.ts 设 `undoDelay: 400` 加快），任何依赖「立即 dirty」的逻辑（如退出保护）都要用 `getMarkdown()` 与会话内容比对兜底。
- **vite-plugin-static-copy 路径坑**（已在 8956437 解决）：@4.1.1 无 structured 选项，collectCopyTargets 会把 src 相对 root 的完整目录拼进 dest，得到 `/vditor/dist/node_modules/vditor/dist/...`；解法是在 rename 函数里用 `"../".repeat(子目录深度 + 3)` 抵消 node_modules/vditor/dist 三层前缀。另注意 Vite SPA fallback 会让任意路径的 curl 都返回 200——验证静态资源必须核对 content-type。
- **Vditor DOM 结构**（Task 10 发现）：DOM 里有 4 个 `.vditor-reset` 元素（wysiwyg 备用 pre、sv textarea、preview div 均为 0×0 隐藏），IR 模式实际可见的是 `DIV.vditor-ir > pre.vditor-reset`——做几何/DOM 断言必须选对这个元素。
- Task 1 需要管理员权限安装系统组件，执行时必须先征得用户明确同意。
