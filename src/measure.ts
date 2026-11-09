// 与 index.html 的 #measure-bootstrap 保持同一套范围、步长和默认值。
const MEASURE_MIN = 480
const MEASURE_MAX = 1600
const MEASURE_STEP = 20
const MEASURE_DEFAULT = 720
const MEASURE_GUTTER = 104
const MEASURE_KEY = 'tide-measure'

export function readMeasure(stored: string | null): number {
  if (stored == null || stored.trim() === '') return MEASURE_DEFAULT
  const value = Number(stored)
  if (!Number.isFinite(value)) return MEASURE_DEFAULT
  const stepped = Math.round(value / MEASURE_STEP) * MEASURE_STEP
  return Math.min(MEASURE_MAX, Math.max(MEASURE_MIN, stepped))
}

export function measureForEditorWidth(editorWidth: number): number {
  return readMeasure(String(editorWidth - MEASURE_GUTTER))
}

export function bindMeasureControl(options: {
  root: { style: { setProperty(name: string, value: string): void } }
  input: { value: string; addEventListener(type: string, fn: () => void): void }
  output: { textContent: string }
  fit: { addEventListener(type: string, fn: () => void): void }
  editor: { clientWidth: number }
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }
}): void {
  const apply = (px: number, persist: boolean) => {
    options.input.value = String(px)
    options.output.textContent = `${px} px`
    options.root.style.setProperty('--tide-measure', `${px}px`)
    if (persist) options.storage.setItem(MEASURE_KEY, String(px))
  }

  apply(readMeasure(options.storage.getItem(MEASURE_KEY)), false)

  options.input.addEventListener('input', () => {
    apply(readMeasure(options.input.value), true)
  })

  options.fit.addEventListener('click', () => {
    apply(measureForEditorWidth(options.editor.clientWidth), true)
  })
}
