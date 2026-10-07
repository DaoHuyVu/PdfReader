import type { Highlight } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'

interface HighlightLayerProps {
  highlights: Highlight[]
  pageIndex: number
  scale: number
  activeId: string | null
}

export function HighlightLayer({ highlights, pageIndex, scale, activeId }: HighlightLayerProps) {
  return (
    <div className="highlight-layer">
      {highlights.flatMap((highlight) =>
        highlight.parts
          .filter((part) => part.pageIndex === pageIndex)
          .flatMap((part, partIndex) =>
            part.rects.map((rect, rectIndex) => (
              <div
                key={`${highlight.id}-${partIndex}-${rectIndex}`}
                className={highlight.id === activeId ? 'highlight-rect active' : 'highlight-rect'}
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.height * scale,
                  background: highlightCss(highlight.color, 0.45)
                }}
              />
            ))
          )
      )}
    </div>
  )
}
