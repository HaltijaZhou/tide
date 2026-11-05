import { expect, it } from 'vitest'
import { installContextMenu } from './context-menu'

it('在编辑区右键时打开菜单，Escape 关闭菜单，卸载后恢复默认右键', async () => {
  class Element extends EventTarget {
    children: Element[] = []
    style: Record<string, string> = {}
    dataset: Record<string, string> = {}
    classList = { add() {}, remove() {}, toggle() {} }
    attributes: Record<string, string> = {}
    hidden = false
    disabled = false
    type = ''
    focusCount = 0
    textContent = ''
    ownerDocument!: Document
    closest(): Element | null { return this }
    contains(): boolean { return true }
    append(...nodes: Element[]) { this.children.push(...nodes) }
    replaceChildren(...nodes: Element[]) { this.children = nodes }
    setAttribute(name: string, value: string) { this.attributes[name] = value }
    getBoundingClientRect() { return { width: 230, height: 260, left: 0, top: 0, bottom: 10, right: 10 } }
    querySelector(selector: string): Element | null {
      if (selector !== 'button:not(:disabled)') return null
      for (const child of this.children) {
        if (child.type === 'button' && !child.disabled) return child
        const nested = child.querySelector(selector)
        if (nested) return nested
      }
      return null
    }
    querySelectorAll() { return [] }
    focus() { this.focusCount += 1 }
    remove() { this.hidden = true }
  }
  const range = {
    startContainer: {}, startOffset: 0, endContainer: {}, endOffset: 0, collapsed: true,
    cloneRange() { return this }, toString() { return '' },
  }
  const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange() {} }
  const view = new EventTarget() as EventTarget & {
    innerWidth: number; innerHeight: number; getSelection: () => unknown; navigator: { platform: string }
  }
  view.innerWidth = 800
  view.innerHeight = 600
  view.getSelection = () => selection
  view.navigator = { platform: 'Win32' }
  const doc = new EventTarget() as EventTarget & {
    body: Element; defaultView: typeof view; createElement: () => Element; getSelection: () => unknown
  }
  doc.body = new Element()
  doc.defaultView = view
  doc.createElement = () => { const element = new Element(); element.ownerDocument = doc as unknown as Document; return element }
  doc.getSelection = () => selection
  const editor = new Element()
  editor.ownerDocument = doc as unknown as Document
  const dispose = installContextMenu(editor as unknown as HTMLElement, {
    applyFormat() {}, imageSource() {}, linkSource() {}, openLink() {}, reportError() {},
  })
  const menu = doc.body.children[0]
  const rightClick = new Event('contextmenu', { cancelable: true })
  Object.defineProperties(rightClick, { clientX: { value: 120 }, clientY: { value: 80 } })
  editor.dispatchEvent(rightClick)

  expect(rightClick.defaultPrevented).toBe(true)
  expect(menu.hidden).toBe(false)
  expect(menu.children.some((child) => child.textContent === '粘贴')).toBe(true)
  expect(menu.children.find((child) => child.textContent === '粘贴')?.focusCount).toBe(1)
  const paragraph = menu.children.find((child) => child.dataset.action === 'paragraph')!
  paragraph.dispatchEvent(new Event('mouseenter'))
  const submenu = doc.body.children[1]
  expect(submenu.hidden).toBe(false)
  submenu.children[0].dispatchEvent(new Event('mouseenter'))
  expect(submenu.hidden).toBe(false)
  const escape = new Event('keydown', { cancelable: true })
  Object.defineProperty(escape, 'key', { value: 'Escape' })
  doc.dispatchEvent(escape)
  expect(submenu.hidden).toBe(true)
  const close = new Event('keydown', { cancelable: true })
  Object.defineProperty(close, 'key', { value: 'Escape' })
  doc.dispatchEvent(close)
  expect(menu.hidden).toBe(true)

  dispose()
  const afterDispose = new Event('contextmenu', { cancelable: true })
  editor.dispatchEvent(afterDispose)
  expect(afterDispose.defaultPrevented).toBe(false)
})
