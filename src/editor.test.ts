import { afterEach, expect, it, vi } from 'vitest'

const editor = vi.hoisted(() => ({
  calls: [] as { value: string; clearStack?: boolean }[],
  options: [] as { preview: { hljs?: { style: string } }; after: () => void }[],
  themes: [] as [string, string | undefined, string | undefined][],
  inserted: [] as string[],
  value: '',
  toMarkdown: null as ((html: string) => string) | null,
  toolbar: {} as Record<string, unknown>,
  lute: undefined as undefined | { Md2HTML: (markdown: string) => string },
  ir: undefined as undefined | { element: unknown },
  afterInsert: undefined as undefined | (() => void),
  context: undefined as undefined | {
    applyFormat: (action: string, range: Range) => void
    linkSource: (link: HTMLElement) => string | undefined
  },
}))

vi.mock('vditor', () => ({
  default: class {
    vditor = { toolbar: { elements: editor.toolbar }, lute: editor.lute, ir: editor.ir }
    constructor(_container: unknown, options: { preview: { hljs?: { style: string } }; after: () => void }) { editor.options.push(options) }
    setValue(value: string, clearStack?: boolean) { editor.calls.push({ value, clearStack }) }
    getValue() { return editor.value }
    focus() {}
    insertMD(value: string) { editor.inserted.push(value); editor.afterInsert?.() }
    html2md(value: string) { return editor.toMarkdown?.(value) ?? value }
    setTheme(theme: string, contentTheme?: string, codeTheme?: string) { editor.themes.push([theme, contentTheme, codeTheme]) }
  },
}))
vi.mock('./details', () => ({ installDetailsFolding: () => () => {} }))
vi.mock('./context-menu', () => ({ installContextMenu: (_container: unknown, callbacks: typeof editor.context) => {
  editor.context = callbacks
  return () => {}
} }))

afterEach(() => {
  editor.options = []
  editor.themes = []
  editor.inserted = []
  editor.value = ''
  editor.toMarkdown = null
  editor.toolbar = {}
  editor.lute = undefined
  editor.ir = undefined
  editor.afterInsert = undefined
  editor.context = undefined
  vi.unstubAllGlobals()
})

it('载入文档时清除旧文档的撤销历史', async () => {
  editor.calls = []
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor, setMarkdown } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  setMarkdown('# 新文件')

  expect(editor.calls).toEqual([{ value: '# 新文件', clearStack: true }])
})

it('准备右键格式命令时不占用 Ctrl+O 打开文件快捷键', async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  const options = editor.options[0] as unknown as { toolbar: Array<{ name: string; hotkey?: string }> }
  const orderedList = options.toolbar.find((item) => item.name === 'ordered-list')

  expect(orderedList).toBeDefined()
  expect(orderedList?.hotkey).toBe('')
})

it('格式化含 HTML 字面量的选区时使用安全的 Markdown 路径', async () => {
  vi.stubGlobal('Node', { TEXT_NODE: 3 })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const click = vi.fn()
  const button = { click, classList: { toggle() {}, remove() {}, contains: () => false } }
  editor.toolbar = { bold: { firstElementChild: button } }
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  editor.options[0].after()
  const range = { startContainer: { nodeType: 3, parentElement: { closest: () => null } },
    toString: () => '<img src=x> & 原文' } as unknown as Range

  editor.context!.applyFormat('bold', range)

  expect(editor.inserted).toEqual(['**&lt;img src=x&gt; &amp; 原文**'])
  expect(click).not.toHaveBeenCalled()
})

it('安全格式化后继续选中新生成的文字', async () => {
  vi.stubGlobal('Node', { TEXT_NODE: 3 })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const selectedNode = { textContent: '<原文> & 文字' }
  let inserted = false
  let selected: unknown
  const restoredRange = { selectNodeContents: (node: unknown) => { selected = node } }
  const selection = { removeAllRanges() {}, addRange: vi.fn() }
  const root = { ownerDocument: { createRange: () => restoredRange, getSelection: () => selection },
    querySelectorAll: () => inserted ? [selectedNode] : [] }
  editor.ir = { element: root }
  editor.afterInsert = () => { inserted = true }
  editor.toolbar = { bold: { firstElementChild: { click() {}, classList: { toggle() {}, remove() {}, contains: () => false } } } }
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  editor.options[0].after()
  const range = { startContainer: { nodeType: 3, parentElement: { closest: () => null } },
    toString: () => '<原文> & 文字' } as unknown as Range

  editor.context!.applyFormat('bold', range)

  expect(selected).toBe(selectedNode)
  expect(selection.addRange).toHaveBeenCalledWith(restoredRange)
})

