import type { HighlightPart } from '../../../../shared/documentData'

interface SearchLayerProps {
  entries: { hitIndex: number; part: HighlightPart }[]
  scale: number
  currentHit: number
}

export function SearchLayer({ entries, scale, currentHit }: SearchLayerProps) {
  return (
    <div className="search-layer">
      {entries.flatMap(({ hitIndex, part }) =>
        part.rects.map((rect, rectIndex) => (
          <div
            key={`${hitIndex}-${rectIndex}`}
            className={hitIndex === currentHit ? 'search-hit current' : 'search-hit'}
            style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}
          />
        ))
      )}
    </div>
  )
}
