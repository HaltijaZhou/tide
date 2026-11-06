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