it('对含实体的已选文字继续加格式时不复制隐藏源码', async () => {
  vi.stubGlobal('Node', { TEXT_NODE: 3 })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  let removed = false
  const fragment = { querySelectorAll: () => [{ remove: () => { removed = true } }],
    get textContent() { return removed ? 'a & b' : 'a &amp;& b' } }
  const range = { startContainer: { nodeType: 3, parentElement: { closest: () => null } },
    toString: () => 'a &amp;& b', cloneContents: () => fragment } as unknown as Range
  editor.toolbar = { italic: { firstElementChild: { click() {}, classList: { toggle() {}, remove() {}, contains: () => false } } } }
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  editor.options[0].after()

  editor.context!.applyFormat('italic', range)

  expect(editor.inserted).toEqual(['*a &amp; b*'])
})

it('特殊字符选区首尾有空格时保留空格并只格式化文字', async () => {
  vi.stubGlobal('Node', { TEXT_NODE: 3 })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const selection = { removeAllRanges() {}, addRange: vi.fn() }
  const doc = { getSelection: () => selection }
  const node = { nodeType: 3, parentElement: { closest: () => null }, ownerDocument: doc }
  const adjusted = { setStart: vi.fn(), setEnd: vi.fn() }
  const range = { startContainer: node, endContainer: node, startOffset: 0, endOffset: 10,
    cloneRange: () => adjusted, toString: () => ' <x> & a  ' } as unknown as Range
  editor.toolbar = { bold: { firstElementChild: { click() {}, classList: { toggle() {}, remove() {}, contains: () => false } } } }
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  editor.options[0].after()

  editor.context!.applyFormat('bold', range)

  expect(adjusted.setStart).toHaveBeenCalledWith(node, 1)
  expect(adjusted.setEnd).toHaveBeenCalledWith(node, 8)
  expect(editor.inserted).toEqual(['**&lt;x&gt; &amp; a**'])
})

it('显示文字相同的引用链接按各自位置获取正确地址', async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  let urls = ['https://example.com/a', 'https://example.com/a']
  let footnotes = false
  const anchors = () => [
    ...urls.map((url) => ({ textContent: '同名', hasAttribute: () => true, getAttribute: () => url,
      classList: { contains: () => false }, closest: () => null })),
    ...(footnotes ? [
      { textContent: '1', hasAttribute: () => true, getAttribute: () => '#footnotes-def-1',
        classList: { contains: () => false }, closest: () => ({}) },
      { textContent: '↩', hasAttribute: () => true, getAttribute: () => '#footnotes-ref-1',
        classList: { contains: () => true }, closest: () => null },
    ] : []),
  ]
  vi.stubGlobal('document', { createElement: () => ({ innerHTML: '', content: { querySelectorAll: anchors } }) })
  editor.lute = { Md2HTML: () => '<p>引用链接</p>' }
  const link = {
    dataset: { type: 'link-ref' }, getAttribute: () => null,
    children: [{ classList: { contains: () => false }, textContent: '同名' }],
  } as unknown as HTMLElement
  const other = { ...link } as unknown as HTMLElement
  const container = { contains: () => true, querySelectorAll: () => [link, other] } as unknown as HTMLElement
  const { initEditor } = await import('./editor')
  initEditor(container, { onInput: () => {}, onReady: () => {} })
  editor.options[0].after()

  expect(editor.context!.linkSource(link)).toBe('https://example.com/a')
  urls = ['https://example.com/a', 'https://example.com/b']
  expect(editor.context!.linkSource(link)).toBe('https://example.com/a')
  expect(editor.context!.linkSource(other)).toBe('https://example.com/b')
  footnotes = true
  expect(editor.context!.linkSource(link)).toBe('https://example.com/a')
  expect(editor.context!.linkSource(other)).toBe('https://example.com/b')
})

