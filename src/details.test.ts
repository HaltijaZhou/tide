import { describe, expect, it } from 'vitest'
import { DetailsOpenStates, getCollapsedDetailIndexes, getCollapsedDetailRanges, getDetailStateKeys, type DetailsHtmlBlock } from './details'

const html = (source: string, ...openStates: boolean[]): DetailsHtmlBlock => ({ source, openStates })

describe('跨块 details 的可见范围', () => {
  it('只收起闭合折叠块中的内容，保留块外内容', () => {
    const blocks = [
      html('<details>\n<summary>标题</summary>', false),
      null,
      null,
      html('</details>'),
      null,
    ]

    expect(getCollapsedDetailIndexes(blocks)).toEqual([1, 2])
  })

  it('展开时保留内容，单一 HTML 块交由原生 details 处理', () => {
    expect(getCollapsedDetailIndexes([
      html('<details open>\n<summary>标题</summary>', true), null, html('</details>'),
    ])).toEqual([])
    expect(getCollapsedDetailIndexes([
      html('<details><summary>标题</summary>正文</details>', false), null,
    ])).toEqual([])
  })

  it('嵌套折叠块分别控制内容', () => {
    const blocks = [
      html('<details><summary>外层</summary>', true),
      html('<details><summary>内层</summary>', false),
      null,
      html('</details>'),
      null,
      html('</details>'),
    ]
    expect(getCollapsedDetailIndexes(blocks)).toEqual([2])
    expect(getCollapsedDetailIndexes([
      html('<details><summary>外层</summary>', false), ...blocks.slice(1),
    ])).toEqual([1, 2, 3, 4])
  })

  it('未闭合或无法匹配预览的 HTML 不隐藏后续内容', () => {
    expect(getCollapsedDetailIndexes([html('<details>', false), null, null])).toEqual([])
    expect(getCollapsedDetailIndexes([html('<details>'), null, html('</details>'), null])).toEqual([])
    expect(getCollapsedDetailIndexes([html('</details>'), null])).toEqual([])
  })

  it('忽略注释和脚本中的标签，并识别带引号的属性', () => {
    const blocks = [
      html('<!-- <details> -->\n<script>"<details>"</script>\n<details data-note="a > b">', false),
      null,
      html('</details>'),
    ]
    expect(getCollapsedDetailIndexes(blocks)).toEqual([1])
    expect(getCollapsedDetailIndexes([
      html('<details data-note="<!--"><summary>标题</summary>', false), null, html('</details>'),
    ])).toEqual([1])
  })

  it('不会把其他 HTML 标签属性中的文本当作结束标签', () => {
    const blocks = [
      html('<details><summary>标题</summary>', false),
      html('<div data-example="</details>">示例</div>'),
      null,
      html('</details>'),
      null,
    ]
    expect(getCollapsedDetailIndexes(blocks)).toEqual([1, 2])
  })

  it('无预览的 HTML 块只影响相邻未闭合的范围，不影响其他折叠块', () => {
    const unrelatedTemplate = html('<template><details>模板</details></template>')
    expect(getCollapsedDetailIndexes([
      html('<details>', false), null, html('</details>'),
      unrelatedTemplate,
      html('<details>', false), null, html('</details>'),
    ])).toEqual([1, 5])
    expect(getCollapsedDetailIndexes([
      html('<details>', false), null, unrelatedTemplate, null, html('</details>'), null,
    ])).toEqual([])
  })

  it('保留结束标签在原始 HTML 中的位置，供区分块内外内容', () => {
    const prefix = '<!-- </details> -->\n<div>内部</div>\n'
    expect(getCollapsedDetailRanges([
      html('<details><summary>标题</summary>', false),
      null,
      html(prefix + '</details>\n<div>外部</div>'),
    ])).toEqual([{ start: 0, end: 2, detailIndex: 0, closeOffset: prefix.length }])
  })
})

describe('重渲染时的折叠状态', () => {
  it('列表整体重绘并在前方插入同标题块后，按正文保留原块的状态', () => {
    const states = new DetailsOpenStates()
    const blocks = [html('<details><summary>相同标题</summary>', false), null, html('</details>')]
    const keyFor = (body: string, occurrences: Map<string, number>) =>
      getDetailStateKeys(blocks, ['', body, ''], occurrences)[0][0]

    const first = { open: true }
    const second = { open: false }
    let occurrences = new Map<string, number>()
    states.beginPass([first, second])
    states.sync(keyFor('第一正文', occurrences), first)
    states.sync(keyFor('第二正文', occurrences), second)
    states.endPass()

    const inserted = { open: false }
    const rerenderedFirst = { open: false }
    const rerenderedSecond = { open: false }
    occurrences = new Map<string, number>()
    states.beginPass([inserted, rerenderedFirst, rerenderedSecond])
    states.sync(keyFor('新正文', occurrences), inserted)
    states.sync(keyFor('第一正文', occurrences), rerenderedFirst)
    states.sync(keyFor('第二正文', occurrences), rerenderedSecond)
    states.endPass()

    expect([inserted.open, rerenderedFirst.open, rerenderedSecond.open]).toEqual([false, true, false])
  })

  it('保留用户打开的状态，但切换文档后重新采用原文状态', () => {
    const states = new DetailsOpenStates()
    const original = { open: false }
    states.sync('同一折叠块', original)
    original.open = true
    states.sync('同一折叠块', original)

    const rerendered = { open: false }
    states.sync('同一折叠块', rerendered)
    expect(rerendered.open).toBe(true)

    states.reset()
    const nextDocument = { open: false }
    states.sync('同一折叠块', nextDocument)
    expect(nextDocument.open).toBe(false)
  })

  it('同名折叠块前面的块删除后，保留仍在页面中的块的状态', () => {
    const states = new DetailsOpenStates()
    const first = { open: false }
    const second = { open: true }
    states.sync('相同标题-0', first)
    states.sync('相同标题-1', second)

    states.sync('相同标题-0', second)
    expect(second.open).toBe(true)
  })

  it('插入同名折叠块时不抢用仍存在的块的状态', () => {
    const states = new DetailsOpenStates()
    const original = { open: true }
    states.beginPass([original])
    states.sync('相同标题-0', original)
    states.endPass()

    const inserted = { open: false }
    states.beginPass([inserted, original])
    states.sync('相同标题-0', inserted)
    states.sync('相同标题-1', original)
    states.endPass()
    expect(inserted.open).toBe(false)
    expect(original.open).toBe(true)

    states.beginPass([inserted])
    states.sync('相同标题-0', inserted)
    states.endPass()
    const later = { open: false }
    states.beginPass([inserted, later])
    states.sync('相同标题-0', inserted)
    states.sync('相同标题-1', later)
    states.endPass()
    expect(later.open).toBe(false)
  })
})
