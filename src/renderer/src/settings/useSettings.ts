import { useEffect, useState } from 'react'
import type { Settings, Theme } from '../../../shared/settings'

/** Current Settings, kept in sync with changes made in any window. Null until loaded. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let active = true
    window.api.getSettings().then(
      (loaded) => {
        if (active) setSettings(loaded)
      },
      (err) => console.error('Failed to load settings', err)
    )
    const unsubscribe = window.api.onSettingsChanged(setSettings)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return settings
}

/** Applies the theme as a `dark` class on <html>; 'system' follows Windows and its changes. */
export function useAppliedTheme(theme: Theme): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
