import { buildContextMenu, placeContextMenu, type ContextMenuEntry } from './context-menu-model'
import { captureSelection, cutContextSelection, dispatchContextPaste, readContextClipboard, requiresNativePaste, selectionIsCurrent, type ContextSelection } from './context-clipboard'
import { copyContextImage } from './context-image'

interface MenuCallbacks {
  applyFormat: (action: string, range: Range) => void
  imageSource: (image: HTMLImageElement) => string | undefined
  linkSource: (link: HTMLElement) => string | undefined
  openLink: (url: string) => Promise<void> | void
  reportError: (message: string) => void
}

const formatLabels: Record<string, string> = {
  bold: '加粗', italic: '斜体', strike: '删除线', 'inline-code': '行内代码',
}

export function installContextMenu(editor: HTMLElement, callbacks: MenuCallbacks): () => void {
  const doc = editor.ownerDocument
  const view = doc.defaultView!
  const menu = doc.createElement('div')
  const submenu = doc.createElement('div')
  menu.className = 'tide-context-menu'
  submenu.className = 'tide-context-menu tide-context-submenu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', '编辑菜单')
  submenu.setAttribute('role', 'menu')
  submenu.setAttribute('aria-label', '更多编辑操作')
  menu.hidden = true
  submenu.hidden = true
  doc.body.append(menu, submenu)

  let selection: ContextSelection | null = null
  let editable: HTMLElement | null = null
  let selectedImage: HTMLImageElement | null = null
  let imageSource: string | undefined
  let linkSource: string | undefined
  let parentButton: HTMLButtonElement | null = null

  function closeSubmenu() {
    submenu.hidden = true
    parentButton?.setAttribute('aria-expanded', 'false')
    parentButton = null
  }

  function closeMenu() {
    menu.hidden = true
    closeSubmenu()
  }

  function restoreSelection(): boolean {
    const current = doc.getSelection()
    if (!selection || !editable || !current || !editor.contains(selection.start) || !editor.contains(selection.end)) return false
    editable.focus({ preventScroll: true })
    current.removeAllRanges()
    current.addRange(selection.range)
    return true
  }

  async function copyText(text: string) {
    if (!view.navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await view.navigator.clipboard.writeText(text)
  }

  async function runAction(action: string) {
    closeMenu()
    if (!restoreSelection() || !selection || !editable) {
      callbacks.reportError('编辑位置已变化，请重新打开右键菜单')
      return
    }
    const saved = captureSelection(selection.range)
    try {
      if (action === 'cut') {
        if (!cutContextSelection(doc)) throw new Error('clipboard command failed')
      } else if (action === 'copy' || action === 'select-all') {
        if (!doc.execCommand(action === 'select-all' ? 'selectAll' : action)) throw new Error('clipboard command failed')
      } else if (action === 'paste') {
        // A native paste preserves every clipboard format when the webview allows it.
        if (doc.execCommand('paste')) return
        if (!view.navigator.clipboard?.read) throw new Error('clipboard read unavailable')
        const payload = await readContextClipboard(view.navigator.clipboard)
        if (requiresNativePaste(payload)) {
          callbacks.reportError(`请按 ${/Mac/i.test(view.navigator.platform) ? '⌘V' : 'Ctrl+V'} 粘贴此图文，以保留图片`)
          return
        }
        if (!selectionIsCurrent(saved, doc.getSelection()) || !editor.contains(saved.start) || !editor.contains(saved.end)) {
          callbacks.reportError('光标位置已变化，请重新粘贴')
          return
        }
        dispatchContextPaste(editable, payload)
      } else if (action === 'open-link' && linkSource) {
        await callbacks.openLink(linkSource)
      } else if (action === 'copy-link' && linkSource) {
        await copyText(linkSource)
      } else if (action === 'copy-image-source' && imageSource) {
        await copyText(imageSource)
      } else if (action === 'copy-image' && selectedImage) {
        await copyContextImage(selectedImage, doc, view.navigator.clipboard)
      } else {
        callbacks.applyFormat(action, selection.range)
      }
    } catch (error) {
      callbacks.reportError(action === 'paste' ? `无法读取剪贴板，请按 ${/Mac/i.test(view.navigator.platform) ? '⌘V' : 'Ctrl+V'} 粘贴`
        : action === 'copy-image' ? '无法复制图片，请检查来源或改为复制图片地址'
        : action === 'open-link' ? '无法打开链接'
        : error instanceof Error && error.message.startsWith('请') ? error.message
        : '操作未完成，请使用键盘快捷键重试')
    }
  }

  function place(element: HTMLElement, x: number, y: number) {
    element.hidden = false
    element.style.visibility = 'hidden'
    const rect = element.getBoundingClientRect()
    const position = placeContextMenu(x, y, rect.width, rect.height, view.innerWidth, view.innerHeight)
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
    element.style.visibility = 'visible'
  }

  function showSubmenu(button: HTMLButtonElement, entries: ContextMenuEntry[], focusFirst = false) {
    closeSubmenu()
    parentButton = button
    button.setAttribute('aria-expanded', 'true')
    submenu.replaceChildren()
    entries.forEach((entry) => addEntry(submenu, entry))
    submenu.hidden = false
    submenu.style.visibility = 'hidden'
    const rect = button.getBoundingClientRect()
    const width = submenu.getBoundingClientRect().width
    const x = rect.right + width + 8 <= view.innerWidth ? rect.right + 3 : rect.left - width - 3
    place(submenu, x, rect.top)
    if (focusFirst) submenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }

  function addEntry(parent: HTMLElement, entry: ContextMenuEntry) {
    if (entry.id.endsWith('separator')) {
      const separator = doc.createElement('div')
      separator.className = 'tide-context-separator'
      separator.setAttribute('role', 'separator')
      parent.append(separator)
      return
    }
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'tide-context-item'
    button.textContent = entry.label
    button.disabled = !!entry.disabled
    button.dataset.action = entry.id
    button.setAttribute('role', 'menuitem')
    button.addEventListener('mousedown', (event) => event.preventDefault())
    if (entry.shortcut || entry.children) {
      const hint = doc.createElement('span')
      hint.className = entry.children ? 'tide-context-chevron' : 'tide-context-shortcut'
      hint.textContent = entry.children ? '›' : `${/Mac/i.test(view.navigator.platform) ? '⌘' : 'Ctrl+'}${entry.shortcut}`
      hint.setAttribute('aria-hidden', 'true')
      button.append(hint)
    }
    if (entry.children) {
      button.setAttribute('aria-haspopup', 'menu')
      button.setAttribute('aria-expanded', 'false')
      button.addEventListener('click', () => showSubmenu(button, entry.children!))
      button.addEventListener('mouseenter', () => showSubmenu(button, entry.children!))
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          showSubmenu(button, entry.children!, true)
        }
      })
    } else {
      if (parent === menu) button.addEventListener('mouseenter', closeSubmenu)
      button.addEventListener('click', () => { void runAction(entry.id) })
    }
    parent.append(button)
  }

  function openMenu(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    const field = target?.closest<HTMLElement>('[contenteditable="true"]')
    if (!field || !editor.contains(field)) return
    const current = doc.getSelection()
    if (!current?.rangeCount) return
    const range = current.getRangeAt(0)
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return
    event.preventDefault()
    editable = field
    selection = captureSelection(range)
    selectedImage = target?.closest<HTMLElement>('[data-type="img"]')?.querySelector<HTMLImageElement>('img') ?? null
    imageSource = selectedImage ? callbacks.imageSource(selectedImage) : undefined
    const link = target?.closest<HTMLElement>('[data-type="a"], [data-type="link-ref"], a')
    linkSource = link ? callbacks.linkSource(link) : undefined
    const model = buildContextMenu({
      hasSelection: !range.collapsed,
      hasTextSelection: !!range.toString(),
      link: linkSource,
      image: selectedImage ? imageSource || '图片' : undefined,
    })
    closeSubmenu()
    menu.replaceChildren()
    if (model.formats.length) {
      const bar = doc.createElement('div')
      bar.className = 'tide-context-formats'
      for (const action of model.formats) {
        const button = doc.createElement('button')
        button.type = 'button'
        button.className = 'tide-context-format'
        button.setAttribute('role', 'menuitem')
        button.setAttribute('aria-label', formatLabels[action])
        button.title = formatLabels[action]
        button.innerHTML = `<svg aria-hidden="true"><use href="#vditor-icon-${action}"></use></svg>`
        button.addEventListener('mousedown', (mouseEvent) => mouseEvent.preventDefault())
        button.addEventListener('click', () => { void runAction(action) })
        bar.append(button)
      }
      menu.append(bar)
    }
    model.entries.forEach((entry) => {
      if (entry.id === 'copy-image-source' && !imageSource) entry.disabled = true
      addEntry(menu, entry)
    })
    const rect = field.getBoundingClientRect()
    place(menu, event.clientX || rect.left, event.clientY || rect.top)
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }

  function onKey(event: KeyboardEvent) {
    if (menu.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!submenu.hidden) {
        const parent = parentButton
        closeSubmenu()
        parent?.focus()
      } else {
        closeMenu()
        restoreSelection()
      }
      return
    }
    if (event.key === 'ArrowLeft' && !submenu.hidden) {
      event.preventDefault()
      const parent = parentButton
      closeSubmenu()
      parent?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const active = !submenu.hidden && submenu.contains(doc.activeElement) ? submenu : menu
      const buttons = Array.from(active.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (!buttons.length) return
      const current = buttons.indexOf(doc.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current <= 0 ? buttons.length - 1 : current - 1)
      buttons[next].focus()
    } else if (event.key === 'Tab') {
      closeMenu()
    } else if (event.key.length === 1 && !(doc.activeElement && (menu.contains(doc.activeElement) || submenu.contains(doc.activeElement)))) {
      closeMenu()
    }
  }

  function onPointer(event: Event) {
    const target = event.target as Node | null
    if (target && !menu.contains(target) && !submenu.contains(target)) closeMenu()
  }

  editor.addEventListener('contextmenu', openMenu)
  doc.addEventListener('keydown', onKey, true)
  doc.addEventListener('pointerdown', onPointer, true)
  view.addEventListener('resize', closeMenu)
  view.addEventListener('blur', closeMenu)
  editor.addEventListener('scroll', closeMenu, true)
  return () => {
    editor.removeEventListener('contextmenu', openMenu)
    doc.removeEventListener('keydown', onKey, true)
    doc.removeEventListener('pointerdown', onPointer, true)
    view.removeEventListener('resize', closeMenu)
    view.removeEventListener('blur', closeMenu)
    editor.removeEventListener('scroll', closeMenu, true)
    menu.remove()
    submenu.remove()
  }
}
