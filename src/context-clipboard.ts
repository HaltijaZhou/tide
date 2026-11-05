export interface ContextClipboardPayload {
  text: string
  html: string
  rtf: string
  images: File[]
}

export interface ContextSelection {
  range: Range
  start: Node
  startOffset: number
  end: Node
  endOffset: number
  text: string
}

export function captureSelection(range: Range): ContextSelection {
  return {
    range: range.cloneRange(),
    start: range.startContainer,
    startOffset: range.startOffset,
    end: range.endContainer,
    endOffset: range.endOffset,
    text: range.toString(),
  }
}

export function selectionIsCurrent(saved: ContextSelection, selection: Selection | null): boolean {
  if (!selection?.rangeCount) return false
  const current = selection.getRangeAt(0)
  return current.startContainer === saved.start && current.startOffset === saved.startOffset
    && current.endContainer === saved.end && current.endOffset === saved.endOffset
    && current.toString() === saved.text
}

/** Vditor's cut handler invokes delete itself; avoid nested execCommand calls. */
export function cutContextSelection(doc: Pick<Document, 'execCommand'>): boolean {
  return doc.execCommand('copy') && doc.execCommand('delete')
}

/** Browser clipboard reads can omit the RTF carrying embedded Word images. */
export function requiresNativePaste(payload: ContextClipboardPayload): boolean {
  if (payload.rtf) return false
  return /<v:imagedata\b/i.test(payload.html)
    || (/(?:mso-|msonormal|urn:schemas-microsoft-com:office:word)/i.test(payload.html)
      && /<img\b/i.test(payload.html))
    || /<img\b[^>]*\bsrc\s*=\s*["']?(?:file|cid|blob):/i.test(payload.html)
}

/** Read all useful representations together, so a mixed paste keeps its images. */
export async function readContextClipboard(clipboard: Pick<Clipboard, 'read'>): Promise<ContextClipboardPayload> {
  const result: ContextClipboardPayload = { text: '', html: '', rtf: '', images: [] }
  const items = await clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((type) => type === 'image/png')
      ?? item.types.find((type) => type.startsWith('image/'))
    for (const type of item.types) {
      const normalized = type.startsWith('web ') ? type.slice(4) : type
      if (normalized === 'text/plain' && !result.text) {
        result.text = await (await item.getType(type)).text()
      } else if (normalized === 'text/html' && !result.html) {
        result.html = await (await item.getType(type)).text()
      } else if (normalized === 'text/rtf' && !result.rtf) {
        result.rtf = await (await item.getType(type)).text()
      } else if (type === imageType) {
        const blob = await item.getType(type)
        result.images.push(new File([blob], `clipboard-${result.images.length + 1}`, { type: normalized }))
      }
    }
  }
  return result
}

/** Route a menu paste through the same image and Vditor handlers as Ctrl+V. */
export function dispatchContextPaste(target: EventTarget, payload: ContextClipboardPayload): void {
  const data = new DataTransfer()
  if (payload.text) data.setData('text/plain', payload.text)
  if (payload.html) data.setData('text/html', payload.html)
  if (payload.rtf) data.setData('text/rtf', payload.rtf)
  payload.images.forEach((image) => data.items.add(image))
  target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
}
