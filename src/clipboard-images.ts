const mimeByExtension: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
}

export type ClipboardImage = File | { localSource: string }

export function clipboardImageMime(file: Pick<File, 'name' | 'type'>): string | null {
  const mime = file.type.toLowerCase()
  if (mime === 'image/jpg') return 'image/jpeg'
  if (mime === 'image/x-png') return 'image/png'
  if (mime.startsWith('image/')) return mime
  if (mime && mime !== 'application/octet-stream') return null
  const extension = file.name?.split('.').pop()?.toLowerCase()
  return extension ? mimeByExtension[extension] ?? null : null
}

export function rtfClipboardImages(rtf: string): File[] {
  const pictures = /\{\\pict(?=[^a-zA-Z]|$)/g
  const files: File[] = []
  let match: RegExpExecArray | null
  while ((match = pictures.exec(rtf))) {
    let depth = 1
    const parts: string[] = []
    let cursor = match.index + 1
    let start = cursor
    for (; cursor < rtf.length && depth > 0; cursor += 1) {
      const char = rtf[cursor]
      if (char === '\\' && /[{}\\]/.test(rtf[cursor + 1] ?? '')) {
        cursor += 1
      } else if (char === '{') {
        if (depth === 1) parts.push(rtf.slice(start, cursor))
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 1) start = cursor + 1
        else if (depth === 0) parts.push(rtf.slice(start, cursor))
      }
    }
    if (depth !== 0) break
    pictures.lastIndex = cursor
    const picture = parts.join('')
    const mime = /\\pngblip\b/.test(picture) ? 'image/png'
      : /\\jpegblip\b/.test(picture) ? 'image/jpeg' : null
    if (!mime) continue
    if (/\\bin-?\d/.test(picture)) continue
    const hex = picture.replace(/\\[a-zA-Z]+-?\d* ?/g, '').replace(/\s/g, '')
    if (!hex.length || hex.length % 2 !== 0 || !/^[\da-fA-F]+$/.test(hex)) continue
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i += 1) {
      const high = hex.charCodeAt(i * 2)
      const low = hex.charCodeAt(i * 2 + 1)
      bytes[i] = ((high <= 57 ? high - 48 : (high | 32) - 87) << 4)
        | (low <= 57 ? low - 48 : (low | 32) - 87)
    }
    files.push(new File([bytes], 'pasted-rtf-' + files.length, { type: mime }))
  }
  return files
}
