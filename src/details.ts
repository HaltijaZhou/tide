export interface DetailsHtmlBlock {
  source: string
  openStates: readonly boolean[]
}

export interface CollapsedDetailRange {
  start: number
  end: number
  detailIndex: number
  closeOffset: number
}

export class DetailsOpenStates {
  private readonly remembered = new Map<string, boolean>()
  private readonly owners = new Map<string, { open: boolean }>()
  private seen = new WeakMap<{ open: boolean }, string>()
  private previousOwners = new Map<string, { open: boolean }>()
  private live = new Set<{ open: boolean }>()
  private active = new Set<string>()

  beginPass(details: readonly { open: boolean }[]): void {
    this.previousOwners = new Map(this.owners)
    this.live = new Set(details)
    this.active.clear()
  }

  endPass(): void {
    // Keep the last state if Vditor temporarily removes all previews while rendering.
    if (this.active.size) {
      for (const key of this.remembered.keys()) {
        if (!this.active.has(key)) {
          this.remembered.delete(key)
          this.owners.delete(key)
        }
      }
    }
    this.previousOwners.clear()
    this.live.clear()
  }

  sync(key: string, detail: { open: boolean }): void {
    this.active.add(key)
    if (this.seen.has(detail)) {
      this.seen.set(detail, key)
      this.remembered.set(key, detail.open)
      this.owners.set(key, detail)
      return
    }
    const previous = this.remembered.get(key)
    const previousOwner = this.previousOwners.get(key)
    if (previous !== undefined && (!previousOwner || !this.live.has(previousOwner))) detail.open = previous
    else this.remembered.set(key, detail.open)
    this.seen.set(detail, key)
    this.owners.set(key, detail)
  }

  reset(): void {
    this.remembered.clear()
    this.owners.clear()
    this.seen = new WeakMap()
    this.previousOwners.clear()
    this.live.clear()
    this.active.clear()
  }
}

export function getCollapsedDetailRanges(blocks: readonly (DetailsHtmlBlock | null)[]): CollapsedDetailRange[] {
  const ranges: CollapsedDetailRange[] = []
  const stack: { index: number; detailIndex: number; open: boolean }[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block) continue

    // Consume complete tags before comments so comment-like text inside an attribute stays literal.
    const tokens = block.source.matchAll(/<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^'">]|"[^"]*"|'[^']*')*>/gi)
    const tags: RegExpMatchArray[] = []
    let rawTextElement = ''
    for (const token of tokens) {
      const name = token[2]?.toLowerCase()
      if (!name) continue
      if (rawTextElement) {
        if (token[1] && name === rawTextElement) rawTextElement = ''
        continue
      }
      if (!token[1] && /^(script|style|textarea|title|xmp|iframe|noembed|noframes)$/.test(name)) {
        rawTextElement = name
      } else if (name === 'details') {
        tags.push(token)
      }
    }
    if (tags.filter((tag) => !tag[1]).length !== block.openStates.length) {
      // An unexpected preview must not join boundaries across this block.
      stack.length = 0
      continue
    }

    let openingIndex = 0
    for (const tag of tags) {
      if (!tag[1]) {
        stack.push({ index, detailIndex: openingIndex, open: block.openStates[openingIndex] })
        openingIndex += 1
        continue
      }
      const start = stack.pop()
      if (start && !start.open && index > start.index) {
        ranges.push({ start: start.index, end: index, detailIndex: start.detailIndex, closeOffset: tag.index ?? 0 })
      }
    }
  }
  return ranges
}

function indexesInRanges(ranges: readonly CollapsedDetailRange[], length: number): number[] {
  const changes = new Int32Array(length + 1)
  for (const range of ranges) {
    changes[range.start + 1] += 1
    changes[range.end] -= 1
  }
  const collapsed: number[] = []
  let depth = 0
  for (let index = 0; index < length; index += 1) {
    depth += changes[index]
    if (depth > 0) collapsed.push(index)
  }
  return collapsed
}

export function getCollapsedDetailIndexes(blocks: readonly (DetailsHtmlBlock | null)[]): number[] {
  return indexesInRanges(getCollapsedDetailRanges(blocks), blocks.length)
}

