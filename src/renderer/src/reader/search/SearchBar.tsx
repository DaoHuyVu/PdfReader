import { useEffect, useRef } from 'react'
import { t } from '../../../../shared/strings'

interface SearchBarProps {
  query: string
  onQuery(query: string): void
  status: 'idle' | 'searching' | 'done'
  count: number
  current: number
  /** Changes every time Ctrl+F is pressed, to re-focus the box. */
  focusKey: number
  onStep(direction: 1 | -1): void
  onClose(): void
}

export function SearchBar({ query, onQuery, status, count, current, focusKey, onStep, onClose }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusKey])

  const label =
    status === 'searching'
      ? t.search.searching
      : query.trim() === ''
        ? ''
        : count === 0
          ? t.search.none
          : t.search.count(current + 1, count)

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={t.search.placeholder}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            onStep(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      />
      <span className="search-count">{label}</span>
      <button title={t.search.previous} disabled={count === 0} onClick={() => onStep(-1)}>
        ↑
      </button>
      <button title={t.search.next} disabled={count === 0} onClick={() => onStep(1)}>
        ↓
      </button>
      <button title={t.search.close} onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
