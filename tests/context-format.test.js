import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'
import { safeMarkdownForSelection } from '../src/context-format'

it('给含有 HTML 字面量的选区加格式时，不把文字变成页面元素', async () => {
  const context = vm.createContext({ console, setTimeout, clearTimeout, TextEncoder, TextDecoder })
  vm.runInContext(readFileSync('node_modules/vditor/dist/js/lute/lute.min.js', 'utf8'), context)
  const lute = context.Lute.New()
  const text = '<img src=x onerror=alert(1)> & [原文]'

  for (const action of ['bold', 'italic', 'strike', 'inline-code', 'link', 'code', 'table']) {
    const markdown = safeMarkdownForSelection(action, text)
    const html = lute.Md2HTML(markdown)
    const editorHtml = lute.Md2VditorIRDOM(markdown)
    expect(html, action).not.toMatch(/<img\b/i)
    expect(editorHtml, action).not.toMatch(/<img\b/i)
    expect(html, action).toContain('&lt;img')
    expect(html, action).toContain('&amp;')
    expect(html, action).toContain('[原文]')
  }
})
