import { useCallback, useState } from 'react'
import type { Highlight } from '../../../../shared/documentData'

export interface HighlightActions {
  highlights: Highlight[]
  save(highlight: Highlight): void
  remove(id: string): void
}

/** Highlights of the open Document, updated optimistically and persisted through main. */
export function useHighlights(initial: Highlight[], onError: () => void): HighlightActions {
  const [highlights, setHighlights] = useState(initial)

  const save = useCallback(
    (highlight: Highlight) => {
      setHighlights((current) => [...current.filter((h) => h.id !== highlight.id), highlight])
      window.api.saveHighlight(highlight).catch((err) => {
        console.error('Failed to save highlight', err)
        onError()
      })
    },
    [onError]
  )

  const remove = useCallback(
    (id: string) => {
      setHighlights((current) => current.filter((h) => h.id !== id))
      window.api.deleteHighlight(id).catch((err) => {
        console.error('Failed to delete highlight', err)
        onError()
      })
    },
    [onError]
  )

  return { highlights, save, remove }
}
