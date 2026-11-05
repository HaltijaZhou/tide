import { describe, expect, it, vi } from 'vitest'
import { classifyLinkDestination, installLinkActivation } from './links'

describe('链接分类', () => {
  it('把网站与邮件地址识别为外部链接并保留原始地址', () => {
    expect(classifyLinkDestination('https://example.com/a#b')).toEqual({
      kind: 'external', target: 'https://example.com/a#b',
    })
    expect(classifyLinkDestination('http://example.com/')).toEqual({
      kind: 'external', target: 'http://example.com/',
    })
    expect(classifyLinkDestination('mailto:user@example.com')).toEqual({
      kind: 'external', target: 'mailto:user@example.com',
    })
  })

  it('把相对、绝对与 file: 的 Markdown 地址识别为本地文档', () => {
    for (const target of [
      'docs/showcase.md',
      './docs/showcase.md',
      '../中文%20笔记.MARKDOWN#heading',
      'C:\\notes\\a.md',
      'C:/notes/a.md',
      'file:///C:/notes/a.md',
      'notes/a.markdown',
    ]) {
      expect(classifyLinkDestination(target)).toEqual({ kind: 'markdown', target })
    }
  })

  it('只有编码后的扩展名才参与判断，原样保留目标地址', () => {
    expect(classifyLinkDestination('docs/a%2Emd')).toEqual({ kind: 'markdown', target: 'docs/a%2Emd' })
    expect(classifyLinkDestination('docs/a%2EMD')).toEqual({ kind: 'markdown', target: 'docs/a%2EMD' })
    expect(classifyLinkDestination('docs/a%2Epdf')).toEqual({ kind: 'unsupported' })
  })

  it('文件名中的 %23、%3F 属于文件名，原始 ? 与 # 只作为后缀', () => {
    expect(classifyLinkDestination('docs/a%23b.md')).toEqual({ kind: 'markdown', target: 'docs/a%23b.md' })
    expect(classifyLinkDestination('docs/a%3Fb.md?view=1')).toEqual({ kind: 'markdown', target: 'docs/a%3Fb.md?view=1' })
    expect(classifyLinkDestination('docs/a.md?view=1#top')).toEqual({ kind: 'markdown', target: 'docs/a.md?view=1#top' })
  })

  it('拒绝脚本、数据、网络与设备路径以及非 Markdown 本地文件', () => {
    for (const target of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//server/share/a.md',
      '\\\\server\\share\\a.md',
      'file://server/share/a.md',
      'docs/a.pdf',
      'docs/a.md.png',
      '#heading',
      '',
      'docs/invalid%GG.md',
      'docs/invalid%FF.md',
      'docs/%',
      'ftp://example.com/a.md',
      'vbscript:msgbox(1)',
    ]) {
      expect(classifyLinkDestination(target), target).toEqual({ kind: 'unsupported' })
    }
  })
})

interface FakeLink {
  element: HTMLElement
}

function fakeContainer() {
  const listeners = new Map<string, ((event: MouseEvent) => void)[]>()
  const container = {
    listeners,
    addEventListener(type: string, listener: (event: MouseEvent) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener(type: string, listener: (event: MouseEvent) => void) {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))
    },
    contains: () => true,
    dispatch(type: string, event: MouseEvent) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    count: () => Array.from(listeners.values()).reduce((total, list) => total + list.length, 0),
  }
  return container as unknown as HTMLElement & typeof container
}

function fakeLink(): FakeLink {
  const element = { tagName: 'SPAN' } as HTMLElement
  element.closest = () => element
  return { element }
}

function mouseEvent(target: HTMLElement, init: Partial<MouseEvent> = {}): MouseEvent {
  return {
    target,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init,
  } as unknown as MouseEvent
}

function setup(target: string | null = 'https://example.com/a') {
  const container = fakeContainer()
  const link = fakeLink()
  const open = vi.fn()
  const reportError = vi.fn()
  const source = vi.fn(() => target ?? undefined)
  const uninstall = installLinkActivation(container, source, open, reportError)
  const click = (init: Partial<MouseEvent> = {}) => {
    const event = mouseEvent(link.element, init)
    container.dispatch('mousedown', event)
    return event
  }
  return { container, link, open, reportError, source, uninstall, click }
}

describe('修饰键点击', () => {
  it('Ctrl+左键只打开一次并阻止原有导航', () => {
    const { container, link, open, source, click } = setup('https://example.com/a')
    const down = click({ ctrlKey: true })

    expect(source).toHaveBeenCalledWith(link.element)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/a')
    expect(down.preventDefault).toHaveBeenCalled()
    expect(down.stopPropagation).toHaveBeenCalled()

    const followUp = mouseEvent(link.element, { ctrlKey: true })
    container.dispatch('click', followUp)
    expect(followUp.preventDefault).toHaveBeenCalled()
    expect(followUp.stopPropagation).toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('macOS 的 Command+左键同样可以打开', () => {
    const { open, click } = setup('https://example.com/a')

    click({ metaKey: true })

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/a')
  })

  it('普通左键、中键、右键与带 Alt/Shift 的点击保持编辑行为', () => {
    const { open, click, container, link } = setup('https://example.com/a')

    for (const init of [{}, { button: 1 }, { button: 2 }, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }]) {
      const event = click(init)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    expect(open).not.toHaveBeenCalled()

    const followUp = mouseEvent(link.element)
    container.dispatch('click', followUp)
    expect(followUp.preventDefault).not.toHaveBeenCalled()
  })

  it('不支持或无法解析的目标不会被打开，并提示失败', () => {
    const unsafe = setup('javascript:alert(1)')
    const down = unsafe.click({ ctrlKey: true })
    expect(unsafe.open).not.toHaveBeenCalled()
    expect(down.preventDefault).toHaveBeenCalled()
    expect(unsafe.reportError).toHaveBeenCalled()

    const missing = setup(null)
    missing.click({ ctrlKey: true })
    expect(missing.open).not.toHaveBeenCalled()
    expect(missing.reportError).toHaveBeenCalled()
  })

  it('异步打开失败时提示用户', async () => {
    const { open, reportError, click } = setup('https://example.com/a')
    open.mockRejectedValue(new Error('failed'))

    click({ ctrlKey: true })
    await Promise.resolve()
    await Promise.resolve()

    expect(reportError).toHaveBeenCalled()
  })

  it('卸载后不再响应点击', () => {
    const { uninstall, click, open, container } = setup('https://example.com/a')

    uninstall()
    click({ ctrlKey: true })

    expect(open).not.toHaveBeenCalled()
    expect(container.count()).toBe(0)
  })

  it('非链接区域不会触发打开', () => {
    const container = fakeContainer()
    const open = vi.fn()
    const reportError = vi.fn()
    installLinkActivation(container, () => 'https://example.com/a', open, reportError)
    const event = mouseEvent({ tagName: 'P', closest: () => null } as unknown as HTMLElement, { ctrlKey: true })

    container.dispatch('mousedown', event)

    expect(open).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
