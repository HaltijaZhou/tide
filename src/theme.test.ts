import { describe, expect, it, vi } from 'vitest'
import { createThemeController, installThemeControls } from './theme'

function environment(saved: string | null = null, systemDark = false) {
  let stored = saved
  let onSystemChange = () => {}
  const media = {
    matches: systemDark,
    addEventListener: (_event: string, listener: () => void) => { onSystemChange = listener },
    removeEventListener: () => {},
  }
  const root = { dataset: {} as Record<string, string> }
  const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } }
  return {
    media, root, storage,
    stored: () => stored,
    setSystemDark: (value: boolean) => { media.matches = value; onSystemChange() },
  }
}

describe('外观控制器', () => {
  it('首次启动或保存值无效时跟随系统，并同步页面颜色', () => {
    for (const value of [null, 'invalid']) {
      const env = environment(value, true)
      const theme = createThemeController({ ...env, storage: () => env.storage })
      expect(theme.getPreference()).toBe('system')
      expect(theme.isDark()).toBe(true)
      expect(env.root.dataset.theme).toBe('dark')
      env.setSystemDark(false)
      expect(theme.isDark()).toBe(false)
      expect(env.root.dataset.theme).toBe('light')
    }
  })

  it('手动选择持久化并覆盖系统变化，重启后恢复；选择系统后重新跟随', () => {
    const env = environment(null, false)
    const theme = createThemeController({ ...env, storage: () => env.storage })
    const onChange = vi.fn()
    theme.subscribe(onChange)
    theme.setPreference('dark')
    expect(env.stored()).toBe('dark')
    expect(env.root.dataset.theme).toBe('dark')
    env.setSystemDark(true)
    env.setSystemDark(false)
    expect(theme.isDark()).toBe(true)
    const restarted = environment(env.stored(), false)
    expect(createThemeController({ ...restarted, storage: () => restarted.storage }).isDark()).toBe(true)
    theme.setPreference('system')
    expect(env.stored()).toBe('system')
    expect(theme.isDark()).toBe(false)
    env.setSystemDark(true)
    expect(theme.isDark()).toBe(true)
    expect(onChange).toHaveBeenCalled()
  })

  it('其他窗口更新偏好后重新读取最新存储值，不重复写入', () => {
    const env = environment(null, false)
    const write = vi.spyOn(env.storage, 'setItem')
    const first = createThemeController({ ...env, storage: () => env.storage })
    const otherRoot = { dataset: {} as Record<string, string> }
    const second = createThemeController({ ...env, root: otherRoot, storage: () => env.storage })
    first.setPreference('dark')
    second.refreshPreference()
    expect(second.getPreference()).toBe('dark')
    expect(otherRoot.dataset.theme).toBe('dark')
    expect(write).toHaveBeenCalledTimes(1)
    first.setPreference('light')
    second.refreshPreference()
    expect(second.getPreference()).toBe('light')
    expect(otherRoot.dataset.theme).toBe('light')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('桌面系统模式使用窗口原生主题，忽略其他窗口改变的 WebView 配色', async () => {
    const env = environment(null, false)
    const getNativeTheme = vi.fn().mockResolvedValue('dark')
    const theme = createThemeController({
      ...env, storage: () => env.storage,
      setNativeTheme: async () => {}, getNativeTheme,
    })
    await vi.waitFor(() => expect(theme.isDark()).toBe(true))
    env.setSystemDark(false)
    expect(theme.isDark()).toBe(true)
    theme.setSystemTheme('light')
    expect(theme.isDark()).toBe(false)
    env.setSystemDark(true)
    expect(theme.isDark()).toBe(false)
  })

  it('迟到的原生主题查询不覆盖后续手动选择', async () => {
    const env = environment(null, false)
    let resolve!: (value: 'light' | 'dark') => void
    const nativeResult = new Promise<'light' | 'dark'>((done) => { resolve = done })
    const getNativeTheme = vi.fn().mockReturnValue(nativeResult)
    const theme = createThemeController({
      ...env, storage: () => env.storage,
      setNativeTheme: async () => {}, getNativeTheme,
    })
    await vi.waitFor(() => expect(getNativeTheme).toHaveBeenCalled())
    theme.setPreference('dark')
    resolve('light')
    await Promise.resolve()
    await Promise.resolve()
    expect(theme.getPreference()).toBe('dark')
    expect(theme.isDark()).toBe(true)
  })

  it('较早发出的原生查询不会覆盖随后收到的系统主题事件', async () => {
    const env = environment(null, false)
    let resolve!: (value: 'light' | 'dark') => void
    const getNativeTheme = vi.fn().mockReturnValue(new Promise<'light' | 'dark'>((done) => { resolve = done }))
    const theme = createThemeController({
      ...env, storage: () => env.storage, setNativeTheme: async () => {}, getNativeTheme,
    })
    await vi.waitFor(() => expect(getNativeTheme).toHaveBeenCalled())
    theme.setSystemTheme('dark')
    resolve('light')
    await Promise.resolve()
    await Promise.resolve()
    expect(theme.isDark()).toBe(true)
  })

  it('较早的原生查询迟到时不覆盖更新的查询结果', async () => {
    const env = environment(null, false)
    let finishFirst!: (value: 'light' | 'dark') => void
    let finishSecond!: (value: 'light' | 'dark') => void
    const getNativeTheme = vi.fn()
      .mockReturnValueOnce(new Promise<'light' | 'dark'>((done) => { finishFirst = done }))
      .mockReturnValueOnce(new Promise<'light' | 'dark'>((done) => { finishSecond = done }))
    const theme = createThemeController({
      ...env, storage: () => env.storage, setNativeTheme: async () => {}, getNativeTheme,
    })
    await vi.waitFor(() => expect(getNativeTheme).toHaveBeenCalledTimes(1))
    theme.refreshSystemTheme()
    finishSecond('dark')
    await Promise.resolve()
    finishFirst('light')
    await Promise.resolve()
    expect(theme.isDark()).toBe(true)
  })

  it('原生系统主题查询迟迟不返回时，后续手动选择仍能同步到窗口', async () => {
    const env = environment(null, false)
    const getNativeTheme = vi.fn().mockReturnValue(new Promise(() => {}))
    const setNativeTheme = vi.fn().mockResolvedValue(undefined)
    const theme = createThemeController({ ...env, storage: () => env.storage, setNativeTheme, getNativeTheme })
    await vi.waitFor(() => expect(getNativeTheme).toHaveBeenCalled())
    theme.setPreference('dark')
    await vi.waitFor(() => expect(setNativeTheme.mock.calls).toEqual([[null], ['dark']]))
    expect(theme.isDark()).toBe(true)
  })

  it('读取或写入存储失败时仍可在本次运行内切换', () => {
    const env = environment(null, true)
    const theme = createThemeController({ ...env, storage: () => { throw new Error('unavailable') } })
    expect(theme.getPreference()).toBe('system')
    theme.setPreference('light')
    expect(theme.isDark()).toBe(false)
    expect(env.root.dataset.theme).toBe('light')
  })

  it('原生窗口调用串行执行，快速切换后以最新选择为准，失败也不阻塞', async () => {
    const env = environment()
    let finish!: () => void
    const first = new Promise<void>((resolve) => { finish = resolve })
    const native = vi.fn<(value: 'light' | 'dark' | null) => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockRejectedValueOnce(new Error('native unavailable'))
      .mockResolvedValue(undefined)
    const theme = createThemeController({ ...env, storage: () => env.storage, setNativeTheme: native })
    theme.setPreference('dark')
    theme.setPreference('light')
    expect(native.mock.calls).toEqual([[null]])
    finish()
    await vi.waitFor(() => expect(native.mock.calls).toEqual([[null], ['light']]))
    theme.setPreference('system')
    await vi.waitFor(() => expect(native.mock.calls[native.mock.calls.length - 1]).toEqual([null]))
    expect(theme.getPreference()).toBe('system')
  })

  it('图标控件互斥显示选中状态，鼠标操作保留编辑器选区', () => {
    const env = environment()
    const theme = createThemeController({ ...env, storage: () => env.storage })
    const buttons = ['light', 'dark', 'system'].map((choice) => {
      const handlers: Record<string, (event: { preventDefault: () => void }) => void> = {}
      const attrs: Record<string, string> = {}
      return {
        dataset: { themeChoice: choice }, attrs, handlers,
        setAttribute: (key: string, value: string) => { attrs[key] = value },
        addEventListener: (name: string, handler: (event: { preventDefault: () => void }) => void) => { handlers[name] = handler },
      }
    })
    installThemeControls({ querySelectorAll: () => buttons } as unknown as HTMLElement, theme)
    expect(buttons.map((button) => button.attrs['aria-pressed'])).toEqual(['false', 'false', 'true'])
    const preventDefault = vi.fn()
    buttons[1].handlers.mousedown({ preventDefault })
    buttons[1].handlers.click({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(theme.getPreference()).toBe('dark')
    expect(buttons.map((button) => button.attrs['aria-pressed'])).toEqual(['false', 'true', 'false'])
  })
})
