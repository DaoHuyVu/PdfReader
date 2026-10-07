import { useCallback, useEffect, useState } from 'react'
import { THEMES, type DataFolderInfo, type Settings } from '../../../shared/settings'
import { t } from '../../../shared/strings'

interface SettingsViewProps {
  settings: Settings | null
  onBack(): void
}

export function SettingsView({ settings, onBack }: SettingsViewProps) {
  const [info, setInfo] = useState<DataFolderInfo | null>(null)

  const refreshInfo = useCallback(() => {
    window.api.getDataFolderInfo().then(setInfo, (err) => console.error('Failed to read data folder info', err))
  }, [])

  useEffect(() => {
    refreshInfo()
  }, [refreshInfo, settings?.dataFolder])

  const update = (patch: Partial<Settings>) => {
    window.api.updateSettings(patch).catch((err) => console.error('Failed to update settings', err))
  }

  if (!settings || !info) return <div className="status">{t.reader.loading}</div>

  return (
    <div className="home settings">
      <header className="home-header">
        <button className="link-button" onClick={onBack}>
          {t.settings.back}
        </button>
      </header>
      <h1>{t.settings.title}</h1>

      <section className="settings-section">
        <h2>{t.settings.dataFolder}</h2>
        <p className="settings-help">{t.settings.dataFolderHelp}</p>
        <code className="settings-path">{info.path}</code>
        <p className="settings-source">{t.settings.source[info.source]}</p>
        <div className="settings-actions">
          <button onClick={() => window.api.chooseDataFolder().catch((err) => console.error(err))}>
            {t.settings.choose}
          </button>
          <button disabled={settings.dataFolder === null} onClick={() => update({ dataFolder: null })}>
            {t.settings.useDefault}
          </button>
        </div>
        {info.restartNeeded && (
          <div className="settings-restart">
            <p>{t.settings.restartNeeded}</p>
            <button onClick={() => window.api.relaunchApp()}>{t.settings.restart}</button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>{t.settings.theme}</h2>
        <div className="settings-radios" role="radiogroup" aria-label={t.settings.theme}>
          {THEMES.map((theme) => (
            <label key={theme}>
              <input
                type="radio"
                name="theme"
                checked={settings.theme === theme}
                onChange={() => update({ theme })}
              />
              {t.settings.themes[theme]}
            </label>
          ))}
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={settings.invertPages}
            onChange={(event) => update({ invertPages: event.target.checked })}
          />
          {t.settings.invertPages}
        </label>
      </section>
    </div>
  )
}
