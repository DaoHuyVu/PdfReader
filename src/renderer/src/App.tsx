import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'
import { ReaderView } from './reader/ReaderView'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])
  if (!context) return null
  if (context.kind === 'document') return <ReaderView />
  return <pre>{JSON.stringify(context, null, 2)}</pre>
}
