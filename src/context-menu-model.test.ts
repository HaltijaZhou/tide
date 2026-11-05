import { expect, it } from 'vitest'
import { buildContextMenu, placeContextMenu } from './context-menu-model'

it('未选中文字时禁用剪切复制，但仍可粘贴和选择段落样式', async () => {
  const menu = buildContextMenu({ hasSelection: false, hasTextSelection: false })

  expect(menu.formats).toEqual([])
  expect(menu.entries.find((item) => item.id === 'cut')?.disabled).toBe(true)
  expect(menu.entries.find((item) => item.id === 'copy')?.disabled).toBe(true)
  expect(menu.entries.find((item) => item.id === 'paste')?.disabled).not.toBe(true)
  expect(menu.entries.some((item) => item.id === 'paragraph')).toBe(true)
})

it('选中文字时提供格式快捷操作并允许剪切复制', async () => {
  const menu = buildContextMenu({ hasSelection: true, hasTextSelection: true })

  expect(menu.formats).toEqual(['bold', 'italic', 'strike', 'inline-code'])
  expect(menu.entries.find((item) => item.id === 'cut')?.disabled).not.toBe(true)
  expect(menu.entries.find((item) => item.id === 'copy')?.disabled).not.toBe(true)
})

it('链接与图片分别出现对应的操作，危险链接不能直接打开', async () => {
  const link = buildContextMenu({ hasSelection: false, hasTextSelection: false, link: 'https://example.com/' })
  const unsafe = buildContextMenu({ hasSelection: false, hasTextSelection: false, link: 'javascript:alert(1)' })
  const image = buildContextMenu({ hasSelection: false, hasTextSelection: false, image: 'images/photo.png' })

  expect(link.entries.find((item) => item.id === 'open-link')?.disabled).not.toBe(true)
  expect(unsafe.entries.find((item) => item.id === 'open-link')?.disabled).toBe(true)
  expect(image.entries.some((item) => item.id === 'copy-image')).toBe(true)
  expect(image.entries.some((item) => item.id === 'copy-image-source')).toBe(true)
})

it('菜单靠近窗口边缘时自动移入可见区域', async () => {
  expect(placeContextMenu(790, 590, 230, 260, 800, 600)).toEqual({ x: 562, y: 332 })
  expect(placeContextMenu(30, 40, 230, 260, 800, 600)).toEqual({ x: 30, y: 40 })
})
