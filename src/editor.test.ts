import { afterEach, expect, it, vi } from 'vitest'

const editor = vi.hoisted(() => ({ calls: [] as { value: string; clearStack?: boolean }[] }))

vi.mock('vditor', () => ({
  default: class {
    setValue(value: string, clearStack?: boolean) { editor.calls.push({ value, clearStack }) }
    getValue() { return '' }
    focus() {}
    setTheme() {}
  },
}))

afterEach(() => vi.unstubAllGlobals())

it('载入文档时清除旧文档的撤销历史', async () => {
  editor.calls = []
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }) })
  const { initEditor, setMarkdown } = await import('./editor')
  initEditor({} as HTMLElement, { onInput: () => {}, onReady: () => {} })
  setMarkdown('# 新文件')

  expect(editor.calls).toEqual([{ value: '# 新文件', clearStack: true }])
})