/** Include the content between split tags so identical titles can survive list rerenders. */
export function getDetailStateKeys(
  blocks: readonly (DetailsHtmlBlock | null)[],
  text: readonly string[],
  occurrences: Map<string, number>,
): string[][] {
  const contexts = blocks.map((block) => block?.openStates.map(() => '') ?? [])
  const closedBlocks = blocks.map((block) => block && {
    source: block.source,
    openStates: block.openStates.map(() => false),
  })
  for (const range of getCollapsedDetailRanges(closedBlocks)) {
    contexts[range.start][range.detailIndex] = JSON.stringify([
      text.slice(range.start + 1, range.end),
      blocks[range.end]?.source.slice(0, range.closeOffset),
    ])
  }
  return blocks.map((block, blockIndex) => block?.openStates.map((_, detailIndex) => {
    const identity = JSON.stringify([block.source, detailIndex, contexts[blockIndex][detailIndex]])
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return JSON.stringify([identity, occurrence])
  }) ?? [])
}

type PreviewMatch = Element | { text: Text; length: number }

/** Match only preview content that is provably before a split closing tag. */
function previewElementsBeforeClosing(preview: Element, source: string, closeOffset: number): PreviewMatch[] {
  const template = document.createElement('template')
  template.innerHTML = source.slice(0, closeOffset)
  const matches: PreviewMatch[] = []
  const meaningful = (nodes: NodeListOf<ChildNode>) => Array.from(nodes).filter((node) =>
    node.nodeType !== Node.COMMENT_NODE && !(node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()),
  )
  const normalized = (element: Element, deep: boolean): Element => {
    const clone = element.cloneNode(deep) as Element
    for (const item of [clone, ...clone.querySelectorAll('*')]) {
      item.classList.remove('tide-details-hidden')
      if (!item.getAttribute('class')) item.removeAttribute('class')
      if (item.tagName === 'DETAILS') {
        item.removeAttribute('contenteditable')
        item.removeAttribute('open')
      }
    }
    return clone
  }
  const matchPrefix = (expectedParent: ParentNode, actualParent: ParentNode): boolean => {
    const expected = meaningful(expectedParent.childNodes)
    const actual = meaningful(actualParent.childNodes)
    if (expected.length > actual.length) return false
    for (let index = 0; index < expected.length; index += 1) {
      const want = expected[index]
      const found = actual[index]
      if (want instanceof Text) {
        if (found instanceof Text && found.data.startsWith(want.data)) {
          // Only the last expected node may share text with content after the closing tag.
          if (index < expected.length - 1 && found.length !== want.length) return false
          matches.push({ text: found, length: want.length })
        } else if (found instanceof Element && found.matches('span[data-tide-details-text]') &&
          found.childNodes.length === 1 && found.firstChild instanceof Text && found.textContent === want.data) {
          matches.push(found)
        } else return false
        continue
      }
      if (!(want instanceof Element) || !(found instanceof Element)) return false
      if (normalized(want, true).isEqualNode(normalized(found, true))) {
        matches.push(found)
      } else if (!normalized(want, false).isEqualNode(normalized(found, false)) || !matchPrefix(want, found)) {
        return false
      }
    }
    return true
  }
  return matchPrefix(template.content, preview) ? matches : []
}

