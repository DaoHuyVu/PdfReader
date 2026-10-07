import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'
import { HomeView } from './home/HomeView'
import { ReaderView } from './reader/ReaderView'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])
  if (!context) return null
  return context.kind === 'document' ? <ReaderView /> : <HomeView />
}