it('深色启动时使用离线的深色代码高亮主题', async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener: () => {} }) })
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })

  expect(editor.options[0].preview.hljs?.style).toBe('github-dark')
})

it('系统明暗切换时同步切换外壳、正文和代码高亮主题', async () => {
  let onChange = () => {}
  const media = {
    matches: false,
    addEventListener: (_name: string, callback: () => void) => { onChange = callback },
  }
  vi.stubGlobal('window', { matchMedia: () => media })
  const { initEditor } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  editor.options[0].after()

  media.matches = true
  onChange()
  media.matches = false
  onChange()

  expect(editor.themes).toEqual([
    ['dark', 'dark', 'github-dark'],
    ['classic', 'light', 'github'],
  ])
})

it('初始化期间主题变化会等编辑器就绪后应用最新配色', async () => {
  let onChange = () => {}
  const media = {
    matches: false,
    addEventListener: (_name: string, callback: () => void) => { onChange = callback },
  }
  vi.stubGlobal('window', { matchMedia: () => media })
  const { initEditor } = await import('./editor')
  const onReady = vi.fn()
  initEditor({} as HTMLElement, { onInput: () => {}, onReady })

  media.matches = true
  onChange()
  expect(editor.themes).toEqual([])

  editor.options[0].after()
  expect(editor.themes).toEqual([['dark', 'dark', 'github-dark']])
  expect(onReady).toHaveBeenCalledOnce()
})

it('图片粘贴由应用接管，避免默认的 Base64 粘贴', async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor } = await import('./editor')
  const container = new EventTarget()
  const image = { name: 'screenshot.png', type: 'image/png' } as File
  const onPasteImages = vi.fn()
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {}, onPasteImages })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [image], items: [] } })

  container.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
  expect(onPasteImages.mock.calls[0]?.[0]).toEqual([image])
})

it('图文混合粘贴时保留文字并将图片地址替换为保存后的相对路径', async () => {
  editor.toMarkdown = (html) => html
  vi.stubGlobal('Lute', { Sanitize: (html: string) => html })
  class FakeParser {
    parseFromString(html: string) {
      const body = {
        innerHTML: html,
        querySelectorAll: () => [{ setAttribute: (_name: string, value: string) => {
          body.innerHTML = body.innerHTML.replace('data:image/png;base64,AAAA', value)
        }, remove: () => { body.innerHTML = body.innerHTML.replace('<img alt="图" src="data:image/png;base64,AAAA">', '') } }],
      }
      return { body }
    }
  }
  vi.stubGlobal('DOMParser', FakeParser)
  const node = {} as Node
  const range = { startContainer: node, endContainer: node, cloneRange() { return this } }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    getSelection: () => selection,
  })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === node
  const image = { name: 'screenshot.png', type: 'image/png' } as File
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, {
    onInput: () => {}, onReady: () => {}, onPasteImages: (_files, callback) => { insert = callback },
  })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [image], items: [], getData: () => '<p>前文 <img alt="图" src="data:image/png;base64,AAAA"> 后文</p>',
  } })
  container.dispatchEvent(event)

  expect(insert(['images/saved.png'])).toBe(true)
  expect(editor.inserted[0]).toContain('前文')
  expect(editor.inserted[0]).toContain('后文')
  expect(editor.inserted[0]).toContain('images/saved.png')
  expect(editor.inserted[0]).not.toContain('data:image')
  expect(insert([null])).toBe(true)
  expect(editor.inserted[1]).toContain('前文')
  expect(editor.inserted[1]).toContain('后文')
  expect(editor.inserted[1]).toContain('data:image/png;base64,AAAA')
})

it('剪贴板只有 HTML 内嵌图片时也将图片交给应用保存', async () => {
  const source = 'data:image/png;base64,AQID'
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      return { body: { querySelectorAll: () => [{ getAttribute: () => source }] } }
    }
  })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor } = await import('./editor')
  const container = new EventTarget()
  const onPasteImages = vi.fn()
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {}, onPasteImages })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [], items: [], getData: () => `<img src="${source}">`,
  } })

  container.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
  const file = onPasteImages.mock.calls[0][0][0] as File
  expect(file.type).toBe('image/png')
  expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3])
})

