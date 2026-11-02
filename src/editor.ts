import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { installDetailsFolding } from './details'

let vditor: Vditor | null = null
let resetDetailsFolding = () => {}

export function initEditor(
  container: HTMLElement,
  callbacks: { onInput: (markdown: string) => void; onReady: () => void },
): void {
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
}

export function focusEditor(): void {
  vditor?.focus()
}
