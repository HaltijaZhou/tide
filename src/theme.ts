export type ThemePreference = 'light' | 'dark' | 'system'

export interface ThemeController {
  getPreference(): ThemePreference
  isDark(): boolean
  setPreference(preference: ThemePreference): void
  subscribe(listener: () => void): () => void
}

interface ThemeEnvironment {
  root: { dataset: { theme?: string } }
  media: {
    readonly matches: boolean
    addEventListener(type: 'change', listener: () => void): void
    removeEventListener?(type: 'change', listener: () => void): void
  }
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
  setNativeTheme?: (theme: 'light' | 'dark' | null) => Promise<void>
}

const STORAGE_KEY = 'tide-theme-preference'

function isPreference(value: string | null | undefined): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function createThemeController(environment: ThemeEnvironment): ThemeController {
  let preference: ThemePreference = 'system'
  try {
    const stored = environment.storage().getItem(STORAGE_KEY)
    if (isPreference(stored)) preference = stored
  } catch { /* Local storage can be disabled; keep the system default. */ }

  const listeners = new Set<() => void>()
  const isDark = () => preference === 'dark' || (preference === 'system' && environment.media.matches)
  const render = () => {
    environment.root.dataset.theme = isDark() ? 'dark' : 'light'
    listeners.forEach((listener) => listener())
  }

  let pendingNative: ThemePreference | undefined
  let nativeRunning = false
  const syncNative = async () => {
    if (nativeRunning || !environment.setNativeTheme) return
    nativeRunning = true
    while (pendingNative !== undefined) {
      const next = pendingNative
      pendingNative = undefined
      try { await environment.setNativeTheme(next === 'system' ? null : next) } catch { /* The editor still works. */ }
    }
    nativeRunning = false
  }
  const queueNative = () => { pendingNative = preference; void syncNative() }

  environment.media.addEventListener('change', () => {
    if (preference === 'system') render()
  })
  render()
  queueNative()

  return {
    getPreference: () => preference,
    isDark,
    setPreference(next) {
      if (!isPreference(next) || next === preference) return
      preference = next
      try { environment.storage().setItem(STORAGE_KEY, next) } catch { /* Keep the session choice. */ }
      render()
      queueNative()
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

export function installThemeControls(container: HTMLElement, theme: ThemeController): void {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'))
  const render = () => buttons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme.getPreference()))
  })
  buttons.forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      const choice = button.dataset.themeChoice
      if (isPreference(choice)) theme.setPreference(choice)
    })
  })
  theme.subscribe(render)
  render()
}
