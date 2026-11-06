import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const app = vi.hoisted(() => ({
  files: new Map<string, string>(),
  holdRead: null as Promise<void> | null,
  holdSave: null as Promise<void> | null,
  holdWatch: null as Promise<void> | null,
  holdSaveDialog: null as Promise<void> | null,
  holdAsk: null as Promise<void> | null,
  holdMessage: null as Promise<void> | null,
  holdImage: null as Promise<void> | null,
  failSave: false,
  failImage: false,
  failImageByte: null as number | null,
  images: new Map<string, number[]>(),
  sourceImages: new Map<string, number[]>(),
  imageCounter: 0,
  failWatch: false,
  invalidUtf8: false,
  savePath: null as string | null,
  saveDialogCalls: 0,
  confirm: true,
  questions: 0,
  closeAnswer: '保存并退出' as string,
  closeQuestions: 0,
  closeMessage: '',
  closeButtons: undefined as unknown,
  failMessage: false,
  editorText: '',
  imageDocumentPath: null as string | null,
  imagePathAtLastRender: null as string | null,
  normalizeOnSet: false,
  deferReady: false,
  editorReady: true,
  ready: undefined as (() => void) | undefined,
  input: undefined as ((value: string) => void) | undefined,
  paste: undefined as ((files: (File | { localSource: string })[], insert: (paths: (string | null)[]) => boolean, missing?: number) => Promise<void>) | undefined,
  drag: undefined as ((event: { payload: { type: string; paths: string[] } }) => void) | undefined,
  close: undefined as ((event: { preventDefault: () => void }) => Promise<void>) | undefined,
  keys: undefined as ((event: { ctrlKey: boolean; metaKey: boolean; key: string; preventDefault: () => void }) => void) | undefined,
  changed: undefined as (() => void) | undefined,
  linkChanged: undefined as (() => void) | undefined,
  themeStorage: new Map<string, string>(),
  storageArea: undefined as unknown,
  storageChanged: undefined as ((event: { key: string | null; storageArea: unknown }) => void) | undefined,
  nativeThemeChanged: undefined as ((event: { payload: 'light' | 'dark' }) => void) | undefined,
  watchCount: 0,
  statusLeft: undefined as { textContent: string; dataset: Record<string, string>; children: { textContent: string; onclick: (() => void) | null }[] } | undefined,
  statusRight: undefined as { textContent: string } | undefined,
  title: '',
  destroyed: false,
  startupFile: null as string | null,
  openLink: undefined as ((target: string) => Promise<void> | void) | undefined,
  opened: [] as string[],
  resolved: new Map<string, string>(),
  resolveCalls: [] as { documentPath: string | null; source: string }[],
  holdResolve: null as Promise<void> | null,
  failResolve: null as string | null,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: { path?: string; content?: string; expected?: string | null; expectedMissing?: boolean; documentPath?: string | null; source?: string }, options?: { headers: Record<string, string> }) => {
    if (command === 'resolve_markdown_link') {
      app.resolveCalls.push({ documentPath: args.documentPath ?? null, source: args.source! })
      if (app.holdResolve) await app.holdResolve
      if (app.failResolve) throw app.failResolve
      const resolved = app.resolved.get(`${args.documentPath ?? ''}|${args.source}`)
      if (!resolved) throw 'MARKDOWN_UNAVAILABLE'
      return resolved
    }
    if (command === 'open_file') {
      if (app.holdRead) await app.holdRead
      if (app.invalidUtf8) throw 'NOT_UTF8'
      const content = app.files.get(args.path!)
      if (content === undefined) throw 'OPEN_FAILED'
      return { name: args.path!.split(/[\\/]/).pop(), content, size: content.length }
    }
    if (command === 'save_file') {
      if (app.holdSave) await app.holdSave
      if (app.failSave) throw 'SAVE_FAILED'
      if (args.expectedMissing && app.files.has(args.path!)) throw 'FILE_CONFLICT'
      if (args.expected != null && app.files.get(args.path!) !== args.expected) throw 'FILE_CONFLICT'
      app.files.set(args.path!, args.content!)
    }
    if (command === 'watch_file') {
      app.watchCount += 1
      if (app.holdWatch) await app.holdWatch
      if (app.failWatch) throw 'WATCH_FAILED'
    }
    if (command === 'take_initial_file') {
      const path = app.startupFile
      app.startupFile = null // 只交付一次
      return path
    }
    if (command === 'save_pasted_image') {
      if (app.holdImage) await app.holdImage
      const bytes = Array.from(args as unknown as Uint8Array)
      if (app.failImage || bytes[0] === app.failImageByte) throw 'IMAGE_SAVE_FAILED'
      const path = `images/pasted-${++app.imageCounter}.${options!.headers['x-image-mime'] === 'image/jpeg' ? 'jpg' : 'png'}`
      app.images.set(`${decodeURIComponent(options!.headers['x-document-path'])}|${path}`, bytes)
      return path
    }
    if (command === 'copy_pasted_image') {
      const bytes = app.sourceImages.get(args.source!)
      if (!bytes) throw 'IMAGE_SAVE_FAILED'
      const path = `images/pasted-${++app.imageCounter}.png`
      app.images.set(`${args.documentPath}|${path}`, bytes)
      return path
    }
  },
}))
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: async (url: string) => { app.opened.push(url) },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, callback: (event: { payload: boolean }) => void) => {
    app.changed = () => callback({ payload: false })
    app.linkChanged = () => callback({ payload: true })
  },
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTitle: async (title: string) => { app.title = title },
    setTheme: async () => {},
    theme: async () => 'light',
    onThemeChanged: async (callback: typeof app.nativeThemeChanged) => { app.nativeThemeChanged = callback; return () => {} },
    onCloseRequested: async (callback: typeof app.close) => { app.close = callback },
    destroy: async () => { app.destroyed = true },
  }),
}))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (callback: typeof app.drag) => { app.drag = callback },
  }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: async () => null,
  save: async () => {
    app.saveDialogCalls += 1
    if (app.holdSaveDialog) await app.holdSaveDialog
    return app.savePath
  },
  ask: async () => { app.questions += 1; if (app.holdAsk) await app.holdAsk; return app.confirm },
  message: async (msg: string, options?: { buttons?: unknown }) => {
    app.closeQuestions += 1
    app.closeMessage = msg
    app.closeButtons = options?.buttons
    if (app.failMessage) throw 'DIALOG_FAILED'
    if (app.holdMessage) await app.holdMessage
    return app.closeAnswer
  },
}))
vi.mock('./editor', () => ({
  initEditor: (_element: unknown, callbacks: { onInput: (value: string) => void; onReady: () => void; onPasteImages?: typeof app.paste; onOpenLink?: typeof app.openLink }) => {
    app.input = callbacks.onInput
    app.paste = callbacks.onPasteImages
    app.openLink = callbacks.onOpenLink
    app.ready = () => { app.editorReady = true; callbacks.onReady() }
    if (!app.deferReady) app.ready()
  },
  setMarkdown: (value: string) => {
    if (app.editorReady) {
      app.editorText = app.normalizeOnSet && !value.endsWith('\n') ? `${value}\n` : value
      app.imagePathAtLastRender = app.imageDocumentPath
    }
  },
  setDocumentPath: (path: string | null) => { app.imageDocumentPath = path },
  getMarkdown: () => app.editorText,
  focusEditor: () => {},
}))