it('根据文件扩展名识别剪贴板中没有 MIME 类型的图片', async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor } = await import('./editor')
  const container = new EventTarget()
  const image = { name: 'photo.PNG', type: '' } as File
  const onPasteImages = vi.fn()
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {}, onPasteImages })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [image], items: [] } })

  container.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
  expect(onPasteImages.mock.calls[0][0]).toEqual([image])
})

it('从图文剪贴板的 RTF 数据中提取图片，避免依赖临时文件地址', async () => {
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      return { body: { querySelectorAll: () => [{ getAttribute: () => 'file:///C:/Temp/image.png' }] } }
    }
  })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor } = await import('./editor')
  const container = new EventTarget()
  const onPasteImages = vi.fn()
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {}, onPasteImages })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [], items: [], getData: (type: string) => type === 'text/html'
      ? '<p>图文<img src="file:///C:/Temp/image.png"></p>'
      : '{\\rtf1{\\pict\\pngblip\\picw1\\pich1\\bliptag-12{\\*\\blipuid abcdef} 010203}}',
  } })

  container.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
  const image = onPasteImages.mock.calls[0][0][0] as File
  expect(image.type).toBe('image/png')
  expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([1, 2, 3])
})

it('图片保存期间其他位置有新输入时，仍可插入到原来有效的位置', async () => {
  const node = {} as Node
  const range = { startContainer: node, endContainer: node, cloneRange() { return this }, toString: () => '' }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), getSelection: () => selection })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === node
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, {
    onInput: () => {}, onReady: () => {}, onPasteImages: (_files, callback) => { insert = callback },
  })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [{ name: 'a.png', type: 'image/png' }], items: [] } })
  container.dispatchEvent(event)
  editor.value = '其他位置的新文字'

  expect(insert(['images/saved.png'])).toBe(true)
  expect(editor.inserted[0]).toContain('images/saved.png')
})

it('图片保存期间光标移到其他位置时保留新的光标位置', async () => {
  const first = {} as Node
  const second = {} as Node
  const initial = { startContainer: first, endContainer: first, startOffset: 0, endOffset: 0, cloneRange() { return this }, toString: () => '' }
  const moved = { startContainer: second, endContainer: second, startOffset: 1, endOffset: 1, cloneRange() { return this }, toString: () => '' }
  const selection = {
    rangeCount: 1, current: initial, getRangeAt() { return this.current },
    removeAllRanges() {}, addRange(range: typeof initial) { this.current = range },
  }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), getSelection: () => selection })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === first || candidate === second
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, {
    onInput: () => {}, onReady: () => {}, onPasteImages: (_files, callback) => { insert = callback },
  })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [{ name: 'a.png', type: 'image/png' }], items: [] } })
  container.dispatchEvent(event)
  selection.current = moved

  expect(insert(['images/saved.png'])).toBe(true)
  expect(selection.current).toBe(moved)
})

it('纯文字和图片一起粘贴时保留文字', async () => {
  const node = {} as Node
  const range = { startContainer: node, endContainer: node, cloneRange() { return this }, toString: () => '' }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), getSelection: () => selection })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === node
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, {
    onInput: () => {}, onReady: () => {}, onPasteImages: (_files, callback) => { insert = callback },
  })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [{ name: 'a.png', type: 'image/png' }], items: [],
    getData: (type: string) => type === 'text/plain' ? '图片说明' : '',
  } })
  container.dispatchEvent(event)

  expect(insert(['images/saved.png'])).toBe(true)
  expect(editor.inserted[0]).toContain('图片说明')
  expect(editor.inserted[0]).toContain('images/saved.png')
})

