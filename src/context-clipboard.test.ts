import { afterEach, expect, it, vi } from 'vitest'
import { captureSelection, cutContextSelection, dispatchContextPaste, readContextClipboard, requiresNativePaste, selectionIsCurrent } from './context-clipboard'

afterEach(() => vi.unstubAllGlobals())

it('读取右键粘贴时保留同一剪贴板里的文字、HTML 和图片', async () => {
  const data = new Map([
    ['text/plain', new Blob(['说明'], { type: 'text/plain' })],
    ['text/html', new Blob(['<p>说明<img src="file:///photo.png"></p>'], { type: 'text/html' })],
    ['image/png', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })],
  ])
  const clipboard = { read: async () => [{
    types: [...data.keys()], presentationStyle: 'unspecified' as const,
    getType: async (type: string) => data.get(type)!,
  }] }
  const result = await readContextClipboard(clipboard)

  expect(result.text).toBe('说明')
  expect(result.html).toBe('<p>说明<img src="file:///photo.png"></p>')
  expect(result.images).toHaveLength(1)
  expect(result.images[0].type).toBe('image/png')
  expect([...new Uint8Array(await result.images[0].arrayBuffer())]).toEqual([1, 2, 3])
})

it('一个剪贴板项目提供多种图片格式时只粘贴一张图片', async () => {
  const png = new Blob([new Uint8Array([7])], { type: 'image/png' })
  const jpeg = new Blob([new Uint8Array([8])], { type: 'image/jpeg' })
  const clipboard = { read: async () => [{
    types: ['image/png', 'image/jpeg'], presentationStyle: 'unspecified' as const,
    getType: async (type: string) => type === 'image/png' ? png : jpeg,
  }] }

  const result = await readContextClipboard(clipboard)
  expect(result.images).toHaveLength(1)
  expect(result.images[0].type).toBe('image/png')
})

it('右键粘贴把图文数据交给现有的 paste 事件处理链', async () => {
  class Transfer {
    values = new Map<string, string>()
    files: File[] = []
    items = { add: (file: File) => this.files.push(file) }
    setData(type: string, value: string) { this.values.set(type, value) }
    getData(type: string) { return this.values.get(type) ?? '' }
  }
  class PasteEvent extends Event {
    clipboardData: Transfer
    constructor(type: string, options: EventInit & { clipboardData: Transfer }) {
      super(type, options)
      this.clipboardData = options.clipboardData
    }
  }
  vi.stubGlobal('DataTransfer', Transfer)
  vi.stubGlobal('ClipboardEvent', PasteEvent)
  const editor = new EventTarget()
  let received: PasteEvent | undefined
  editor.addEventListener('paste', (event) => { received = event as PasteEvent; event.preventDefault() })
  const image = new File([new Uint8Array([5])], 'photo.png', { type: 'image/png' })

  dispatchContextPaste(editor, { text: '说明', html: '<p>说明<img></p>', rtf: '{\\rtf1}', images: [image] })

  expect(received?.clipboardData.getData('text/plain')).toBe('说明')
  expect(received?.clipboardData.getData('text/html')).toBe('<p>说明<img></p>')
  expect(received?.clipboardData.getData('text/rtf')).toBe('{\\rtf1}')
  expect(received?.clipboardData.files).toEqual([image])
  expect(received?.defaultPrevented).toBe(true)
})

it('读取剪贴板期间用户移动光标后，不再使用原位置粘贴', async () => {
  const node = {} as Node
  const range = {
    startContainer: node, startOffset: 3, endContainer: node, endOffset: 5,
    cloneRange() { return this }, toString() { return '文字' },
  } as Range
  const snapshot = captureSelection(range)
  const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection
  expect(selectionIsCurrent(snapshot, selection)).toBe(true)

  const moved = { ...range, startOffset: 8, endOffset: 8, toString: () => '' } as Range
  const movedSelection = { rangeCount: 1, getRangeAt: () => moved } as unknown as Selection
  expect(selectionIsCurrent(snapshot, movedSelection)).toBe(false)
})

it('剪切先复制，复制失败时不能删除原文', async () => {
  const commands: string[] = []
  const document = { execCommand: (command: string) => { commands.push(command); return true } }
  expect(cutContextSelection(document)).toBe(true)
  expect(commands).toEqual(['copy', 'delete'])

  const rejected: string[] = []
  const blocked = { execCommand: (command: string) => { rejected.push(command); return false } }
  expect(cutContextSelection(blocked)).toBe(false)
  expect(rejected).toEqual(['copy'])
})

it('不能读取 Word 图文的 RTF 时交回系统粘贴，避免遗漏图片', async () => {
  const payload = { text: '说明', html: '<p class="MsoNormal">说明<v:imagedata src="file:///a.png"></v:imagedata></p>', rtf: '', images: [] }
  expect(requiresNativePaste(payload)).toBe(true)
  expect(requiresNativePaste({ ...payload, html: '<p><img src="cid:one"><img src="cid:two"></p>' })).toBe(true)
  expect(requiresNativePaste({ ...payload, rtf: '{\\rtf1}' })).toBe(false)
  expect(requiresNativePaste({ ...payload, html: '<p>普通文字</p>' })).toBe(false)
})
