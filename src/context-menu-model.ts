export interface ContextMenuEntry {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  children?: ContextMenuEntry[]
}

export interface EditorMenuContext {
  hasSelection: boolean
  hasTextSelection: boolean
  link?: string
  image?: string
}

export function isSafeExternalLink(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function placeContextMenu(
  x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number,
): { x: number; y: number } {
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, viewportWidth - width - margin)),
    y: Math.max(margin, Math.min(y, viewportHeight - height - margin)),
  }
}

export function buildContextMenu(context: EditorMenuContext): {
  formats: string[]
  entries: ContextMenuEntry[]
} {
  const entries: ContextMenuEntry[] = []
  if (context.image) {
    entries.push(
      { id: 'copy-image', label: '复制图片' },
      { id: 'copy-image-source', label: '复制图片地址' },
      { id: 'context-separator', label: '' },
    )
  } else if (context.link) {
    entries.push(
      { id: 'open-link', label: '打开链接', disabled: !isSafeExternalLink(context.link) },
      { id: 'copy-link', label: '复制链接地址' },
      { id: 'context-separator', label: '' },
    )
  }
  entries.push(
    { id: 'cut', label: '剪切', shortcut: 'X', disabled: !context.hasSelection },
    { id: 'copy', label: '复制', shortcut: 'C', disabled: !context.hasSelection },
    { id: 'paste', label: '粘贴', shortcut: 'V' },
  )
  if (!context.hasSelection) entries.push({ id: 'select-all', label: '全选', shortcut: 'A' })
  if (!context.image && !context.link) {
    entries.push(
      { id: 'edit-separator', label: '' },
      { id: 'paragraph', label: '段落样式', children: [
        { id: 'heading-1', label: '一级标题' },
        { id: 'heading-2', label: '二级标题' },
        { id: 'heading-3', label: '三级标题' },
        { id: 'quote', label: '引用' },
        { id: 'list', label: '无序列表' },
        { id: 'ordered-list', label: '有序列表' },
        { id: 'check', label: '任务列表' },
      ] },
      { id: 'insert', label: '插入', children: [
        { id: 'link', label: '链接' },
        { id: 'code', label: '代码块' },
        { id: 'table', label: '表格' },
        { id: 'line', label: '分隔线' },
      ] },
    )
  }
  return {
    formats: context.hasTextSelection ? ['bold', 'italic', 'strike', 'inline-code'] : [],
    entries,
  }
}
