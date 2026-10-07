import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, type Highlight } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'
import { t } from '../../../../shared/strings'

const MENU_WIDTH = 280
const MENU_HEIGHT = 230

interface HighlightMenuProps {
  highlight: Highlight
  anchor: { x: number; y: number }
  onChange(next: Highlight): void
  onDelete(): void
  onClose(): void
}

export function HighlightMenu({ highlight, anchor, onChange, onDelete, onClose }: HighlightMenuProps) {
  const [note, setNote] = useState(highlight.note ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const update = (patch: Partial<Pick<Highlight, 'color' | 'note'>>) =>
    onChange({ ...highlight, ...patch, updatedAt: Date.now() })

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.y + 8, window.innerHeight - MENU_HEIGHT - 8))

  return (
    <div ref={ref} className="highlight-menu" style={{ left, top, width: MENU_WIDTH }}>
      <div className="menu-swatches">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            className={color === highlight.color ? 'swatch selected' : 'swatch'}
            style={{ background: highlightCss(color) }}
            title={t.highlight.colors[color]}
            aria-label={t.highlight.colors[color]}
            onClick={() => update({ color })}
          />
        ))}
      </div>
      <label className="menu-note">
        {t.highlight.note}
        <textarea
          rows={4}
          value={note}
          placeholder={t.highlight.notePlaceholder}
          onChange={(event) => setNote(event.target.value)}
          autoFocus
        />
      </label>
      <div className="menu-actions">
        <button
          onClick={() => {
            const trimmed = note.trim()
            update({ note: trimmed === '' ? null : trimmed })
            onClose()
          }}
        >
          {t.highlight.saveNote}
        </button>
        <button className="danger" onClick={onDelete}>
          {t.highlight.delete}
        </button>
      </div>
    </div>
  )
}