class FakeElement {
  dataset: Record<string, string> = {}
  children: FakeElement[] = []
  onclick: (() => void) | null = null
  attributes: Record<string, string> = {}
  handlers: Record<string, (event: { preventDefault: () => void }) => void> = {}
  private text = ''

  get textContent() { return this.text }
  set textContent(value: string) { this.text = value; this.children = [] }
  append(...children: FakeElement[]) { this.children.push(...children) }
  querySelectorAll() { return this.children }
  setAttribute(name: string, value: string) { this.attributes[name] = value }
  addEventListener(name: string, handler: (event: { preventDefault: () => void }) => void) { this.handlers[name] = handler }
}

let themeButtons: FakeElement[] = []
let documentRoot: FakeElement

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

async function drop(path: string) {
  app.drag!({ payload: { type: 'drop', paths: [path] } })
  await settle()
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  app.files = new Map([['C:/a.md', '# 原文'], ['C:/b.md', '# 另一个文件'], ['C:/c.md', '# 第三个文件']])
  app.imageDocumentPath = null
  app.imagePathAtLastRender = null
  app.failSave = false
  app.failWatch = false
  app.invalidUtf8 = false
  app.holdRead = null
  app.holdSave = null
  app.holdWatch = null
  app.holdSaveDialog = null
  app.holdAsk = null
  app.holdMessage = null
  app.holdImage = null
  app.failImage = false
  app.failImageByte = null
  app.images = new Map()
  app.sourceImages = new Map()
  app.imageCounter = 0
  app.savePath = null
  app.saveDialogCalls = 0
  app.confirm = true
  app.questions = 0
  app.closeAnswer = '保存并退出'
  app.closeQuestions = 0
  app.closeMessage = ''
  app.closeButtons = undefined
  app.failMessage = false
  app.editorText = ''
  app.normalizeOnSet = false
  app.deferReady = false
  app.editorReady = true
  app.title = ''
  app.destroyed = false
  app.watchCount = 0
  app.startupFile = null
  app.openLink = undefined
  app.opened = []
  app.resolved = new Map()
  app.resolveCalls = []
  app.holdResolve = null
  app.failResolve = null
  app.themeStorage = new Map()
  app.storageChanged = undefined
  app.nativeThemeChanged = undefined
  const elements = new Map([
    ['#status-left', new FakeElement()],
    ['#status-right', new FakeElement()],
    ['#theme-selector', new FakeElement()],
    ['#editor', new FakeElement()],
  ])
  documentRoot = new FakeElement()
  themeButtons = ['light', 'dark', 'system'].map((choice) => {
    const button = new FakeElement()
    button.dataset.themeChoice = choice
    return button
  })
  elements.get('#theme-selector')!.children = themeButtons
  app.statusLeft = elements.get('#status-left')
  app.statusRight = elements.get('#status-right')
  vi.stubGlobal('document', {
    documentElement: documentRoot,
    querySelector: (selector: string) => elements.get(selector),
    createElement: () => new FakeElement(),
  })
  const localStorage = {
    getItem: (key: string) => app.themeStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { app.themeStorage.set(key, value) },
  }
  app.storageArea = localStorage
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    localStorage,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    addEventListener: (name: string, callback: unknown) => {
      if (name === 'keydown') app.keys = callback as typeof app.keys
      if (name === 'storage') app.storageChanged = callback as typeof app.storageChanged
    },
  })
  await import('./main')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('桌面文件操作', () => {
  it('状态栏外观选择保持独立，字数和提示更新不会移除图标', () => {
    expect(themeButtons.map((button) => button.attributes['aria-pressed'])).toEqual(['false', 'false', 'true'])
    themeButtons[1].handlers.click({ preventDefault: () => {} })
    expect(documentRoot.dataset.theme).toBe('dark')
    app.statusRight!.textContent = '字数 8'
    expect(themeButtons.map((button) => button.attributes['aria-pressed'])).toEqual(['false', 'true', 'false'])
  })

  it('跨窗口偏好更新与 Windows 原生主题事件同步到状态栏和页面', async () => {
    expect(app.storageChanged).toBeDefined()
    app.themeStorage.set('tide-theme-preference', 'dark')
    app.storageChanged!({ key: 'other-key', storageArea: app.storageArea })
    app.storageChanged!({ key: 'tide-theme-preference', storageArea: {} })
    expect(themeButtons[2].attributes['aria-pressed']).toBe('true')
    app.storageChanged!({ key: 'tide-theme-preference', storageArea: app.storageArea })
    expect(documentRoot.dataset.theme).toBe('dark')
    expect(themeButtons[1].attributes['aria-pressed']).toBe('true')
    app.themeStorage.set('tide-theme-preference', 'system')
    app.storageChanged!({ key: 'tide-theme-preference', storageArea: app.storageArea })
    await settle()
    expect(app.nativeThemeChanged).toBeDefined()
    app.nativeThemeChanged!({ payload: 'dark' })
    expect(documentRoot.dataset.theme).toBe('dark')
    expect(themeButtons[2].attributes['aria-pressed']).toBe('true')
  })

  it('粘贴图片时保存到文档旁的 images 并插入相对路径', async () => {
    await drop('C:/a.md')
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as File
    const inserted: (string | null)[][] = []

    await app.paste!([image], (paths) => { inserted.push(paths); return true })

    expect(app.images.get('C:/a.md|images/pasted-1.png')).toEqual([1, 2, 3])
    expect(inserted).toEqual([['images/pasted-1.png']])
  })

  it('未命名文档粘贴图片时先保存文档', async () => {
    app.savePath = 'C:/中文 #/new.md'
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const inserted: (string | null)[][] = []

    await app.paste!([image], (paths) => { inserted.push(paths); return true })

    expect(app.files.has('C:/中文 #/new.md')).toBe(true)
    expect(app.images.get('C:/中文 #/new.md|images/pasted-1.png')).toEqual([4])
    expect(inserted).toEqual([['images/pasted-1.png']])
  })

  it('取消首次保存时不写入图片或插入路径', async () => {
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const inserted: (string | null)[][] = []

    await app.paste!([image], (paths) => { inserted.push(paths); return true })

    expect(app.images.size).toBe(0)
    expect(inserted).toEqual([])
  })

  it('图片写入失败时提示失败且不插入无效路径', async () => {
    await drop('C:/a.md')
    app.failImage = true
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const inserted: (string | null)[][] = []

    await app.paste!([image], (paths) => { inserted.push(paths); return true })

    expect(inserted).toEqual([[null]])
    expect(app.statusRight!.textContent).toContain('图片保存失败')
  })

  it('图片保存期间切换文档不会把旧图片插入新文档', async () => {
    await drop('C:/a.md')
    let release!: () => void
    app.holdImage = new Promise<void>((resolve) => { release = resolve })
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const inserted: (string | null)[][] = []
    const pending = app.paste!([image], (paths) => { inserted.push(paths); return true })
    await settle()
    await drop('C:/b.md')
    release()
    await pending

    expect(inserted).toEqual([])
    expect(app.editorText).toBe('# 另一个文件')
  })

  it('图片保存期间出现外部修改冲突时不再插入图片', async () => {
    await drop('C:/a.md')
    let release!: () => void
    app.holdImage = new Promise<void>((resolve) => { release = resolve })
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const inserted: (string | null)[][] = []
    const pending = app.paste!([image], (paths) => { inserted.push(paths); return true })
    await settle()
    app.editorText = '# 当前修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    release()
    await pending

    expect(inserted).toEqual([])
    expect(app.statusRight!.textContent).toContain('已保存但未插入')
  })

  it('关闭窗口会等待正在保存的图片并保存插入后的文档', async () => {
    await drop('C:/a.md')
    let release!: () => void
    app.holdImage = new Promise<void>((resolve) => { release = resolve })
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const pending = app.paste!([image], (paths) => {
      app.editorText += `\n![图片](${paths[0]})`
      return true
    })
    await settle()
    let prevented = false
    const closing = app.close!({ preventDefault: () => { prevented = true } })
    await settle()

    expect(prevented).toBe(true)
    expect(app.destroyed).toBe(false)
    release()
    await pending
    await closing
    expect(app.files.get('C:/a.md')).toContain('images/pasted-1.png')
    expect(app.destroyed).toBe(true)
  })

  it('多张图片中有一张失败时保留成功图片与原始顺序', async () => {
    await drop('C:/a.md')
    app.failImageByte = 1
    const first = { type: 'image/png', arrayBuffer: async () => new Uint8Array([1]).buffer } as File
    const second = { type: 'image/png', arrayBuffer: async () => new Uint8Array([2]).buffer } as File
    const inserted: (string | null)[][] = []

    await app.paste!([first, second], (paths) => { inserted.push(paths); return true })

    expect(inserted).toEqual([[null, 'images/pasted-1.png']])
    expect(app.statusRight!.textContent).toContain('图片保存失败')
  })

  it('复制图文剪贴板引用的本地图片到文档目录', async () => {
    await drop('C:/a.md')
    app.sourceImages.set('file:///C:/Temp/second.png', [7, 8])
    const inserted: (string | null)[][] = []

    await app.paste!([{ localSource: 'file:///C:/Temp/second.png' }], (paths) => { inserted.push(paths); return true })

    expect(app.images.get('C:/a.md|images/pasted-1.png')).toEqual([7, 8])
    expect(inserted).toEqual([['images/pasted-1.png']])
  })

  it('只有不可复制的图片链接时保留粘贴内容并提示', async () => {
    const inserted: (string | null)[][] = []

    await app.paste!([], (paths) => { inserted.push(paths); return true }, 2)

    expect(inserted).toEqual([[]])
    expect(app.files.has('C:/new.md')).toBe(false)
    expect(app.images.size).toBe(0)
    expect(app.statusRight!.textContent).toContain('未复制')
  })

  it('关闭期间图片保存失败时保留窗口以显示错误', async () => {
    await drop('C:/a.md')
    app.failImage = true
    let release!: () => void
    app.holdImage = new Promise<void>((resolve) => { release = resolve })
    const image = { type: 'image/png', arrayBuffer: async () => new Uint8Array([4]).buffer } as File
    const pending = app.paste!([image], () => true)
    await settle()
    const closing = app.close!({ preventDefault: () => {} })
    release()

    await pending
    await closing
    expect(app.destroyed).toBe(false)
    expect(app.statusRight!.textContent).toContain('图片保存失败')
  })

  it('打开和切换文档时使用当前文件作为图片的基准', async () => {
    await drop('C:/a.md')
    expect(app.imagePathAtLastRender).toBe('C:/a.md')
    await drop('C:/b.md')
    expect(app.imagePathAtLastRender).toBe('C:/b.md')
  })

  it('切换失败时保留原文档的图片基准', async () => {
    await drop('C:/a.md')
    app.editorText = '# 未保存'
    app.input!(app.editorText)
    app.failSave = true
    await drop('C:/b.md')
    expect(app.imageDocumentPath).toBe('C:/a.md')
  })

  it('新文档首次保存成功后启用所选路径作为图片基准', async () => {
    app.savePath = 'C:/new.md'
    app.editorText = '![图片](image.png)'
    app.input!(app.editorText)
    expect(app.imageDocumentPath).toBeNull()
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    expect(app.imageDocumentPath).toBe('C:/new.md')
  })

  it('新文档首次保存失败后只在重试成功时启用图片基准', async () => {
    app.savePath = 'C:/new.md'
    app.failSave = true
    app.editorText = '![图片](image.png)'
    app.input!(app.editorText)
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    expect(app.imageDocumentPath).toBeNull()

    app.failSave = false
    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(app.imageDocumentPath).toBe('C:/new.md')
    expect(app.files.get('C:/new.md')).toBe('![图片](image.png)')
  })

  it('新文档保存冲突后使用磁盘版本会启用图片基准和文件监视', async () => {
    app.savePath = 'C:/a.md'
    app.editorText = '![新图片](new.png)'
    app.input!(app.editorText)
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    expect(app.imageDocumentPath).toBeNull()
    expect(app.statusLeft!.children).toHaveLength(2)

    await app.statusLeft!.children[0].onclick!()
    await settle()
    expect(app.editorText).toBe('# 原文')
    expect(app.imagePathAtLastRender).toBe('C:/a.md')
    expect(app.watchCount).toBe(1)
  })

  it('外部重载后仍使用当前文件作为图片基准', async () => {
    await drop('C:/a.md')
    app.files.set('C:/a.md', '![外部图片](image.png)')
    app.changed!()
    await settle()
    expect(app.imagePathAtLastRender).toBe('C:/a.md')
    expect(app.editorText).toBe('![外部图片](image.png)')
  })

  it('启动参数带来的文件会在启动后直接打开', async () => {
    app.startupFile = 'C:/b.md'
    vi.resetModules()
    await import('./main')
    await settle()

    expect(app.title).toBe('b.md - tide')
    expect(app.statusRight!.textContent).toBe('字数 6')
    expect(app.statusLeft!.textContent).toBe('已保存')
  })

  it('打开文件后立即显示当前内容的字数', async () => {
    await drop('C:/a.md')
    expect(app.statusRight!.textContent).toBe('字数 3')
  })

  it('文件监视启动失败时提示用户外部更改无法检测', async () => {
    app.failWatch = true
    await drop('C:/a.md')
    expect(app.statusLeft!.textContent).toContain('无法监视')
  })

  it('载入时编辑器规范化换行不会导致关闭时改写原文件', async () => {
    app.normalizeOnSet = true
    await drop('C:/a.md')
    let prevented = false
    await app.close!({ preventDefault: () => { prevented = true } })

    expect(prevented).toBe(false)
    expect(app.questions).toBe(0)
    expect(app.files.get('C:/a.md')).toBe('# 原文')
  })

  it('撤销到载入时的规范化内容后恢复已保存状态', async () => {
    app.normalizeOnSet = true
    await drop('C:/a.md')
    app.editorText = '# 修改\n'
    app.input!(app.editorText)
    app.editorText = '# 原文\n'
    app.input!(app.editorText)
    let prevented = false
    await app.close!({ preventDefault: () => { prevented = true } })

    expect(prevented).toBe(false)
    expect(app.files.get('C:/a.md')).toBe('# 原文')
  })

  it('保存失败时切换文件会保留当前编辑内容', async () => {
    await drop('C:/a.md')
    app.editorText = '# 未保存的内容'
    app.input!(app.editorText)
    app.failSave = true
    await drop('C:/b.md')

    expect(app.editorText).toBe('# 未保存的内容')
    expect(app.files.get('C:/a.md')).toBe('# 原文')
    expect(app.title).toContain('a.md')
  })

  it('关闭前保存编辑器尚未触发回调的最后输入', async () => {
    await drop('C:/a.md')
    app.editorText = '# 最后输入'
    let prevented = false
    await app.close!({ preventDefault: () => { prevented = true } })

    expect(prevented).toBe(true)
    expect(app.files.get('C:/a.md')).toBe('# 最后输入')
    expect(app.destroyed).toBe(true)
  })

  it('切换文件前保存编辑器尚未触发回调的最后输入', async () => {
    await drop('C:/a.md')
    app.editorText = '# 最后输入'
    await drop('C:/b.md')

    expect(app.files.get('C:/a.md')).toBe('# 最后输入')
    expect(app.editorText).toBe('# 另一个文件')
  })

  it('切换前保存期间出现的新输入会阻止切换', async () => {
    await drop('C:/a.md')
    app.editorText = '# 第一版'
    app.input!(app.editorText)
    let finishSave!: () => void
    app.holdSave = new Promise<void>((resolve) => { finishSave = resolve })
    app.drag!({ payload: { type: 'drop', paths: ['C:/b.md'] } })
    await settle()
    app.editorText = '# 保存期间输入'
    app.holdSave = null
    finishSave()
    await settle()

    expect(app.editorText).toBe('# 保存期间输入')
    expect(app.title).toContain('a.md')
  })

  it('退出前保存期间出现的新输入会阻止关闭', async () => {
    await drop('C:/a.md')
    app.editorText = '# 第一版'
    app.input!(app.editorText)
    let finishSave!: () => void
    app.holdSave = new Promise<void>((resolve) => { finishSave = resolve })
    const closing = app.close!({ preventDefault: () => {} })
    await settle()
    app.editorText = '# 保存期间输入'
    app.holdSave = null
    finishSave()
    await closing

    expect(app.destroyed).toBe(false)
    expect(app.editorText).toBe('# 保存期间输入')
  })

  it('新文件保存后等待监视器时出现的新输入会阻止关闭', async () => {
    app.savePath = 'C:/new.md'
    app.editorText = '# 第一版'
    app.input!(app.editorText)
    let finishWatch!: () => void
    app.holdWatch = new Promise<void>((resolve) => { finishWatch = resolve })
    const closing = app.close!({ preventDefault: () => {} })
    await settle()
    app.editorText = '# 等待期间输入'
    app.holdWatch = null
    finishWatch()
    await closing

    expect(app.destroyed).toBe(false)
    expect(app.editorText).toBe('# 等待期间输入')
  })

  it('新文件读取期间继续输入不会被打开的文件覆盖', async () => {
    await drop('C:/a.md')
    let finishRead!: () => void
    app.holdRead = new Promise<void>((resolve) => { finishRead = resolve })
    app.drag!({ payload: { type: 'drop', paths: ['C:/b.md'] } })
    await settle()
    app.editorText = '# 读取期间输入'
    app.holdRead = null
    finishRead()
    await settle()

    expect(app.editorText).toBe('# 读取期间输入')
    expect(app.title).toContain('a.md')
  })

  it('编辑器初始化完成前打开的文件会在就绪后显示', async () => {
    vi.resetModules()
    app.deferReady = true
    app.editorReady = false
    await import('./main')
    await drop('C:/a.md')
    app.ready!()
    await settle()

    expect(app.editorText).toBe('# 原文')
  })

  it('未命名内容可通过 Ctrl+S 选择文件并保存', async () => {
    app.savePath = 'C:/new.md'
    app.editorText = '# 新文档'
    app.input!(app.editorText)
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()

    expect(app.files.get('C:/new.md')).toBe('# 新文档')
    expect(app.title).toContain('new.md')
  })

  it('保存对话框打开期间切换文件不会把新文件写入旧对话框选择的位置', async () => {
    app.savePath = 'C:/new.md'
    let finishDialog!: () => void
    app.holdSaveDialog = new Promise<void>((resolve) => { finishDialog = resolve })
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    await drop('C:/b.md')
    app.holdSaveDialog = null
    finishDialog()
    await settle()

    expect(app.title).toContain('b.md')
    expect(app.files.has('C:/new.md')).toBe(false)
    expect(app.editorText).toBe('# 另一个文件')
  })

  it('新文档首次保存到已存在的文件时保留原文件并提示冲突', async () => {
    app.savePath = 'C:/a.md'
    app.editorText = '# 新文档'
    app.input!(app.editorText)
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()

    expect(app.files.get('C:/a.md')).toBe('# 原文')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('打开后立刻发生的外部修改也会更新干净的编辑器', async () => {
    await drop('C:/a.md')
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()

    expect(app.editorText).toBe('# 外部修改')
  })

  it('监视器启动前发生的外部修改会在就绪后检查', async () => {
    let finishWatch!: () => void
    app.holdWatch = new Promise<void>((resolve) => { finishWatch = resolve })
    await drop('C:/a.md')
    app.files.set('C:/a.md', '# 监视器就绪前的修改')
    app.holdWatch = null
    finishWatch()
    await settle()

    expect(app.editorText).toBe('# 监视器就绪前的修改')
  })

  it('监视器启动期间不抢先自动保存，以免覆盖外部修改', async () => {
    let finishWatch!: () => void
    app.holdWatch = new Promise<void>((resolve) => { finishWatch = resolve })
    await drop('C:/a.md')
    app.files.set('C:/a.md', '# 外部修改')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    await vi.advanceTimersByTimeAsync(2500)
    expect(app.files.get('C:/a.md')).toBe('# 外部修改')
    app.holdWatch = null
    finishWatch()
    await settle()
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('符号链接指向变化时重新监视新的目标', async () => {
    await drop('C:/a.md')
    expect(app.watchCount).toBe(1)
    app.files.set('C:/a.md', '# 新目标内容')
    app.linkChanged!()
    await settle()

    expect(app.editorText).toBe('# 新目标内容')
    expect(app.watchCount).toBe(2)
  })

  it('外部修改发生时尚未触发回调的输入会保留并进入冲突状态', async () => {
    await drop('C:/a.md')
    app.editorText = '# 尚未通知的输入'
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()

    expect(app.editorText).toBe('# 尚未通知的输入')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('存在外部冲突时自动保存不会覆盖磁盘版本', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    expect(app.statusLeft!.children).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2500)
    expect(app.files.get('C:/a.md')).toBe('# 外部修改')
    expect(app.editorText).toBe('# 本地修改')
  })

  it('冲突选项说明各自会丢弃或覆盖哪份内容', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()

    const [useDisk, keepCurrent] = app.statusLeft!.children
    expect(useDisk.textContent).toContain('使用磁盘版本')
    expect(useDisk.textContent).toContain('丢弃当前修改')
    expect(keepCurrent.textContent).toContain('保留当前内容')
    expect(keepCurrent.textContent).toContain('覆盖磁盘版本')
  })

  it('外部变更仍在读取时不会抢先自动保存', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    let finishRead!: () => void
    app.holdRead = new Promise<void>((resolve) => { finishRead = resolve })
    app.changed!()
    await settle()
    await vi.advanceTimersByTimeAsync(2500)
    expect(app.files.get('C:/a.md')).toBe('# 外部修改')
    app.holdRead = null
    finishRead()
    await settle()
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('保存写入期间外部文件发生变化时不会覆盖外部版本', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    let finishSave!: () => void
    app.holdSave = new Promise<void>((resolve) => { finishSave = resolve })
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    app.holdSave = null
    finishSave()
    await settle()

    expect(app.files.get('C:/a.md')).toBe('# 外部修改')
    expect(app.editorText).toBe('# 本地修改')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('选择保留本地版本时包含尚未触发回调的最后输入', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.editorText = '# 最后输入'
    app.statusLeft!.children[1].onclick!()
    await settle()

    expect(app.files.get('C:/a.md')).toBe('# 最后输入')
  })

  it('冲突时选择保留已撤回到原文的本地版本会覆盖外部版本', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.editorText = '# 原文'
    app.input!(app.editorText)
    app.statusLeft!.children[1].onclick!()
    await settle()

    expect(app.files.get('C:/a.md')).toBe('# 原文')
  })

  it('尚未解决外部冲突时不能切换文件', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.editorText = '# 原文'
    app.input!(app.editorText)
    await drop('C:/b.md')

    expect(app.editorText).toBe('# 原文')
    expect(app.title).toContain('a.md')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('尚未解决外部冲突时即使本地内容已撤回也不会直接关闭', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.editorText = '# 原文'
    app.input!(app.editorText)
    let prevented = false
    await app.close!({ preventDefault: () => { prevented = true } })

    expect(prevented).toBe(true)
    expect(app.destroyed).toBe(false)
  })

  it('冲突未解决时再次收到外部修改不会覆盖撤回后的本地内容', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.editorText = '# 原文'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 再次外部修改')
    app.changed!()
    await settle()

    expect(app.editorText).toBe('# 原文')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('冲突期间磁盘文件被删除时选择磁盘版本会保留本地内容', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.files.delete('C:/a.md')
    await app.statusLeft!.children[0].onclick!()

    expect(app.editorText).toBe('# 本地修改')
    expect(app.statusLeft!.textContent).toContain('文件已被移动或删除')
  })

  it('外部删除文件后，自动保存不会未经确认重建文件', async () => {
    await drop('C:/a.md')
    app.files.delete('C:/a.md')
    app.changed!()
    await settle()
    app.editorText = '# 我的内容'
    app.input!(app.editorText)
    await vi.advanceTimersByTimeAsync(2500)
    expect(app.files.has('C:/a.md')).toBe(false)

    app.confirm = false
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    expect(app.questions).toBe(1)
    expect(app.files.has('C:/a.md')).toBe(false)

    app.confirm = true
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    expect(app.files.get('C:/a.md')).toBe('# 我的内容')
  })

  it('文件被外部删除后，即使本地没有修改也不会直接丢弃唯一副本', async () => {
    await drop('C:/a.md')
    app.files.delete('C:/a.md')
    app.changed!()
    await settle()
    app.confirm = false
    let prevented = false
    await app.close!({ preventDefault: () => { prevented = true } })

    expect(prevented).toBe(true)
    expect(app.questions).toBe(1)
    expect(app.destroyed).toBe(false)
    expect(app.editorText).toBe('# 原文')
  })

  it('确认重新创建期间若其他程序创建了文件，不会覆盖它', async () => {
    await drop('C:/a.md')
    app.files.delete('C:/a.md')
    app.changed!()
    await settle()
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    let answer!: () => void
    app.holdAsk = new Promise<void>((resolve) => { answer = resolve })
    app.keys!({ ctrlKey: true, metaKey: false, key: 's', preventDefault: () => {} })
    await settle()
    app.files.set('C:/a.md', '# 外部新建')
    app.holdAsk = null
    answer()
    await settle()

    expect(app.files.get('C:/a.md')).toBe('# 外部新建')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('外部文件变为非 UTF-8 时自动保存不会覆盖无法读取的内容', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '<非 UTF-8 数据>')
    app.invalidUtf8 = true
    app.changed!()
    await settle()
    await vi.advanceTimersByTimeAsync(2500)

    expect(app.files.get('C:/a.md')).toBe('<非 UTF-8 数据>')
    expect(app.statusLeft!.children.length).toBeGreaterThanOrEqual(2)
  })
})

describe('关闭与退出提示', () => {
  /** 忠实模拟 @tauri-apps/api/window 的包装器：handler 返回后若未 preventDefault 就销毁窗口。 */
  async function closeWithTauriWrapper() {
    let prevented = false
    const result = { prevented: false }
    await app.close!({ preventDefault: () => { prevented = true } })
    result.prevented = prevented
    if (!prevented) app.destroyed = true
    return result
  }

  it('退出提示提供保存、不保存与取消三个选项', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    app.closeAnswer = '取消'
    await closeWithTauriWrapper()

    expect(app.closeButtons).toEqual({ yes: '保存并退出', no: '不保存退出', cancel: '取消' })
  })

  it('取消退出后再次关闭仍会提示', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    app.closeAnswer = '取消'
    let release!: () => void
    app.holdMessage = new Promise<void>((resolve) => { release = resolve })
    const first = app.close!({ preventDefault: () => {} })
    await settle()
    // 用户读提示期间，2s 防抖自动保存不应把文档写盘
    await vi.advanceTimersByTimeAsync(3000)
    expect(app.files.get('C:/a.md')).toBe('# 原文')

    release()
    await first
    expect(app.destroyed).toBe(false)
    expect(app.closeQuestions).toBe(1)

    app.holdMessage = null
    app.closeAnswer = '取消'
    let prevented = false
    await app.close!({ preventDefault: () => { prevented = true } })

    expect(prevented).toBe(true)
    expect(app.destroyed).toBe(false)
    expect(app.closeQuestions).toBe(2)
  })

  it('取消后不再输入不会自动保存，重新输入后恢复', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    app.closeAnswer = '取消'
    await closeWithTauriWrapper()
    await vi.advanceTimersByTimeAsync(5000)

    expect(app.files.get('C:/a.md')).toBe('# 原文')

    app.editorText = '# 再次修改'
    app.input!(app.editorText)
    await vi.advanceTimersByTimeAsync(2100)

    expect(app.files.get('C:/a.md')).toBe('# 再次修改')
  })

  it('新文件可以选择不保存直接退出', async () => {
    app.editorText = '# 新内容'
    app.input!(app.editorText)
    app.closeAnswer = '不保存退出'
    const result = await closeWithTauriWrapper()

    expect(result.prevented).toBe(true)
    expect(app.destroyed).toBe(true)
    expect(app.files.has('C:/new.md')).toBe(false)
    expect(app.saveDialogCalls).toBe(0) // 不保存退出不得弹出保存对话框
  })

  it('新文件选择保存并退出时走保存对话框', async () => {
    app.savePath = 'C:/new.md'
    app.editorText = '# 新内容'
    app.input!(app.editorText)
    app.closeAnswer = '保存并退出'
    const result = await closeWithTauriWrapper()

    expect(app.files.get('C:/new.md')).toBe('# 新内容')
    expect(app.destroyed).toBe(true)
    expect(result.prevented).toBe(true)
    expect(app.saveDialogCalls).toBe(1)
  })

  it('新文件保存对话框被取消时窗口保持打开', async () => {
    app.savePath = null
    app.editorText = '# 新内容'
    app.input!(app.editorText)
    app.closeAnswer = '保存并退出'
    const result = await closeWithTauriWrapper()

    expect(app.destroyed).toBe(false)
    expect(result.prevented).toBe(true)
    expect(app.files.has('C:/new.md')).toBe(false)
    expect(app.saveDialogCalls).toBe(1)
  })

  it('提示期间重复关闭不会叠出第二个对话框', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    app.closeAnswer = '取消'
    let release!: () => void
    app.holdMessage = new Promise<void>((resolve) => { release = resolve })
    let prevented1 = false
    let prevented2 = false
    const first = app.close!({ preventDefault: () => { prevented1 = true } })
    await settle()
    const second = app.close!({ preventDefault: () => { prevented2 = true } })
    await settle()

    expect(app.closeQuestions).toBe(1)
    expect(prevented1).toBe(true)
    expect(prevented2).toBe(true)

    release()
    await first
    await second
  })

  it('保存失败时选择保存并退出不退出窗口', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    app.failSave = true
    app.closeAnswer = '保存并退出'
    const result = await closeWithTauriWrapper()

    expect(result.prevented).toBe(true)
    expect(app.destroyed).toBe(false)
    expect(app.statusLeft!.dataset.status).toBe('error')
  })

  it('关掉提示对话框等同于取消，不会退出', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    // 平台在点 X / 按 Esc 时返回 'Cancel'（未启用自定义按钮时的回落值）
    app.closeAnswer = 'Cancel'
    const result = await closeWithTauriWrapper()

    expect(result.prevented).toBe(true)
    expect(app.destroyed).toBe(false)
    expect(app.files.get('C:/a.md')).toBe('# 原文')
  })

  it('提示对话框自身失败时留在窗口而不是静默退出', async () => {
    await drop('C:/a.md')
    app.editorText = '# 修改'
    app.input!(app.editorText)
    app.failMessage = true
    const result = await closeWithTauriWrapper()

    expect(result.prevented).toBe(true)
    expect(app.destroyed).toBe(false)
    expect(app.files.get('C:/a.md')).toBe('# 原文')
  })
})

