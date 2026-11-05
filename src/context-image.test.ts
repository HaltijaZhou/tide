import { afterEach, expect, it, vi } from 'vitest'
import { copyContextImage } from './context-image'

afterEach(() => vi.unstubAllGlobals())

it('跨域图片污染画布时以匿名跨域方式重新加载，再复制 PNG', async () => {
  const png = new Blob([new Uint8Array([1, 2])], { type: 'image/png' })
  let canvasCount = 0
  const retryImage = { crossOrigin: '', src: '', naturalWidth: 20, naturalHeight: 10, decode: async () => {} }
  const doc = { createElement: (tag: string) => {
    if (tag === 'img') return retryImage
    const current = ++canvasCount
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
      toBlob: (callback: (blob: Blob) => void) => { if (current === 1) throw new Error('tainted'); callback(png) } }
  } } as unknown as Document
  const image = { currentSrc: 'https://example.com/photo.png', src: 'https://example.com/photo.png',
    naturalWidth: 20, naturalHeight: 10 } as HTMLImageElement
  let written: Blob | undefined
  class Item {
    value: Record<string, Promise<Blob>>
    constructor(value: Record<string, Promise<Blob>>) { this.value = value }
  }
  vi.stubGlobal('ClipboardItem', Item)
  const clipboard = { write: async (items: Item[]) => { written = await items[0].value['image/png'] } } as unknown as Clipboard

  await copyContextImage(image, doc, clipboard)

  expect(retryImage.crossOrigin).toBe('anonymous')
  expect(retryImage.src).toBe('https://example.com/photo.png')
  expect(written).toBe(png)
})
