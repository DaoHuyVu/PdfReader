import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'
import { HomeView } from './home/HomeView'
import { ReaderView } from './reader/ReaderView'
import { SettingsView } from './settings/SettingsView'
import { useAppliedTheme, useSettings } from './settings/useSettings'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  const [screen, setScreen] = useState<'recent' | 'settings'>('recent')
  const settings = useSettings()
  useAppliedTheme(settings?.theme ?? 'system')

  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])

  if (!context) return null
  if (context.kind === 'document') return <ReaderView invertPages={settings?.invertPages ?? false} />
  if (screen === 'settings') return <SettingsView settings={settings} onBack={() => setScreen('recent')} />
  return <HomeView onOpenSettings={() => setScreen('settings')} />
}