/** Keep Vditor's separately rendered HTML and Markdown blocks visually in sync. */
export function installDetailsFolding(container: HTMLElement): () => void {
  const editor = container.querySelector<HTMLElement>('.vditor-ir > pre.vditor-reset')
  if (!editor) return () => {}

  const openStates = new DetailsOpenStates()
  const reconcile = (protectSelection = false) => {
    openStates.beginPass(Array.from(editor.querySelectorAll<HTMLDetailsElement>('.vditor-ir__preview details')))
    const parents = new Set<Element>()
    editor.querySelectorAll<HTMLElement>('.vditor-ir__node[data-type="html-block"]').forEach((block) => {
      if (block.parentElement) parents.add(block.parentElement)
    })

    const nextHidden = new Set<Element>()
    const nextHiddenText = new Map<Text, number>()
    const occurrences = new Map<string, number>()
    for (const parent of parents) {
      const children = Array.from(parent.children)
      const detailNodes: HTMLDetailsElement[][] = children.map(() => [])
      const blocks = children.map((child, childIndex): DetailsHtmlBlock | null => {
        if (!child.matches('.vditor-ir__node[data-type="html-block"]')) return null
        const source = child.querySelector<HTMLElement>(':scope > .vditor-ir__marker--pre > code[data-type="html-block"]')
        const preview = child.querySelector<HTMLElement>(':scope > .vditor-ir__preview')
        if (!source || !preview) return null

        const details = Array.from(preview.querySelectorAll<HTMLDetailsElement>('details'))
        const sourceText = source.textContent ?? ''
        // Preview markup is not the source: keeping it non-editable lets the native summary toggle safely.
        details.forEach((detail) => detail.setAttribute('contenteditable', 'false'))
        detailNodes[childIndex] = details
        return { source: sourceText, openStates: details.map((detail) => detail.open) }
      })
      const detailKeys = getDetailStateKeys(
        blocks,
        children.map((child) => (child.textContent ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()),
        occurrences,
      )
      detailNodes.forEach((details, childIndex) => {
        details.forEach((detail, index) => openStates.sync(detailKeys[childIndex][index], detail))
        const block = blocks[childIndex]
        if (block) block.openStates = details.map((detail) => detail.open)
      })
      let ranges = getCollapsedDetailRanges(blocks)
      if (protectSelection) {
        const selection = editor.ownerDocument.getSelection()
        const points = [selection?.anchorNode, selection?.focusNode].filter((node): node is Node => !!node)
        let reopened = false
        for (const range of ranges) {
          const containsSelection = children.slice(range.start + 1, range.end)
            .some((child) => points.some((point) => child.contains(point)))
          const detail = detailNodes[range.start][range.detailIndex]
          if (!containsSelection || !detail) continue
          detail.open = true
          openStates.sync(detailKeys[range.start][range.detailIndex], detail)
          const block = blocks[range.start]
          if (block) block.openStates = detailNodes[range.start].map((item) => item.open)
          reopened = true
        }
        if (reopened) ranges = getCollapsedDetailRanges(blocks)
      }
      for (const index of indexesInRanges(ranges, children.length)) nextHidden.add(children[index])
      for (const range of ranges) {
        const source = blocks[range.end]?.source
        const preview = children[range.end].querySelector(':scope > .vditor-ir__preview')
        if (!source || !preview || range.closeOffset === 0) continue
        for (const match of previewElementsBeforeClosing(preview, source, range.closeOffset)) {
          if (match instanceof Element) nextHidden.add(match)
          else nextHiddenText.set(match.text, Math.max(nextHiddenText.get(match.text) ?? 0, match.length))
        }
      }
    }
    openStates.endPass()

    for (const [text, length] of nextHiddenText) {
      if (!text.parentNode || !length) continue
      if (length < text.length) text.splitText(length)
      // Preview-only wrappers allow partial text to hide without changing the HTML source marker.
      const wrapper = document.createElement('span')
      wrapper.setAttribute('data-tide-details-text', '')
      text.parentNode.insertBefore(wrapper, text)
      wrapper.appendChild(text)
      nextHidden.add(wrapper)
    }

    // Undo can restore cloned nodes carrying a stale class from an older snapshot.
    editor.querySelectorAll('.tide-details-hidden').forEach((element) => {
      if (!nextHidden.has(element)) element.classList.remove('tide-details-hidden')
    })
    for (const element of nextHidden) {
      element.classList.add('tide-details-hidden')
    }
  }

  let scheduled = false
  let protectSelection = false
  const schedule = (protect = false) => {
    protectSelection ||= protect
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      const protect = protectSelection
      protectSelection = false
      reconcile(protect)
    })
  }
  new MutationObserver(() => schedule()).observe(editor, { childList: true, subtree: true })
  editor.addEventListener('input', () => schedule(true), true)
  editor.addEventListener('toggle', (event) => {
    if (event.target instanceof HTMLDetailsElement) reconcile()
  }, true)
  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const summary = target.closest('summary')
    if (!summary || summary.parentElement?.tagName !== 'DETAILS' || !summary.closest('.vditor-ir__preview')) return
    if (target.closest('a, button, input, select, textarea')) return
    // A single activation toggles the preview; a double click still lets Vditor edit the HTML source.
    if (event.detail <= 1) event.stopPropagation()
  }, true)
  reconcile()
  return () => {
    openStates.reset()
    editor.querySelectorAll('.tide-details-hidden').forEach((element) => element.classList.remove('tide-details-hidden'))
  }
}
