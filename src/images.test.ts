import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLocalImageRenderer } from './images'

class FakeImage {
  constructor(private source: string) {}
  getAttribute(name: string) { return name === 'src' ? this.source : null }
  setAttribute(name: string, value: string) { if (name === 'src') this.source = value }
}

class FakeContainer {
  definitions: { textContent: string }[] = []
  constructor(public images: FakeImage[]) {}
  querySelectorAll(selector: string) {
    return selector.includes('link-ref-defs-block') ? this.definitions : this.images
  }
  contains(image: FakeImage) { return this.images.includes(image) }
}

class FakeObserver {
  static latest: FakeObserver
  private disconnected = false
  constructor(private callback: MutationCallback) { FakeObserver.latest = this }
  observe() {}
  disconnect() { this.disconnected = true }
  notify() { if (!this.disconnected) this.callback([], this as unknown as MutationObserver) }
}

const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }
const containerElement = (container: FakeContainer) => container as unknown as HTMLElement

beforeEach(() => vi.stubGlobal('MutationObserver', FakeObserver))
afterEach(() => vi.unstubAllGlobals())

describe('local image rendering', () => {
  it('resolves a relative image against the current document', async () => {
    const image = new FakeImage('docs/images/a.jpg')
    const resolve = vi.fn(async (document: string, source: string) => `asset:${document}|${source}`)
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer([image])), resolve)
    renderer.setDocumentPath('D:/project/README.md')
    await settle()

    expect(image.getAttribute('src')).toBe('asset:D:/project/README.md|docs/images/a.jpg')
    expect(resolve).toHaveBeenCalledWith('D:/project/README.md', 'docs/images/a.jpg')
  })

  it('leaves non-local images and unsaved documents unchanged', async () => {
    const sources = ['https://example.test/a.png', 'http://example.test/a.png', '//example.test/a.png',
      'data:image/png;base64,AAAA', 'blob:example', 'asset://localhost/a.png']
    const images = [...sources, 'local.png'].map((source) => new FakeImage(source))
    const resolve = vi.fn(async () => 'asset:resolved')
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer(images)), resolve)
    await settle()
    expect(images.map((image) => image.getAttribute('src'))).toEqual([...sources, 'local.png'])
    expect(resolve).not.toHaveBeenCalled()

    renderer.setDocumentPath('D:/notes/a.md')
    await settle()
    expect(images.map((image) => image.getAttribute('src'))).toEqual([...sources, 'asset:resolved'])
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('resolves absolute paths and local file URLs', async () => {
    const images = ['C:/pictures/a.png', 'file:///C:/pictures/b.png', '../images/c.png']
      .map((source) => new FakeImage(source))
    const resolve = vi.fn(async (_document: string, source: string) => `asset:${source}`)
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer(images)), resolve)
    renderer.setDocumentPath('C:/notes/a.md')
    await settle()
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'asset:C:/pictures/a.png', 'asset:file:///C:/pictures/b.png', 'asset:../images/c.png',
    ])
  })

  it('leaves a missing image alone while resolving the others', async () => {
    const missing = new FakeImage('missing.png')
    const present = new FakeImage('present.png')
    const resolve = vi.fn(async (_document: string, source: string) => {
      if (source === 'missing.png') throw new Error('missing')
      return 'asset:present'
    })
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer([missing, present])), resolve)
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()

    expect(missing.getAttribute('src')).toBe('missing.png')
    expect(present.getAttribute('src')).toBe('asset:present')
    FakeObserver.latest.notify()
    await settle()
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('uses the new document directory after switching files', async () => {
    const image = new FakeImage('same.png')
    const resolve = vi.fn(async (document: string) => `asset:${document}`)
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer([image])), resolve)
    renderer.setDocumentPath('D:/first/a.md')
    await settle()
    expect(image.getAttribute('src')).toBe('asset:D:/first/a.md')

    renderer.setDocumentPath('D:/second/b.md')
    await settle()
    expect(image.getAttribute('src')).toBe('asset:D:/second/b.md')
    expect(resolve).toHaveBeenLastCalledWith('D:/second/b.md', 'same.png')
  })

  it('does not resolve the previous document image against a new document before its render', async () => {
    const oldImage = new FakeImage('old.png')
    const container = new FakeContainer([oldImage])
    const resolve = vi.fn(async (document: string, source: string) => `asset:${document}|${source}`)
    const renderer = installLocalImageRenderer(containerElement(container), resolve)
    renderer.setDocumentPath('D:/first/a.md')
    await settle()

    renderer.setDocumentPath('D:/second/b.md')
    const newImage = new FakeImage('new.png')
    container.images = [newImage]
    await settle()
    expect(newImage.getAttribute('src')).toBe('asset:D:/second/b.md|new.png')
    expect(resolve).not.toHaveBeenCalledWith('D:/second/b.md', 'old.png')
  })

  it('ignores a delayed result from a previous document', async () => {
    const image = new FakeImage('same.png')
    let finishFirst!: (value: string) => void
    const resolve = vi.fn((document: string) => document.includes('/first/')
      ? new Promise<string>((done) => { finishFirst = done })
      : Promise.resolve('asset:second'))
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer([image])), resolve)
    renderer.setDocumentPath('D:/first/a.md')
    await settle()
    renderer.setDocumentPath('D:/second/b.md')
    await settle()
    finishFirst('asset:first')
    await settle()

    expect(image.getAttribute('src')).toBe('asset:second')
  })

  it('ignores a delayed result after an image source is edited', async () => {
    const image = new FakeImage('first.png')
    let finishFirst!: (value: string) => void
    const resolve = vi.fn((_document: string, source: string) => source === 'first.png'
      ? new Promise<string>((done) => { finishFirst = done })
      : Promise.resolve('asset:second'))
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer([image])), resolve)
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()
    image.setAttribute('src', 'second.png')
    FakeObserver.latest.notify()
    await settle()
    finishFirst('asset:first')
    await settle()

    expect(image.getAttribute('src')).toBe('asset:second')
  })

  it('refreshes a reference image when its definition changes without replacing the image node', async () => {
    const image = new FakeImage('first.png')
    const container = new FakeContainer([image])
    container.definitions = [{ textContent: '[demo]: first.png' }]
    let referencedSource = 'first.png'
    const resolve = vi.fn(async (_document: string, source: string) => `asset:${source}`)
    const currentSources = () => new Map([[image as unknown as HTMLImageElement, referencedSource]])
    const renderer = installLocalImageRenderer(containerElement(container), resolve, currentSources)
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()
    expect(image.getAttribute('src')).toBe('asset:first.png')

    referencedSource = 'second.png'
    container.definitions[0].textContent = '[demo]: second.png'
    FakeObserver.latest.notify()
    await settle()
    expect(image.getAttribute('src')).toBe('asset:second.png')
  })

  it('uses a remote URL directly when a local reference is changed to a remote image', async () => {
    const image = new FakeImage('first.png')
    const container = new FakeContainer([image])
    container.definitions = [{ textContent: '[demo]: first.png' }]
    let referencedSource = 'first.png'
    const resolve = vi.fn(async () => 'asset:first.png')
    const renderer = installLocalImageRenderer(containerElement(container), resolve,
      () => new Map([[image as unknown as HTMLImageElement, referencedSource]]))
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()

    referencedSource = 'https://example.test/image.png'
    container.definitions[0].textContent = '[demo]: https://example.test/image.png'
    FakeObserver.latest.notify()
    await settle()
    expect(image.getAttribute('src')).toBe('https://example.test/image.png')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it.each(['pending', 'failed'])('updates a reference to a remote image when the prior local image is %s', async (state) => {
    const image = new FakeImage('first.png')
    const container = new FakeContainer([image])
    container.definitions = [{ textContent: '[demo]: first.png' }]
    let referencedSource = 'first.png'
    let finish!: (value: string) => void
    const resolve = vi.fn(() => state === 'pending'
      ? new Promise<string>((done) => { finish = done })
      : Promise.reject(new Error('missing')))
    const renderer = installLocalImageRenderer(containerElement(container), resolve,
      () => new Map([[image as unknown as HTMLImageElement, referencedSource]]))
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()

    referencedSource = 'https://example.test/image.png'
    container.definitions[0].textContent = '[demo]: https://example.test/image.png'
    FakeObserver.latest.notify()
    await settle()
    if (state === 'pending') finish('asset:old')
    await settle()
    expect(image.getAttribute('src')).toBe('https://example.test/image.png')
  })

  it('resolves images recreated by the editor and retries failures on refresh', async () => {
    const oldImage = new FakeImage('first.png')
    const container = new FakeContainer([oldImage])
    let available = false
    const resolve = vi.fn(async (_document: string, source: string) => {
      if (!available) throw new Error('missing')
      return `asset:${source}`
    })
    const renderer = installLocalImageRenderer(containerElement(container), resolve)
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()
    available = true
    renderer.refresh()
    await settle()
    expect(oldImage.getAttribute('src')).toBe('asset:first.png')

    const newImage = new FakeImage('second.png')
    container.images = [newImage]
    FakeObserver.latest.notify()
    await settle()
    expect(newImage.getAttribute('src')).toBe('asset:second.png')
  })

  it('ignores pending results after disposal', async () => {
    const image = new FakeImage('first.png')
    let finish!: (value: string) => void
    const renderer = installLocalImageRenderer(containerElement(new FakeContainer([image])),
      () => new Promise<string>((done) => { finish = done }))
    renderer.setDocumentPath('D:/notes/a.md')
    await settle()
    renderer.dispose()
    finish('asset:first')
    await settle()

    expect(image.getAttribute('src')).toBe('first.png')
  })
})