it('图文包含内嵌图片和本地图片时分别保存并替换两个地址', async () => {
  const sources = ['data:image/png;base64,AQ==', 'file:///C:/Temp/second.png']
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      const current = [...sources]
      return { body: {
        querySelectorAll: () => current.map((_source, index) => ({
          getAttribute: () => current[index], setAttribute: (_name: string, value: string) => { current[index] = value },
        })),
        get innerHTML() { return `<p>说明<img src="${current[0]}"><img src="${current[1]}"></p>` },
      } }
    }
  })
  vi.stubGlobal('Lute', { Sanitize: (html: string) => html })
  editor.toMarkdown = (html) => html
  const node = {} as Node
  const range = { startContainer: node, endContainer: node, cloneRange() { return this }, toString: () => '' }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), getSelection: () => selection })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === node
  let pasted: unknown[] = []
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {},
    onPasteImages: (files, callback) => { pasted = files; insert = callback } })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [new File([new Uint8Array([1])], 'one.png', { type: 'image/png' })], items: [],
    getData: (type: string) => type === 'text/html' ? '<p>图片</p>' : '',
  } })
  container.dispatchEvent(event)

  expect(pasted).toHaveLength(2)
  expect((pasted[0] as File).type).toBe('image/png')
  expect(pasted[1]).toEqual({ localSource: 'file:///C:/Temp/second.png' })
  expect(insert(['images/first.png', 'images/second.png'])).toBe(true)
  expect(editor.inserted[0]).toContain('images/first.png')
  expect(editor.inserted[0]).toContain('images/second.png')
  expect(editor.inserted[0]).not.toContain('data:image')
  expect(editor.inserted[0]).not.toContain('file:///')
})

it('无法确定多图与剪贴板文件的对应关系时保留原文且不重复插图', async () => {
  const html = '<p>说明<img src="https://example.test/1.png"><img src="https://example.test/2.png"></p>'
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      return { body: { innerHTML: html, querySelectorAll: () => [
        { getAttribute: () => 'https://example.test/1.png' },
        { getAttribute: () => 'https://example.test/2.png' },
      ] } }
    }
  })
  vi.stubGlobal('Lute', { Sanitize: (value: string) => value })
  editor.toMarkdown = (value) => value
  const node = {} as Node
  const range = { startContainer: node, endContainer: node, cloneRange() { return this }, toString: () => '' }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), getSelection: () => selection })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === node
  let pasted: unknown[] = []
  let missing = 0
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {},
    onPasteImages: (files, callback, count) => { pasted = files; insert = callback; missing = count } })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [new File([new Uint8Array([1])], 'one.png', { type: 'image/png' })], items: [],
    getData: (type: string) => type === 'text/html' ? html : '',
  } })
  container.dispatchEvent(event)

  expect(pasted).toEqual([])
  expect(missing).toBe(2)
  expect(insert([])).toBe(true)
  expect(editor.inserted[0]).toBe(html)
})

it('多图中可按文件名确定对应关系时，同时保存文件和内嵌图片', async () => {
  const sources = ['https://example.test/a.png', 'data:image/png;base64,AQID']
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      const current = [...sources]
      return { body: {
        querySelectorAll: () => current.map((_source, index) => ({
          getAttribute: () => current[index], setAttribute: (_name: string, value: string) => { current[index] = value },
        })),
        get innerHTML() { return `<img src="${current[0]}"><img src="${current[1]}">` },
      } }
    }
  })
  vi.stubGlobal('Lute', { Sanitize: (value: string) => value })
  editor.toMarkdown = (value) => value
  const node = {} as Node
  const range = { startContainer: node, endContainer: node, cloneRange() { return this }, toString: () => '' }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), getSelection: () => selection })
  const { initEditor } = await import('./editor')
  const container = new EventTarget() as EventTarget & { contains: (node: Node) => boolean }
  container.contains = (candidate) => candidate === node
  const direct = new File([new Uint8Array([9])], 'a.png', { type: 'image/png' })
  let pasted: unknown[] = []
  let missing = 0
  let insert!: (paths: (string | null)[]) => boolean
  initEditor(container as unknown as HTMLElement, { onInput: () => {}, onReady: () => {},
    onPasteImages: (files, callback, count) => { pasted = files; insert = callback; missing = count } })
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    files: [direct], items: [], getData: (type: string) => type === 'text/html' ? '<img>' : '',
  } })
  container.dispatchEvent(event)

  expect(pasted).toHaveLength(2)
  expect(pasted).toContain(direct)
  expect(missing).toBe(0)
  expect(insert(['images/inline.png', 'images/direct.png'])).toBe(true)
  expect(editor.inserted[0]).toBe('<img src="images/direct.png"><img src="images/inline.png">')
})
