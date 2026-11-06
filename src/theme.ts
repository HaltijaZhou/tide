export type ThemePreference = 'light' | 'dark' | 'system'

export interface ThemeController {
  getPreference(): ThemePreference
  isDark(): boolean
  setPreference(preference: ThemePreference): void
  refreshPreference(): void
  refreshSystemTheme(): void
  setSystemTheme(theme: 'light' | 'dark'): void
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
  getNativeTheme?: () => Promise<'light' | 'dark' | null>
}

export const THEME_STORAGE_KEY = 'tide-theme-preference'

function isPreference(value: string | null | undefined): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function createThemeController(environment: ThemeEnvironment): ThemeController {
  let preference: ThemePreference = 'system'
  try {
    const stored = environment.storage().getItem(THEME_STORAGE_KEY)
    if (isPreference(stored)) preference = stored
  } catch { /* Local storage can be disabled; keep the system default. */ }

  const listeners = new Set<() => void>()
  let nativeSystemDark: boolean | undefined
  let revision = 0
  let nativeEventRevision = 0
  let nativeQueryRevision = 0
  const isDark = () => preference === 'dark'
    || (preference === 'system' && (nativeSystemDark ?? environment.media.matches))
  const render = () => {
    environment.root.dataset.theme = isDark() ? 'dark' : 'light'
    listeners.forEach((listener) => listener())
  }

  let pendingNative: ThemePreference | undefined
  let nativeRunning = false
  const refreshNativeTheme = async (requestedRevision: number) => {
    if (!environment.getNativeTheme) return
    const requestedEventRevision = nativeEventRevision
    const requestedQueryRevision = ++nativeQueryRevision
    try {
      const nativeTheme = await environment.getNativeTheme()
      if (revision === requestedRevision && nativeEventRevision === requestedEventRevision
        && nativeQueryRevision === requestedQueryRevision
        && preference === 'system' && (nativeTheme === 'light' || nativeTheme === 'dark')) {
        nativeSystemDark = nativeTheme === 'dark'
        render()
      }
    } catch { /* Keep the browser theme as a fallback. */ }
  }
  const syncNative = async () => {
    if (nativeRunning || !environment.setNativeTheme) return
    nativeRunning = true
    while (pendingNative !== undefined) {
      const next = pendingNative
      const requestedRevision = revision
      pendingNative = undefined
      try {
        await environment.setNativeTheme(next === 'system' ? null : next)
        if (next === 'system' && revision === requestedRevision) {
          void refreshNativeTheme(requestedRevision)
        }
      } catch { /* Keep the browser theme as a fallback. */ }
    }
    nativeRunning = false
  }
  const queueNative = () => { pendingNative = preference; void syncNative() }

  environment.media.addEventListener('change', () => {
    if (preference === 'system' && nativeSystemDark === undefined) render()
  })
  render()
  queueNative()

  const applyPreference = (next: ThemePreference, persist: boolean) => {
    if (next === preference) return
    preference = next
    revision += 1
    if (next === 'system') nativeSystemDark = undefined
    if (persist) {
      try { environment.storage().setItem(THEME_STORAGE_KEY, next) } catch { /* Keep the session choice. */ }
    }
    render()
    queueNative()
  }

  return {
    getPreference: () => preference,
    isDark,
    setPreference(next) { if (isPreference(next)) applyPreference(next, true) },
    refreshPreference() {
      try {
        const stored = environment.storage().getItem(THEME_STORAGE_KEY)
        applyPreference(isPreference(stored) ? stored : 'system', false)
      } catch { /* A failed read must not overwrite this window's selection. */ }
    },
    refreshSystemTheme() {
      if (preference === 'system') void refreshNativeTheme(revision)
    },
    setSystemTheme(next) {
      if (preference !== 'system') return
      nativeEventRevision += 1
      nativeSystemDark = next === 'dark'
      render()
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
