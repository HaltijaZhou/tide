import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const app = vi.hoisted(() => ({
  files: new Map<string, string>(),
  holdRead: null as Promise<void> | null,
  holdSave: null as Promise<void> | null,
  holdWatch: null as Promise<void> | null,
  holdSaveDialog: null as Promise<void> | null,
  holdAsk: null as Promise<void> | null,
  failSave: false,
  failWatch: false,
  invalidUtf8: false,
  savePath: null as string | null,
  confirm: true,
  questions: 0,
  editorText: '',
  normalizeOnSet: false,
  deferReady: false,
  editorReady: true,
  ready: undefined as (() => void) | undefined,
  input: undefined as ((value: string) => void) | undefined,
  drag: undefined as ((event: { payload: { type: string; paths: string[] } }) => void) | undefined,
  close: undefined as ((event: { preventDefault: () => void }) => Promise<void>) | undefined,
  keys: undefined as ((event: { ctrlKey: boolean; metaKey: boolean; key: string; preventDefault: () => void }) => void) | undefined,
  changed: undefined as (() => void) | undefined,
  linkChanged: undefined as (() => void) | undefined,
  watchCount: 0,
  statusLeft: undefined as { textContent: string; children: { textContent: string; onclick: (() => void) | null }[] } | undefined,
  statusRight: undefined as { textContent: string } | undefined,
  title: '',
  destroyed: false,
  startupFile: null as string | null,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: { path?: string; content?: string; expected?: string | null; expectedMissing?: boolean }) => {
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
  },
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
  save: async () => { if (app.holdSaveDialog) await app.holdSaveDialog; return app.savePath },
  ask: async () => { app.questions += 1; if (app.holdAsk) await app.holdAsk; return app.confirm },
}))
vi.mock('./editor', () => ({
  initEditor: (_element: unknown, callbacks: { onInput: (value: string) => void; onReady: () => void }) => {
    app.input = callbacks.onInput
    app.ready = () => { app.editorReady = true; callbacks.onReady() }
    if (!app.deferReady) app.ready()
  },
  setMarkdown: (value: string) => {
    if (app.editorReady) app.editorText = app.normalizeOnSet && !value.endsWith('\n') ? `${value}\n` : value
  },
  getMarkdown: () => app.editorText,
  focusEditor: () => {},
}))

class FakeElement {
  dataset: Record<string, string> = {}
  children: FakeElement[] = []
  onclick: (() => void) | null = null
  private text = ''

  get textContent() { return this.text }
  set textContent(value: string) { this.text = value; this.children = [] }
  append(...children: FakeElement[]) { this.children.push(...children) }
}

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
  app.files = new Map([['C:/a.md', '# 原文'], ['C:/b.md', '# 另一个文件']])
  app.failSave = false
  app.failWatch = false
  app.invalidUtf8 = false
  app.holdRead = null
  app.holdSave = null
  app.holdWatch = null
  app.holdSaveDialog = null
  app.holdAsk = null
  app.savePath = null
  app.confirm = true
  app.questions = 0
  app.editorText = ''
  app.normalizeOnSet = false
  app.deferReady = false
  app.editorReady = true
  app.title = ''
  app.destroyed = false
  app.watchCount = 0
  app.startupFile = null
  const elements = new Map([
    ['#status-left', new FakeElement()],
    ['#status-right', new FakeElement()],
    ['#editor', new FakeElement()],
  ])
  app.statusLeft = elements.get('#status-left')
  app.statusRight = elements.get('#status-right')
  vi.stubGlobal('document', {
    querySelector: (selector: string) => elements.get(selector),
    createElement: () => new FakeElement(),
  })
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: {},
    addEventListener: (_name: string, callback: typeof app.keys) => { app.keys = callback },
  })
  await import('./main')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('桌面文件操作', () => {
  it('启动参数带来的文件会在启动后直接打开', async () => {
    app.startupFile = 'C:/b.md'
    vi.resetModules()
    await import('./main')
    await settle()

    expect(app.title).toBe('b.md - oh-my-mark')
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
