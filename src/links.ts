/**
 * 链接目标的分类与修饰键点击。
 *
 * 分类只决定“能不能打开、用哪种方式打开”，`target` 始终保留 Markdown 里的原始地址，
 * 解码后的路径只在 Rust 侧用于定位文件，不会写回文档。
 */

export type LinkDestination =
  | { kind: 'external'; target: string }
  | { kind: 'markdown'; target: string }
  | { kind: 'unsupported' }

const UNSUPPORTED: LinkDestination = { kind: 'unsupported' }
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i
const SCHEME = /^[a-z][a-z\d+.-]*:/i
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i
const NETWORK_PATH = /^[\\/]{2}/

const LINK_SELECTOR = '[data-type="a"], [data-type="link-ref"], a'

function hasValidPercentEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue
    if (!/^[\da-f]{2}$/i.test(value.slice(index + 1, index + 3))) return false
    index += 2
  }
  return true
}

/** 解码一次；非法的百分号序列或非 UTF-8 字节返回 null。 */
function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** 原始 `?`、`#` 是查询与片段，`%3F`、`%23` 属于文件名，因此先按原文切分再解码。 */
function stripSuffix(value: string): string {
  const index = value.search(/[?#]/)
  return index === -1 ? value : value.slice(0, index)
}

function isMarkdownFile(value: string): boolean {
  if (!hasValidPercentEncoding(value)) return false
  const path = stripSuffix(value)
  if (!path) return false
  const decoded = decodeOnce(path)
  return decoded !== null && MARKDOWN_EXTENSION.test(decoded)
}

function classifyFileUrl(value: string, target: string): LinkDestination {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return UNSUPPORTED
  }
  // 只接受本机文件：远程主机、网络共享都交给系统是危险的。
  if (url.host && url.host !== 'localhost') return UNSUPPORTED
  if (!isMarkdownFile(url.pathname)) return UNSUPPORTED
  return { kind: 'markdown', target }
}

function classifyLocalPath(value: string, target: string): LinkDestination {
  if (NETWORK_PATH.test(value)) return UNSUPPORTED
  if (!isMarkdownFile(value)) return UNSUPPORTED
  return { kind: 'markdown', target }
}

export function classifyLinkDestination(value: string): LinkDestination {
  const target = value
  const trimmed = value.trim()
  const plain = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed
  if (!plain || plain.startsWith('#')) return UNSUPPORTED

  // Windows 盘符也带冒号，必须在协议判断之前区分。
  if (WINDOWS_DRIVE.test(plain)) return classifyLocalPath(plain, target)

  if (SCHEME.test(plain)) {
    const protocol = plain.slice(0, plain.indexOf(':') + 1).toLowerCase()
    if (protocol === 'file:') return classifyFileUrl(plain, target)
    if (!EXTERNAL_PROTOCOLS.has(protocol)) return UNSUPPORTED
    try {
      new URL(plain)
    } catch {
      return UNSUPPORTED
    }
    return { kind: 'external', target }
  }

  return classifyLocalPath(plain, target)
}

function linkFromEvent(container: HTMLElement, event: MouseEvent): HTMLElement | null {
  const target = event.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return null
  const link = target.closest(LINK_SELECTOR) as HTMLElement | null
  if (!link) return null
  return container.contains?.(link) === false ? null : link
}

/**
 * 在 Vditor 处理点击之前拦截 Ctrl/Command+左键。
 *
 * mousedown 处于捕获阶段：此时链接节点还没有被 Vditor 改写或展开，
 * 目标地址与右键菜单共用同一个提取函数；随后的 click 一并拦下，
 * 避免 Vditor 自带的 `window.open` 绕过分类。
 */
export function installLinkActivation(
  container: HTMLElement,
  source: (link: HTMLElement) => string | undefined,
  open: (target: string) => Promise<void> | void,
  reportError: (message: string) => void,
): () => void {
  let suppressed: HTMLElement | null = null

  const report = (message: string) => {
    try {
      reportError(message)
    } catch {
      /* 提示失败不应打断编辑 */
    }
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.altKey || event.shiftKey) return
    if (!event.ctrlKey && !event.metaKey) return
    const link = linkFromEvent(container, event)
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    suppressed = link

    const target = source(link)
    if (!target) {
      report('无法识别链接地址')
      return
    }
    const destination = classifyLinkDestination(target)
    if (destination.kind === 'unsupported') {
      report('无法打开此链接')
      return
    }
    try {
      const result = open(destination.target) as Promise<void> | void
      if (result && typeof result.catch === 'function') {
        result.catch(() => report('无法打开链接'))
      }
    } catch {
      report('无法打开链接')
    }
  }

  const onClick = (event: MouseEvent) => {
    if (!suppressed) return
    const matched = linkFromEvent(container, event) === suppressed
    suppressed = null
    if (!matched) return
    event.preventDefault()
    event.stopPropagation()
  }

  container.addEventListener('mousedown', onMouseDown, true)
  container.addEventListener('click', onClick, true)
  return () => {
    container.removeEventListener('mousedown', onMouseDown, true)
    container.removeEventListener('click', onClick, true)
    suppressed = null
  }
}
