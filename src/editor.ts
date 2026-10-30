import Vditor from 'vditor'
import 'vditor/dist/index.css'

let vditor: Vditor | null = null

export function initEditor(
  container: HTMLElement,
  callbacks: { onInput: (markdown: string) => void; onReady: () => void },
): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  vditor = new Vditor(container, {
    mode: 'ir',               // 即编即显
    lang: 'zh_CN',
    height: '100%',
    cache: { enable: false }, // 单文件模型：禁用 localStorage 缓存
    cdn: '/vditor',           // 运行时资源（Lute/i18n/图标/主题 CSS）本地化，离线可用
    theme: media.matches ? 'dark' : 'classic',
    preview: { theme: { current: media.matches ? 'dark' : 'light' } }, // 正文区主题与外壳一致
    toolbar: [],
    input: (value) => callbacks.onInput(value),
    after: () => callbacks.onReady(),
  })
  // 暗色跟随系统：运行时切换外壳主题 + 内容主题（内容主题必须单独切，否则暗壳白芯）
  media.addEventListener('change', () => {
    vditor?.setTheme(media.matches ? 'dark' : 'classic', media.matches ? 'dark' : 'light')
  })
}

export function getMarkdown(): string {
  return vditor?.getValue() ?? ''
}

export function setMarkdown(value: string): void {
  vditor?.setValue(value, true)
}

export function focusEditor(): void {
  vditor?.focus()
}
