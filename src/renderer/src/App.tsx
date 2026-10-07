import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])
  return <pre>{JSON.stringify(context, null, 2)}</pre>
}
