/** Ignore the hidden source marker duplicated beside an IR entity preview. */
export function selectedTextForFormatting(range: Range): string {
  if (typeof range.cloneContents !== 'function') return range.toString()
  const fragment = range.cloneContents()
  fragment.querySelectorAll('[data-type="html-entity"] > .vditor-ir__marker').forEach((marker) => marker.remove())
  return fragment.textContent ?? range.toString()
}

/** Build Markdown for selections that Vditor would otherwise inject as raw HTML. */
export function safeMarkdownForSelection(action: string, text: string): string | null {
  const escapeText = (value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]~])/g, '\\$1')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (action === 'inline-code') {
    const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
    const fence = '`'.repeat(longest + 1)
    const pad = /^`|`$|^ | $/.test(text) ? ' ' : ''
    return `${fence}${pad}${text}${pad}${fence}`
  }
  if (action === 'code') {
    const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
    const fence = '`'.repeat(longest + 1)
    return `${fence}\n${text}\n${fence}`
  }
  if (action === 'table') {
    if (/[\r\n]/.test(text)) return null
    return `| ${escapeText(text).replace(/\|/g, '\\|')} | 列2 |\n| --- | --- |\n|  |  |`
  }
  const escaped = escapeText(text)
  if (action === 'link') return `[${escaped}](https://)`
  const markers: Record<string, string> = { bold: '**', italic: '*', strike: '~~' }
  const marker = markers[action]
  if (!marker) return null
  const parts = escaped.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!parts?.[2]) return null
  return `${parts[1]}${marker}${parts[2]}${marker}${parts[3]}`
}
