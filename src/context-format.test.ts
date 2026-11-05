import { expect, it } from 'vitest'
import { selectedTextForFormatting } from './context-format'

it('重复格式化时只读取实体预览文字，不混入 Vditor 隐藏的源码标记', async () => {
  let markerRemoved = false
  const fragment = {
    querySelectorAll: () => [{ remove: () => { markerRemoved = true } }],
    get textContent() { return markerRemoved ? 'a & b' : 'a &amp;& b' },
  }
  const range = { cloneContents: () => fragment, toString: () => 'a &amp;& b' } as unknown as Range
  expect(selectedTextForFormatting(range)).toBe('a & b')
})