describe('打开链接', () => {
  it('网站与邮件链接只交给系统默认程序', async () => {
    await app.openLink!('https://example.com/a')
    await app.openLink!('mailto:user@example.com')
    await settle()

    expect(app.opened).toEqual(['https://example.com/a', 'mailto:user@example.com'])
    expect(app.resolveCalls).toEqual([])
  })

  it('不支持的地址不会被打开，并给出提示', async () => {
    await app.openLink!('javascript:alert(1)')
    await app.openLink!('docs/a.pdf')
    await settle()

    expect(app.opened).toEqual([])
    expect(app.resolveCalls).toEqual([])
    expect(app.statusRight!.textContent).toContain('无法打开')
  })

  it('本地 Markdown 链接以当前文件为基准解析并在当前窗口打开', async () => {
    await drop('C:/a.md')
    app.resolved.set('C:/a.md|docs/showcase.md', 'C:/docs/showcase.md')
    app.files.set('C:/docs/showcase.md', '# 示例文档')

    await app.openLink!('docs/showcase.md')
    await settle()

    expect(app.resolveCalls).toEqual([{ documentPath: 'C:/a.md', source: 'docs/showcase.md' }])
    expect(app.editorText).toBe('# 示例文档')
    expect(app.title).toBe('showcase.md - tide')
    expect(app.opened).toEqual([])
  })

  it('有未保存修改时先保存源文档再切换', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.resolved.set('C:/a.md|b.md', 'C:/b.md')

    await app.openLink!('b.md')
    await settle()

    expect(app.files.get('C:/a.md')).toBe('# 本地修改')
    expect(app.editorText).toBe('# 另一个文件')
  })

  it('保存失败时不切换文档', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.failSave = true
    app.resolved.set('C:/a.md|b.md', 'C:/b.md')

    await app.openLink!('b.md')
    await settle()

    expect(app.editorText).toBe('# 本地修改')
    expect(app.title).toContain('a.md')
    expect(app.files.get('C:/a.md')).toBe('# 原文')
  })

  it('存在外部冲突时不切换文档', async () => {
    await drop('C:/a.md')
    app.editorText = '# 本地修改'
    app.input!(app.editorText)
    app.files.set('C:/a.md', '# 外部修改')
    app.changed!()
    await settle()
    app.resolved.set('C:/a.md|b.md', 'C:/b.md')

    await app.openLink!('b.md')
    await settle()

    expect(app.editorText).toBe('# 本地修改')
    expect(app.statusLeft!.children).toHaveLength(2)
  })

  it('解析期间切换到其他文档时丢弃过时的结果', async () => {
    await drop('C:/a.md')
    let release!: () => void
    app.holdResolve = new Promise<void>((resolve) => { release = resolve })
    app.resolved.set('C:/a.md|c.md', 'C:/c.md')

    const pending = app.openLink!('c.md')
    await settle()
    await drop('C:/b.md')
    release()
    await pending

    expect(app.editorText).toBe('# 另一个文件')
    expect(app.title).toContain('b.md')
  })

  it('解析期间源文档被外部重载时丢弃结果', async () => {
    await drop('C:/a.md')
    let release!: () => void
    app.holdResolve = new Promise<void>((resolve) => { release = resolve })
    app.resolved.set('C:/a.md|c.md', 'C:/c.md')

    const pending = app.openLink!('c.md')
    await settle()
    app.files.set('C:/a.md', '# 外部重载')
    app.changed!()
    await settle()
    release()
    await pending

    expect(app.editorText).toBe('# 外部重载')
    expect(app.title).toContain('a.md')
  })

  it('未命名文档打开相对链接时提示先保存', async () => {
    app.editorText = '# 新文档'
    app.input!(app.editorText)
    app.failResolve = 'NO_DOCUMENT_PATH'

    await app.openLink!('docs/showcase.md')
    await settle()

    expect(app.resolveCalls).toEqual([{ documentPath: null, source: 'docs/showcase.md' }])
    expect(app.statusRight!.textContent).toContain('先保存')
    expect(app.editorText).toBe('# 新文档')
  })

  it('未命名文档的绝对链接触发首次保存后仍能打开目标', async () => {
    app.savePath = 'C:/new.md'
    app.editorText = '# 新文档'
    app.input!(app.editorText)
    app.resolved.set('|C:/docs/showcase.md', 'C:/docs/showcase.md')
    app.files.set('C:/docs/showcase.md', '# 示例文档')

    await app.openLink!('C:/docs/showcase.md')
    await settle()

    expect(app.files.get('C:/new.md')).toBe('# 新文档')
    expect(app.editorText).toBe('# 示例文档')
  })

  it('解析失败时保留原文与当前路径并提示', async () => {
    await drop('C:/a.md')
    app.failResolve = 'MARKDOWN_UNAVAILABLE'

    await app.openLink!('docs/missing.md')
    await settle()

    expect(app.editorText).toBe('# 原文')
    expect(app.title).toContain('a.md')
    expect(app.statusLeft!.textContent).toBe('已保存')
    expect(app.statusRight!.textContent).toContain('不存在')
  })

  it('没有 Tauri 时网站链接用浏览器打开，本地链接提示不可用', async () => {
    vi.resetModules()
    const opened: string[] = []
    vi.stubGlobal('window', {
      addEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      localStorage: { getItem: () => null, setItem: () => {} },
      open: (url: string) => { opened.push(url) },
    })
    await import('./main')

    await app.openLink!('https://example.com/a')
    await settle()
    expect(opened).toEqual(['https://example.com/a'])

    await app.openLink!('docs/showcase.md')
    await settle()
    expect(app.resolveCalls).toEqual([])
    expect(app.statusRight!.textContent).toContain('桌面')
  })
})
