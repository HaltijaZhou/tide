import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { installDetailsFolding } from './details'
import { installLocalImageRenderer } from './images'

let vditor: Vditor | null = null
let resetDetailsFolding = () => {}
let imageRenderer: ReturnType<typeof installLocalImageRenderer> | null = null

function currentMarkdownImageSources(container: HTMLElement): ReadonlyMap<HTMLImageElement, string> {
  const sources = new Map<HTMLImageElement, string>()
  if (!vditor?.vditor?.lute) return sources
  const selector = '.vditor-ir__node[data-type="img"] > img'
  const current = container.querySelectorAll<HTMLImageElement>(selector)
  const template = document.createElement('template')
  template.innerHTML = vditor.vditor.lute.Md2VditorIRDOM(vditor.getValue())
  const parsed = template.content.querySelectorAll<HTMLImageElement>(selector)
  if (current.length !== parsed.length) return sources
  current.forEach((image, index) => {
    const replacement = parsed[index]
    const source = replacement.getAttribute('src')
    if (source !== null && image.parentElement?.textContent === replacement.parentElement?.textContent) {
      sources.set(image, source)
    }
  })
  return sources
}

export function initEditor(
  container: HTMLElement,
  callbacks: {
    onInput: (markdown: string) => void
    onReady: () => void
    resolveLocalImage?: (documentPath: string, source: string) => Promise<string>
  },
): void {
  imageRenderer?.dispose()
  imageRenderer = callbacks.resolveLocalImage
    ? installLocalImageRenderer(container, callbacks.resolveLocalImage, () => currentMarkdownImageSources(container))
    : null
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const initialDark = media.matches
  let ready = false
  const applyTheme = () => {
    if (!ready) return
    vditor?.setTheme(
      media.matches ? 'dark' : 'classic',
      media.matches ? 'dark' : 'light',
      media.matches ? 'github-dark' : 'github',
    )
  }
  vditor = new Vditor(container, {
    mode: 'ir',               // 即编即显
    lang: 'zh_CN',
    height: '100%',
    cache: { enable: false }, // 单文件模型：禁用 localStorage 缓存
    cdn: '/vditor',           // 运行时资源（Lute/i18n/图标/主题 CSS）本地化，离线可用
    theme: initialDark ? 'dark' : 'classic',
    preview: {
      theme: { current: initialDark ? 'dark' : 'light' },
      hljs: { style: initialDark ? 'github-dark' : 'github' },
    }, // 正文与代码高亮均跟随系统
    toolbar: [],
    input: (value) => callbacks.onInput(value),
    after: () => {
      ready = true
      if (media.matches !== initialDark) applyTheme()
      resetDetailsFolding = installDetailsFolding(container)
      callbacks.onReady()
    },
  })
  // 运行时同时切换外壳、正文和代码高亮，避免暗色背景中出现亮色代码块。
  media.addEventListener('change', applyTheme)
}

export function getMarkdown(): string {
  return vditor?.getValue() ?? ''
}

export function setMarkdown(value: string): void {
  resetDetailsFolding()
  vditor?.setValue(value, true)
  imageRenderer?.refresh()
}

export function setDocumentPath(path: string | null): void {
  imageRenderer?.setDocumentPath(path)
}

export function focusEditor(): void {
  vditor?.focus()
}
