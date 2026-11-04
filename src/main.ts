import './styles/main.css'
import './styles/tokens.css'
import './styles/tide.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openFileDialog, save as saveFileDialog, ask } from '@tauri-apps/plugin-dialog'
import { initEditor, setMarkdown, setDocumentPath, focusEditor, getMarkdown, type InsertPastedImages } from './editor'
import { createSession, type FsAdapter, type OpenedFile } from './file'
import { clipboardImageMime, type ClipboardImage } from './clipboard-images'

const inTauri = '__TAURI_INTERNALS__' in window
const statusLeft = document.querySelector<HTMLSpanElement>('#status-left')!
const statusRight = document.querySelector<HTMLSpanElement>('#status-right')!
const editorEl = document.querySelector<HTMLElement>('#editor')!
let resolveEditorReady!: () => void
const editorReady = new Promise<void>((resolve) => { resolveEditorReady = resolve })
let editorIsReady = false
let editorValue = ''
let savedEditorValue = ''
let imageDocumentPath: string | null = null
let documentVersion = 0
const pendingImagePastes = new Set<Promise<boolean>>()

function setActiveDocumentPath(path: string) {
  imageDocumentPath = path
  setDocumentPath(path)
}

const tauriFs: FsAdapter = {
  async open(path: string): Promise<OpenedFile> {
    return invoke<OpenedFile>('open_file', { path })
  },
  async save(path: string, content: string, expected: string | null, expectedMissing: boolean): Promise<void> {
    return invoke('save_file', { path, content, expected, expectedMissing })
  },
}

const session = createSession(tauriFs, render)

// 冲突提示激活时，render() 不得覆盖 statusLeft（提示与按钮由 showConflict 管理）
let conflictActive = false
let fileMissing = false
let watchFailed = false
let watchOperation: Promise<void> = Promise.resolve()

function render() {
  if (conflictActive) return
  const s = session.getState()
  const map = {
    empty: '',
    clean: '已保存',
    dirty: '未保存',
    saving: '保存中…',
    error: '保存失败，将自动重试',
  } as const
  statusLeft.textContent = fileMissing ? '文件已被移动或删除'
    : s.status === 'error' ? map.error
    : watchFailed ? '无法监视文件的外部变更'
    : s.path ? map[s.status] : ''
  statusLeft.dataset.status = fileMissing || watchFailed ? 'error' : s.status
  if (inTauri) {
    const dot = s.status === 'dirty' || s.status === 'error' ? '● ' : ''
    getCurrentWindow().setTitle(`${dot}${s.name} - tide`)
  }
}

let autosaveTimer: number | undefined
let externalCheck: Promise<void> = Promise.resolve()
let pendingExternalChecks = 0
function onInput(markdown: string) {
  if (markdown === editorValue) return
  editorValue = markdown
  session.edit(markdown === savedEditorValue ? session.getSavedContent() : markdown)
  renderWordCount(markdown)
  if (inTauri && session.getState().path && !conflictActive && !fileMissing && !pendingExternalChecks) {
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => session.save(), 2000) // 防抖 2s
  }
}

function syncEditor() {
  const markdown = getMarkdown()
  if (markdown !== editorValue) onInput(markdown)
}

function displayMarkdown(markdown: string) {
  documentVersion += 1
  setMarkdown(markdown)
  editorValue = getMarkdown()
  savedEditorValue = editorValue
}

let retryTimer: number | undefined
const origSave = session.save.bind(session)
session.save = async (force = false, expectedMissing = false) => {
  await watchOperation
  await externalCheck
  if (conflictActive || fileMissing) return
  const previousSaved = session.getSavedContent()
  const savePath = session.getState().path
  await origSave(force, expectedMissing)
  if (session.getSavedContent() !== previousSaved) savedEditorValue = session.getSavedContent()
  if (session.getSaveError() === 'FILE_CONFLICT') {
    showConflict()
    return
  }
  if (session.getSaveError() === 'FILE_MISSING') {
    fileMissing = true
    render()
    return
  }
  if (savePath && session.getState().path === savePath
    && !session.getSaveError() && imageDocumentPath !== savePath) {
    setActiveDocumentPath(savePath)
    await watchPath(savePath)
  }
  if (session.getState().status === 'error' && retryTimer === undefined) {
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void session.save() // 5s 后自动重试（全局至多挂一个，防重入）
    }, 5000)
  }
}

