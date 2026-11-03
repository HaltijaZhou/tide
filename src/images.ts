type ImageResolver = (documentPath: string, source: string) => Promise<string>
type CurrentImageSources = () => ReadonlyMap<HTMLImageElement, string>

interface ImageState {
  source: string
  displayed: string | null
  version: number
}

function isLocalImage(source: string): boolean {
  if (!source || source.startsWith('//') || source.startsWith('\\\\') || /^[?#]/.test(source)) return false
  if (/^[a-zA-Z]:[\\/]/.test(source)) return true
  const scheme = source.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/)
  return !scheme || scheme[1].toLowerCase() === 'file'
}

export function installLocalImageRenderer(
  container: HTMLElement,
  resolve: ImageResolver,
  currentImageSources?: CurrentImageSources,
) {
  const states = new WeakMap<HTMLImageElement, ImageState>()
  let documentPath: string | null = null
  let version = 0
  let disposed = false
  let referenceDefinitions = ''

  const scan = () => {
    if (disposed) return
    const images = container.querySelectorAll<HTMLImageElement>(
      '.vditor-ir__node[data-type="img"] > img, .vditor-ir__preview img',
    )
    const definitions = Array.from(container.querySelectorAll<HTMLElement>('[data-type="link-ref-defs-block"]'))
      .map((element) => element.textContent ?? '').join('\u0000')
    let refreshedSources: ReadonlyMap<HTMLImageElement, string> | undefined
    if (definitions !== referenceDefinitions) {
      referenceDefinitions = definitions
      refreshedSources = currentImageSources?.()
    }
    images.forEach((image) => {
      let current = image.getAttribute('src')
      if (current === null) return
      const previous = states.get(image)
      const refreshed = refreshedSources?.get(image)
      const source = refreshed
        ?? (previous?.displayed === current ? previous.source : current)

      if (!documentPath || !isLocalImage(source)) {
        if (current !== source && (refreshed !== undefined || previous?.displayed === current)) {
          image.setAttribute('src', source)
        }
        states.delete(image)
        return
      }
      if (previous?.version === version && previous.source === source) return

      if (previous?.displayed === current) {
        image.setAttribute('src', source)
        current = source
      }
      const state: ImageState = { source, displayed: null, version }
      states.set(image, state)
      const expected = current
      const path = documentPath
      let pending: Promise<string>
      try {
        pending = resolve(path, source)
      } catch {
        return
      }
      void pending.then((url) => {
        if (disposed || version !== state.version || documentPath !== path
          || states.get(image) !== state || !container.contains(image)
          || image.getAttribute('src') !== expected) return
        state.displayed = url
        image.setAttribute('src', url)
      }).catch(() => {})
    })
  }

  const observer = new MutationObserver(scan)
  observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true })

  const refresh = () => {
    version += 1
    scan()
  }
  return {
    setDocumentPath(path: string | null) {
      if (documentPath === path) return
      documentPath = path
      version += 1
      const scheduledVersion = version
      queueMicrotask(() => { if (version === scheduledVersion) scan() })
    },
    refresh,
    dispose() {
      disposed = true
      version += 1
      observer.disconnect()
    },
  }
}
