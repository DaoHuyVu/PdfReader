import { useMemo, useState } from 'react'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'
import { t } from '../../../../shared/strings'
import { filterHighlights } from './filter'
import { sortHighlightsByPosition } from './geometry'

interface HighlightPanelProps {
  highlights: Highlight[]
  activeId: string | null
  onSelect(highlight: Highlight): void
}

export function HighlightPanel({ highlights, activeId, onSelect }: HighlightPanelProps) {
  const [query, setQuery] = useState('')
  const [colors, setColors] = useState<ReadonlySet<HighlightColor>>(new Set())
  const sorted = useMemo(() => sortHighlightsByPosition(highlights), [highlights])
  const shown = useMemo(() => filterHighlights(sorted, colors, query), [sorted, colors, query])

  const toggleColor = (color: HighlightColor) =>
    setColors((current) => {
      const next = new Set(current)
      if (next.has(color)) next.delete(color)
      else next.add(color)
      return next
    })

  return (
    <div className="highlight-panel">
      <div className="panel-header">
        {t.highlight.panelTitle} <span className="panel-count">{highlights.length}</span>
      </div>
      <input
        className="panel-search"
        type="search"
        placeholder={t.highlight.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="panel-colors">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            className={colors.has(color) ? 'swatch selected' : 'swatch'}
            style={{ background: highlightCss(color) }}
            title={t.highlight.colors[color]}
            aria-label={t.highlight.colors[color]}
            aria-pressed={colors.has(color)}
            onClick={() => toggleColor(color)}
          />
        ))}
      </div>
      {highlights.length === 0 ? (
        <p className="panel-empty">{t.highlight.empty}</p>
      ) : shown.length === 0 ? (
        <p className="panel-empty">{t.highlight.noMatch}</p>
      ) : (
        <ul className="panel-list">
          {shown.map((highlight) => {
            const unanchored = highlight.status === 'unanchored'
            const firstPage = highlight.parts[0]?.pageIndex
            const classes = ['panel-item', highlight.id === activeId ? 'active' : '', unanchored ? 'unanchored' : '']
            return (
              <li key={highlight.id}>
                <button className={classes.join(' ').trim()} disabled={unanchored} onClick={() => onSelect(highlight)}>
                  <span className="panel-dot" style={{ background: highlightCss(highlight.color) }} />
                  <span className="panel-text">{highlight.text}</span>
                  {highlight.note && <span className="panel-note">{highlight.note}</span>}
                  <span className="panel-meta">
                    {unanchored ? t.highlight.unanchored : firstPage !== undefined ? t.highlight.page(firstPage + 1) : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