function watchPath(path: string): Promise<void> {
  watchOperation = watchOperation.then(async () => {
    if (session.getState().path !== path) return
    try {
      await invoke('watch_file', { path })
      if (session.getState().path === path) {
        watchFailed = false
        queueExternalChange()
        await externalCheck
      }
    } catch {
      if (session.getState().path === path) watchFailed = true
    }
    if (session.getState().path === path) render()
  })
  return watchOperation
}

async function saveCurrent(force = false) {
  await editorReady
  await externalCheck
  if (conflictActive) return
  let recreate = false
  if (fileMissing) {
    recreate = await ask('文件已被移动或删除，要在原位置重新创建吗？', {
      title: 'tide', kind: 'warning', okLabel: '重新创建', cancelLabel: '取消',
    })
    if (!recreate) return
    fileMissing = false
  }
  if (!session.getState().path) {
    const path = await saveFileDialog({
      defaultPath: '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
    if (!path || session.getState().path) return
    session.setPathForNewFile(path)
  }
  syncEditor()
  await session.save(recreate || force, recreate)
  syncEditor()
}

async function pasteImages(files: ClipboardImage[], insert: InsertPastedImages, missing: number): Promise<boolean> {
  const version = documentVersion
  if (conflictActive || fileMissing) {
    statusRight.textContent = '请先处理文档冲突或丢失的问题，再粘贴图片'
    return false
  }
  if (!files.length && missing) {
    let inserted = false
    try { inserted = insert([]) } catch { /* Report the paste failure below. */ }
    statusRight.textContent = inserted
      ? '部分图片只有链接，未复制到 images 文件夹'
      : '图片粘贴未完成，请重试'
    return false
  }
  if (!imageDocumentPath) await saveCurrent()
  if (documentVersion !== version) return false
  const path = imageDocumentPath
  if (!path || session.getState().path !== path || conflictActive || fileMissing) {
    statusRight.textContent = '请先保存文档，再粘贴图片'
    return false
  }
  const isCurrent = () => documentVersion === version && session.getState().path === path
    && !conflictActive && !fileMissing

  const paths: (string | null)[] = []
  let failed = missing > 0
  for (const file of files) {
    try {
      let relative: string
      if ('localSource' in file) {
        if (!isCurrent()) break
        relative = await invoke<string>('copy_pasted_image', { documentPath: path, source: file.localSource })
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (!isCurrent()) break
        relative = await invoke<string>('save_pasted_image', bytes, { headers: {
          'x-document-path': encodeURIComponent(path), 'x-image-mime': clipboardImageMime(file) ?? '',
        } })
      }
      paths.push(relative)
    } catch {
      failed = true
      paths.push(null)
    }
  }
  const saved = paths.filter((relative): relative is string => relative !== null)
  let inserted = false
  if (paths.length && isCurrent()) {
    try { inserted = insert(paths) } catch { /* The files remain available beside the original document. */ }
  }
  if (saved.length && !inserted) {
    statusRight.textContent = `图片已保存但未插入（${path} 同目录）：${saved.join('、')}`
  } else if (failed) {
    statusRight.textContent = missing
      ? '部分图片未保存，请检查图片来源、格式和文件夹权限'
      : '图片保存失败，请检查格式和文件夹写入权限'
  }
  return inserted && !failed
}

function startImagePaste(files: ClipboardImage[], insert: InsertPastedImages, missing = 0): Promise<boolean> {
  const pending = pasteImages(files, insert, missing).catch(() => {
    statusRight.textContent = '图片保存失败，请检查文件夹写入权限'
    return false
  })
  pendingImagePastes.add(pending)
  void pending.then(() => pendingImagePastes.delete(pending))
  return pending
}

async function openPath(path: string) {
  await editorReady
  await externalCheck
  if (conflictActive) return
  syncEditor()
  if (session.isDirty() || fileMissing) {
    await saveCurrent() // 单文件模型：打开前先保旧的
    if (session.isDirty() || fileMissing) return // 保存失败或保存过程中又有编辑，不能丢弃当前内容
  }
  try {
    const beforeRead = getMarkdown()
    const r = await session.open(path, () => !conflictActive && !pendingExternalChecks && getMarkdown() === beforeRead)
    setActiveDocumentPath(path)
    fileMissing = false
    watchFailed = false
    render()
    if (r.size > 5 * 1024 * 1024) {
      statusRight.textContent = '大文件，可能卡顿' // 瞬态提示，后续输入会被字数覆盖
    } else {
      renderWordCount(r.content)
    }
    displayMarkdown(r.content)
    focusEditor()
    if (inTauri) {
      void watchPath(path)
    }
  } catch (e) {
    syncEditor()
    const msg = e === 'NOT_UTF8' ? '文件不是 UTF-8 编码，无法打开'
      : e === 'OPEN_FAILED' ? '文件打开失败（已移动或无权限）'
      : e === 'UNSAVED_CHANGES' ? '读取期间内容发生变化，已取消切换'
      : `打开失败：${e}`
    statusLeft.dataset.status = 'error'
    statusLeft.textContent = msg
  }
}

function renderWordCount(markdown: string) {
  statusRight.textContent = `字数 ${markdown.replace(/\s+/g, '').length}`
}

async function handleExternalChange() {
  const path = session.getState().path
  if (!path) return
  await session.waitForSave()
  if (conflictActive) return
  try {
    const r = await invoke<OpenedFile>('open_file', { path })
    if (session.getState().path !== path || conflictActive) return
    const wasMissing = fileMissing
    fileMissing = false
    if (r.content === session.getSavedContent()) {
      if (wasMissing) render()
      return
    }
    syncEditor()
    if (!session.isDirty()) {
      session.reload(r.content)
      displayMarkdown(r.content)
      renderWordCount(r.content)
    } else {
      showConflict()
    }
  } catch (e) {
    if (session.getState().path !== path) return
    if (e === 'OPEN_FAILED') {
      fileMissing = true
      clearTimeout(autosaveTimer)
      clearTimeout(retryTimer)
      retryTimer = undefined
      statusLeft.dataset.status = 'error'
      statusLeft.textContent = '文件已被移动或删除'
    } else {
      syncEditor()
      showConflict(e === 'NOT_UTF8' ? '外部文件不是 UTF-8，无法读取：' : '无法读取外部文件：')
    }
  }
}

function queueExternalChange() {
  pendingExternalChecks += 1
  clearTimeout(autosaveTimer)
  externalCheck = externalCheck.then(handleExternalChange).finally(() => {
    pendingExternalChecks -= 1
    if (!pendingExternalChecks && !conflictActive && !fileMissing && session.isDirty() && session.getState().path) {
      autosaveTimer = setTimeout(() => void session.save(), 2000)
    }
  })
}

function showConflict(message = '文件已被外部修改：') {
  if (conflictActive) return
  conflictActive = true
  clearTimeout(autosaveTimer)
  clearTimeout(retryTimer)
  retryTimer = undefined
  statusLeft.dataset.status = 'conflict'
  statusLeft.textContent = message
  const overwrite = document.createElement('button')
  overwrite.textContent = '使用磁盘版本（丢弃当前修改）'
  const failure = document.createElement('span')
  overwrite.onclick = async () => {
    const path = session.getState().path!
    const beforeRead = getMarkdown()
    overwrite.disabled = true
    keep.disabled = true
    try {
      const r = await invoke<OpenedFile>('open_file', { path })
      if (!conflictActive || session.getState().path !== path || getMarkdown() !== beforeRead) return
      const needsWatch = imageDocumentPath !== path
      if (needsWatch) setActiveDocumentPath(path)
      session.reload(r.content) // notify 触发的 render 因 conflictActive 被跳过
      displayMarkdown(r.content)
      renderWordCount(r.content)
      conflictActive = false
      render() // 重写 textContent，冲突按钮随之移除
      if (needsWatch) await watchPath(path)
    } catch (e) {
      if (e === 'OPEN_FAILED') {
        conflictActive = false
        fileMissing = true
        render()
      } else {
        failure.textContent = ' 读取磁盘版本失败，请重试'
        statusLeft.append(failure)
      }
    } finally {
      overwrite.disabled = false
      keep.disabled = false
    }
  }
  const keep = document.createElement('button')
  keep.textContent = '保留当前内容（覆盖磁盘版本）'
  keep.onclick = () => {
    conflictActive = false
    render()
    void saveCurrent(true) // 尽快把本地版本写回磁盘，结束冲突态
  }
  statusLeft.append(overwrite, keep)
}

initEditor(editorEl, { onInput, resolveLocalImage: inTauri
  ? (documentPath, source) => invoke<string>('resolve_document_image', { documentPath, source })
  : undefined, onPasteImages: inTauri ? startImagePaste : undefined, onReady: () => {
  editorIsReady = true
  editorValue = getMarkdown()
  savedEditorValue = editorValue
  resolveEditorReady()
  focusEditor()
} })

if (inTauri) {
  // Ctrl+O 打开 / Ctrl+S 保存
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      void openFileDialog({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      }).then((p) => { if (p) void openPath(p) })
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void saveCurrent()
    }
  })
  // 拖拽 .md 到窗口即打开
  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop' && event.payload.paths[0]) {
      void openPath(event.payload.paths[0])
    }
  })
  // 外部变更：干净时静默重载，脏时内联冲突提示
  void listen<boolean>('file-changed', (event) => {
    queueExternalChange()
    const path = session.getState().path
    if (event.payload && path) void watchPath(path)
  })
  // 脏状态退出保护
  const win = getCurrentWindow()
  void win.onCloseRequested(async (event) => {
    if (conflictActive) {
      event.preventDefault()
      return
    }
    let waitedForImages = false
    while (pendingImagePastes.size) {
      event.preventDefault()
      waitedForImages = true
      const results = await Promise.all([...pendingImagePastes])
      if (conflictActive || results.some((result) => !result)) return
    }
    // onInput 有 undoDelay 延迟（Vditor 默认 800ms）：敲完立即关窗时 session 可能还没变脏，
    // 用编辑器当前内容与会话内容比对兜底，防止丢最后一秒的输入
    if (!fileMissing && !session.isDirty() && (!editorIsReady || getMarkdown() === editorValue)) {
      if (waitedForImages) await win.destroy()
      return
    }
    event.preventDefault()
    if (fileMissing && !session.isDirty()) {
      await saveCurrent()
      if (!fileMissing && !session.isDirty()) await win.destroy()
      return
    }
    const save = await ask('有未保存的修改，保存后退出吗？', {
      title: 'tide', kind: 'warning', okLabel: '保存并退出', cancelLabel: '取消',
    })
    if (save) {
      await saveCurrent()
      if (!conflictActive && !fileMissing && session.getState().status === 'clean') await win.destroy()
      // 保存失败则不退出，留在 error 状态（防抖自动保存会重试）
    }
  })
  render()

  // 启动参数带来的文件（双击 .md /「打开方式」/ 拖到图标）：应用启动时唯一的文件入口
  void invoke<string | null>('take_initial_file').then((p) => {
    if (p) void openPath(p)
  })
}
