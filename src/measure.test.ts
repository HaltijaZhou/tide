import { describe, expect, it } from 'vitest'
import { bindMeasureControl, measureForEditorWidth, readMeasure } from './measure'

describe('正文栏宽', () => {
  it('没有记录时用 720', () => {
    expect(readMeasure(null)).toBe(720)
  })

  it('空字符串或非数字记录回到 720', () => {
    expect(readMeasure('')).toBe(720)
    expect(readMeasure('   ')).toBe(720)
    expect(readMeasure('nope')).toBe(720)
  })

  it('超出 480 到 1600 的记录被夹住，并按 20 对齐', () => {
    expect(readMeasure('100')).toBe(480)
    expect(readMeasure('1610')).toBe(1600)
    expect(readMeasure('730')).toBe(740)
    expect(readMeasure('720')).toBe(720)
  })

  it('适应窗口时用编辑区宽度减去左右各 52px，再夹进同一范围', () => {
    expect(measureForEditorWidth(904)).toBe(800)
    expect(measureForEditorWidth(2000)).toBe(1600)
    expect(measureForEditorWidth(500)).toBe(480)
  })
})

describe('栏宽控件', () => {
  function control(stored: string | null) {
    const storage = {
      value: stored,
      getItem(key: string) {
        return key === 'tide-measure' ? this.value : null
      },
      setItem(key: string, value: string) {
        if (key === 'tide-measure') this.value = value
      },
    }
    const props = new Map<string, string>()
    const input = {
      value: '',
      listeners: new Map<string, () => void>(),
      addEventListener(type: string, fn: () => void) {
        this.listeners.set(type, fn)
      },
    }
    const fit = {
      listeners: new Map<string, () => void>(),
      addEventListener(type: string, fn: () => void) {
        this.listeners.set(type, fn)
      },
    }
    const output = { textContent: '' }
    const editor = { clientWidth: 904 }
    bindMeasureControl({
      root: { style: { setProperty: (name: string, value: string) => props.set(name, value) } },
      input,
      output,
      fit,
      editor,
      storage,
    })
    return { storage, props, input, fit, output, editor }
  }

  it('打开时按已记住的栏宽设置滑块、读数和变量', () => {
    const ui = control('800')
    expect(ui.input.value).toBe('800')
    expect(ui.output.textContent).toBe('800 px')
    expect(ui.props.get('--tide-measure')).toBe('800px')
  })

  it('拖动滑块后立刻改栏宽并记住', () => {
    const ui = control('800')
    ui.input.value = '900'
    ui.input.listeners.get('input')!()
    expect(ui.output.textContent).toBe('900 px')
    expect(ui.props.get('--tide-measure')).toBe('900px')
    expect(ui.storage.value).toBe('900')
  })

  it('点适应窗口后按当前编辑区铺满，并记住', () => {
    const ui = control('720')
    ui.editor.clientWidth = 904
    ui.fit.listeners.get('click')!()
    expect(ui.input.value).toBe('800')
    expect(ui.output.textContent).toBe('800 px')
    expect(ui.props.get('--tide-measure')).toBe('800px')
    expect(ui.storage.value).toBe('800')
  })
})
