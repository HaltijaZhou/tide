import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLocalImageRenderer } from '../src/images'

let lute
beforeAll(() => {
  const context = vm.createContext({ console, setTimeout, clearTimeout, TextEncoder, TextDecoder })
  vm.runInContext(readFileSync('node_modules/vditor/dist/js/lute/lute.min.js', 'utf8'), context)
  lute = context.Lute.New()
})
beforeEach(() => vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} }))
afterEach(() => vi.unstubAllGlobals())

describe('local image Markdown round trip', () => {
  it.each([
    ['inline', '![图片](docs/images/a.jpg)'],
    ['reference', '![图片][demo]\n\n[demo]: docs/images/a.jpg'],
    ['title and encoding', '![图片](docs/images/%E4%B8%AD%E6%96%87%20%23.png "标题")'],
  ])('preserves %s Markdown after resolving its displayed image', async (_label, markdown) => {
    const html = lute.Md2VditorIRDOM(markdown)
    const source = html.match(/<img[^>]*src="([^"]+)"/)[1]
    const image = {
      src: source,
      getAttribute(name) { return name === 'src' ? this.src : null },
      setAttribute(name, value) { if (name === 'src') this.src = value },
    }
    const container = { querySelectorAll: () => [image], contains: (node) => node === image }
    const renderer = installLocalImageRenderer(container, async () => 'http://asset.localhost/test.png')
    renderer.setDocumentPath('D:/project/README.md')
    await Promise.resolve()
    await Promise.resolve()

    expect(image.src).toBe('http://asset.localhost/test.png')
    const displayedHtml = html.replace(`src="${source}"`, `src="${image.src}"`)
    expect(lute.VditorIRDOM2Md(displayedHtml)).toBe(lute.VditorIRDOM2Md(html))
    renderer.dispose()
  })
})
