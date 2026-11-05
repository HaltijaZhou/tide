import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { installDetailsFolding } from './details'
import { installLocalImageRenderer } from './images'
import { clipboardImageMime, rtfClipboardImages, type ClipboardImage } from './clipboard-images'
import { installContextMenu } from './context-menu'
import { safeMarkdownForSelection, selectedTextForFormatting } from './context-format'

let vditor: Vditor | null = null
let resetDetailsFolding = () => {}
let imageRenderer: ReturnType<typeof installLocalImageRenderer> | null = null
let removeImagePaste = () => {}
let removeContextMenu = () => {}

export type InsertPastedImages = (paths: (string | null)[]) => boolean

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

function currentLinkSource(container: HTMLElement, link: HTMLElement): string | undefined {
  const direct = link.getAttribute('href') ?? (link.dataset.type === 'a'
    ? link.querySelector('.vditor-ir__marker--link')?.textContent : undefined)
  if (direct) return direct
  if (link.dataset.type !== 'link-ref' || !vditor?.vditor?.lute) return undefined
  const label = Array.from(link.children).find((child) => !child.classList.contains('vditor-ir__marker'))?.textContent
  if (!label) return undefined
  const template = document.createElement('template')
  template.innerHTML = vditor.vditor.lute.Md2HTML(vditor.getValue())
  const anchors = Array.from(template.content.querySelectorAll<HTMLAnchorElement>('a'))
    .filter((anchor) => !anchor.classList.contains('vditor-footnotes__goto-ref') && !anchor.closest('sup.footnotes-ref'))
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.vditor-ir__node[data-type="a"], .vditor-ir__node[data-type="link-ref"]'))
  const visibleLabel = (node: HTMLElement) => node.dataset.type === 'a'
    ? node.querySelector('.vditor-ir__link')?.textContent
    : Array.from(node.children).find((child) => !child.classList.contains('vditor-ir__marker'))?.textContent
  const index = nodes.indexOf(link)
  if (index >= 0 && nodes.length === anchors.length
    && nodes.every((node, position) => visibleLabel(node) === anchors[position].textContent)) {
    return anchors[index].getAttribute('href') ?? undefined
  }
  const matches = anchors
    .filter((candidate) => candidate.textContent === label && candidate.hasAttribute('href'))
  const destinations = new Set(matches.map((candidate) => candidate.getAttribute('href')))
  return destinations.size === 1 && container.contains(link) ? matches[0].getAttribute('href') ?? undefined : undefined
}

