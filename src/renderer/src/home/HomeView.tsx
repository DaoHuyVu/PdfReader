import { useCallback, useEffect, useState } from 'react'
import type { RecentView } from '../../../shared/ipc'
import { t } from '../../../shared/strings'

export function HomeView({ onOpenSettings }: { onOpenSettings(): void }) {
  const [items, setItems] = useState<RecentView[] | null>(null)

  const refresh = useCallback(() => {
    void window.api.listRecent().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const open = async (item: RecentView) => {
    const result = await window.api.openPath(item.path)
    if (!result.ok) {
      alert(t.openError(item.path, result))
      refresh()
    }
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1>{t.home.title}</h1>
        <div className="home-actions">
          <button className="secondary" onClick={onOpenSettings}>
            {t.settings.open}
          </button>
          <button onClick={() => void window.api.openFileDialog()}>{t.home.open}</button>
        </div>
      </header>
      {items !== null && items.length === 0 && <p className="home-empty">{t.home.empty}</p>}
      <ul className="recent-list">
        {items?.map((item) => (
          <li key={item.fingerprint}>
            <button className={item.exists ? 'recent-item' : 'recent-item missing'} onClick={() => void open(item)}>
              <span className="recent-name">{item.fileName}</span>
              <span className="recent-path">{item.exists ? item.path : `${t.home.missing}: ${item.path}`}</span>
              <span className="recent-progress">
                <span className="progress-bar">
                  <span className="progress-fill" style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }} />
                </span>
                <span className="progress-label">
                  {item.progress === null ? t.home.notStarted : `${Math.round(item.progress * 100)}%`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
