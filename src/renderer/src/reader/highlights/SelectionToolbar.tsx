import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'
import { t } from '../../../../shared/strings'

const TOOLBAR_WIDTH = 190
const TOOLBAR_HEIGHT = 40

interface SelectionToolbarProps {
  anchor: { x: number; y: number }
  onPick(color: HighlightColor): void
}

export function SelectionToolbar({ anchor, onPick }: SelectionToolbarProps) {
  const left = Math.max(8, Math.min(anchor.x - TOOLBAR_WIDTH / 2, window.innerWidth - TOOLBAR_WIDTH - 8))
  const top = Math.min(anchor.y + 8, window.innerHeight - TOOLBAR_HEIGHT - 8)
  return (
    // preventDefault on mousedown keeps the text selection alive while clicking a color.
    <div className="selection-toolbar" style={{ left, top }} onMouseDown={(event) => event.preventDefault()}>
      {HIGHLIGHT_COLORS.map((color, index) => {
        const label = t.highlight.colorButton(t.highlight.colors[color], index + 1)
        return (
          <button
            key={color}
            className="swatch"
            style={{ background: highlightCss(color) }}
            title={label}
            aria-label={label}
            onClick={() => onPick(color)}
          />
        )
      })}
    </div>
  )
}