function applyContextFormat(action: string, range: Range): void {
  const toolbar = vditor?.vditor?.toolbar?.elements
  if (!toolbar) return
  const element = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement : range.startContainer as HTMLElement
  if (!element) return
  if (action.startsWith('heading-')) {
    if (element.closest('[data-type="code-block"], [data-type="table"]')) return
    toolbar.headings?.querySelector<HTMLButtonElement>(`button[data-tag="h${action.slice(-1)}"]`)?.click()
    return
  }
  const button = toolbar[action]?.firstElementChild as HTMLButtonElement | null
  if (!button) return
  const selector: Record<string, string> = {
    bold: '[data-type="strong"]', italic: '[data-type="em"]', strike: '[data-type="s"]',
    'inline-code': '[data-type="code"]', link: '[data-type="a"]', quote: 'blockquote',
    list: 'ul > li:not(.vditor-task)', 'ordered-list': 'ol > li', check: 'li.vditor-task',
  }
  if (selector[action]) button.classList.toggle('vditor-menu--current', !!element.closest(selector[action]))
  if (!element.closest('[data-type="code-block"], [data-type="table"]')) {
    button.classList.remove('vditor-menu--disabled')
  }
  let text = selectedTextForFormatting(range)
  if (text && /[<&]/.test(text) && !button.classList.contains('vditor-menu--current')
    && !button.classList.contains('vditor-menu--disabled')
    && ['bold', 'italic', 'strike', 'inline-code', 'link', 'code', 'table'].includes(action)) {
    const inline: Record<string, string> = {
      bold: '[data-type="strong"] > strong', italic: '[data-type="em"] > em',
      strike: '[data-type="s"] > s', 'inline-code': '[data-type="code"] > code',
    }
    const inlineSelector = inline[action]
    if (inlineSelector && /[\r\n]/.test(text)) {
      throw new Error('请在同一段内选择文字后重试')
    }
    if (inlineSelector && (/^\s|\s$/.test(text))) {
      const start = text.match(/^\s*/)?.[0].length ?? 0
      const end = text.match(/\s*$/)?.[0].length ?? 0
      const current = range.startContainer.ownerDocument?.getSelection()
      if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== Node.TEXT_NODE
        || !current || start + end >= text.length) {
        throw new Error('请选中文字并去掉首尾空白后重试')
      }
      const adjusted = range.cloneRange()
      adjusted.setStart(range.startContainer, range.startOffset + start)
      adjusted.setEnd(range.endContainer, range.endOffset - end)
      current.removeAllRanges()
      current.addRange(adjusted)
      text = text.slice(start, text.length - end)
    }
    const markdown = safeMarkdownForSelection(action, text)
    if (markdown === null) throw new Error('selection cannot be formatted safely')
    const root = vditor?.vditor?.ir?.element
    const previous = root && inlineSelector ? new Set(root.querySelectorAll(inlineSelector)) : null
    vditor?.insertMD(markdown)
    if (root && previous && inlineSelector) {
      const inserted = Array.from(root.querySelectorAll(inlineSelector)).filter((node) => !previous.has(node))
      const current = root.ownerDocument.getSelection()
      if (inserted.length === 1 && current) {
        const restored = root.ownerDocument.createRange()
        restored.selectNodeContents(inserted[0])
        current.removeAllRanges()
        current.addRange(restored)
      }
    }
    return
  }
  button.click()
}

