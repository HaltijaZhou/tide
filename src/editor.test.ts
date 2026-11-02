import { afterEach, expect, it, vi } from 'vitest'

const editor = vi.hoisted(() => ({
  calls: [] as { value: string; clearStack?: boolean }[],
  options: [] as { preview: { hljs?: { style: string } }; after: () => void }[],
  themes: [] as [string, string | undefined, string | undefined][],
}))

vi.mock('vditor', () => ({
  default: class {
    constructor(_container: unknown, options: { preview: { hljs?: { style: string } }; after: () => void }) { editor.options.push(options) }
    setValue(value: string, clearStack?: boolean) { editor.calls.push({ value, clearStack }) }
    getValue() { return '' }
    focus() {}
    setTheme(theme: string, contentTheme?: string, codeTheme?: string) { editor.themes.push([theme, contentTheme, codeTheme]) }
  },
}))

afterEach(() => {
  editor.options = []
  editor.themes = []
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
