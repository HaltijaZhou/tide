function renderPng(image: HTMLImageElement, doc: Document): Promise<Blob> {
  if (!image.naturalWidth || !image.naturalHeight) return Promise.reject(new Error('image not loaded'))
  const canvas = doc.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('canvas unavailable'))
  context.drawImage(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('image conversion failed'))
  }, 'image/png'))
}

async function imagePng(image: HTMLImageElement, doc: Document): Promise<Blob> {
  try {
    return await renderPng(image, doc)
  } catch {
    const source = image.currentSrc || image.src
    if (!/^https?:/i.test(source)) throw new Error('image cannot be read')
    const retry = doc.createElement('img')
    retry.crossOrigin = 'anonymous'
    retry.src = source
    await retry.decode()
    return renderPng(retry, doc)
  }
}

/** Start the clipboard write during the user gesture, even if PNG encoding is async. */
export async function copyContextImage(image: HTMLImageElement, doc: Document, clipboard: Clipboard): Promise<void> {
  if (!clipboard.write || typeof ClipboardItem === 'undefined') throw new Error('image clipboard unavailable')
  const png = imagePng(image, doc)
  await clipboard.write([new ClipboardItem({ 'image/png': png })])
}