export function initEditor(
  container: HTMLElement,
  callbacks: {
    onInput: (markdown: string) => void
    onReady: () => void
    resolveLocalImage?: (documentPath: string, source: string) => Promise<string>
    onPasteImages?: (files: ClipboardImage[], insert: InsertPastedImages, missing: number) => void
    onOpenLink?: (url: string) => Promise<void> | void
    onContextMessage?: (message: string) => void
  },
): void {
  imageRenderer?.dispose()
  removeImagePaste()
  removeContextMenu()
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
    // Keep Vditor's format commands available to the context menu without
    // registering its default hotkeys (Ctrl+O belongs to opening a document).
    toolbar: ['headings', 'bold', 'italic', 'strike', 'inline-code', 'link', 'quote',
      'list', 'ordered-list', 'check', 'code', 'table', 'line']
      .map((name) => ({ name, hotkey: '' })),
    input: (value) => callbacks.onInput(value),
    after: () => {
      ready = true
      if (media.matches !== initialDark) applyTheme()
      resetDetailsFolding = installDetailsFolding(container)
      removeContextMenu = installContextMenu(container, {
        applyFormat: applyContextFormat,
        imageSource: (image) => currentMarkdownImageSources(container).get(image),
        linkSource: (link) => currentLinkSource(container, link),
        openLink: (url) => callbacks.onOpenLink?.(url),
        reportError: (message) => callbacks.onContextMessage?.(message),
      })
      callbacks.onReady()
    },
  })
  if (callbacks.onPasteImages) {
    const onPaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData
      if (!clipboard) return
      const html = clipboard.getData?.('text/html') ?? ''
      const plain = clipboard.getData?.('text/plain') ?? ''
      let direct = Array.from(clipboard.files).filter((file) => clipboardImageMime(file) !== null)
      if (!direct.length) {
        direct = Array.from(clipboard.items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null && clipboardImageMime(file) !== null)
      }
      let files: ClipboardImage[] = direct
      let inlineIndexes: number[] | null = null
      let missing = 0
      if (html.trim()) {
        const images = Array.from(new DOMParser().parseFromString(html, 'text/html').body.querySelectorAll('img'))
        if (images.length && direct.length !== images.length) {
          const rtf = rtfClipboardImages(clipboard.getData?.('text/rtf') ?? '')
          if (rtf.length === images.length) {
            files = rtf
          } else {
            const candidates: ClipboardImage[] = []
            const indexes: number[] = []
            images.forEach((image, index) => {
              const source = image.getAttribute('src') ?? ''
              const match = source.match(/^data:(image\/[a-z\d.+-]+);base64,([\s\S]*)$/i)
              if (match) {
                try {
                  const binary = atob(match[2])
                  const bytes = new Uint8Array(binary.length)
                  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
                  candidates.push(new File([bytes], `pasted-${index}`, { type: match[1] }))
                  indexes.push(index)
                } catch { /* Keep malformed image data in the original HTML. */ }
              } else if (/^file:/i.test(source)) {
                candidates.push({ localSource: source })
                indexes.push(index)
              }
            })
            direct.forEach((file) => {
              const name = file.name.toLowerCase()
              if (!name) return
              const matches = images.flatMap((image, index) => {
                const source = image.getAttribute('src') ?? ''
                if (!/^(https?:|file:)/i.test(source)) return []
                const part = source.split(/[?#]/, 1)[0].split('/').pop() ?? ''
                let filename = part
                try { filename = decodeURIComponent(part) } catch { /* Keep the original segment. */ }
                return filename.toLowerCase() === name ? [index] : []
              })
              if (matches.length === 1 && !indexes.includes(matches[0])) {
                candidates.push(file)
                indexes.push(matches[0])
              }
            })
            if (candidates.length) {
              files = candidates
              inlineIndexes = indexes
              missing = images.length - candidates.length
            } else {
              files = []
              inlineIndexes = []
              missing = images.length
            }
          }
        }
      }
      if (!files.length && !missing) files = rtfClipboardImages(clipboard.getData?.('text/rtf') ?? '')
      if (!files.length && !missing) return
      event.preventDefault()
      event.stopPropagation()
      const selection = window.getSelection?.()
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
      const start = range?.startContainer
      const end = range?.endContainer
      const selectedText = range?.toString()
      callbacks.onPasteImages!(files, (paths) => {
        if (!vditor || !range || !start || !end || range.startContainer !== start || range.endContainer !== end
          || !container.contains(start) || !container.contains(end) || range.toString() !== selectedText) return false
        let markdown = paths.filter((path): path is string => path !== null)
          .map((path) => `![图片](${path})`).join('\n')
        if (html.trim()) {
          const body = new DOMParser().parseFromString(html, 'text/html').body
          const images = Array.from(body.querySelectorAll('img'))
          if (paths.length === files.length && (inlineIndexes || images.length === files.length)) {
            paths.forEach((path, index) => {
              const image = images[inlineIndexes?.[index] ?? index]
              if (path) image.setAttribute('src', path)
            })
            markdown = vditor.html2md(Lute.Sanitize(body.innerHTML))
          } else {
            const content = vditor.html2md(Lute.Sanitize(body.innerHTML)).trimEnd()
            if (content) markdown = `${content}\n\n${markdown}`
          }
        } else if (plain.trim()) {
          markdown = `${plain}\n\n${markdown}`
        }
        if (!markdown.trim()) return false
        const current = window.getSelection()
        if (!current) return false
        const previous = current.rangeCount ? current.getRangeAt(0).cloneRange() : null
        const previousStart = previous?.startContainer
        const previousEnd = previous?.endContainer
        const restore = previous && (previousStart !== range.startContainer || previousEnd !== range.endContainer
          || previous.startOffset !== range.startOffset || previous.endOffset !== range.endOffset)
        vditor.focus()
        current.removeAllRanges()
        current.addRange(range)
        vditor.insertMD(markdown)
        if (restore && previousStart && previousEnd && previous.startContainer === previousStart
          && previous.endContainer === previousEnd && container.contains(previousStart) && container.contains(previousEnd)) {
          current.removeAllRanges()
          current.addRange(previous)
        }
        return true
      }, missing)
    }
    container.addEventListener('paste', onPaste, true)
    removeImagePaste = () => container.removeEventListener('paste', onPaste, true)
  }
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
