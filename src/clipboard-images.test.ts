import { expect, it } from 'vitest'
import { rtfClipboardImages } from './clipboard-images'

it('从没有 bliptag 的 RTF 图片中提取字节，并且不跨越到下一张图片', async () => {
  const rtf = '{\\pict\\pngblip 0102}{\\pict\\jpegblip\\bliptag-12 ffd8ffd9}'
  const images = rtfClipboardImages(rtf)

  expect(images.map((image) => image.type)).toEqual(['image/png', 'image/jpeg'])
  expect(Array.from(new Uint8Array(await images[0].arrayBuffer()))).toEqual([1, 2])
  expect(Array.from(new Uint8Array(await images[1].arrayBuffer()))).toEqual([255, 216, 255, 217])
})

it('跳过 RTF 图片的嵌套元数据和后续控制字', async () => {
  const rtf = '{\\pict\\pngblip\\bliptag-12{\\*\\blipuid abcdef}\\picw1\\pich1 010203}'
  const images = rtfClipboardImages(rtf)

  expect(images).toHaveLength(1)
  expect(Array.from(new Uint8Array(await images[0].arrayBuffer()))).toEqual([1, 2, 3])
})
