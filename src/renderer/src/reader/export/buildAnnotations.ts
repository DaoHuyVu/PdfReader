import type { Highlight } from '../../../../shared/documentData'
import { HIGHLIGHT_RGB } from '../../../../shared/highlightColors'
import type { ExportAnnotation } from '../../../../shared/ipc'

/** Converts a point in page units (scale 1, origin top-left) to PDF user space. */
export type ToPdfPoint = (pageIndex: number, x: number, y: number) => [number, number]

/** A Highlight can be exported when it is anchored (not unanchored or carried) and has geometry. */
export function isExportable(highlight: Highlight): boolean {
  return highlight.status !== 'unanchored' && highlight.status !== 'carried' && highlight.parts.some((p) => p.rects.length > 0)
}

export function buildExportAnnotations(highlights: Highlight[], toPdfPoint: ToPdfPoint): ExportAnnotation[] {
  const annotations: ExportAnnotation[] = []
  for (const highlight of highlights) {
    // A carried Highlight still has geometry from the old file, so its position is unverified.
    if (!isExportable(highlight)) continue
    let noteUsed = false
    for (const part of highlight.parts) {
      if (part.rects.length === 0) continue
      const quadPoints: number[] = []
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const r of part.rects) {
        const corners = [
          toPdfPoint(part.pageIndex, r.x, r.y),
          toPdfPoint(part.pageIndex, r.x + r.width, r.y),
          toPdfPoint(part.pageIndex, r.x, r.y + r.height),
          toPdfPoint(part.pageIndex, r.x + r.width, r.y + r.height)
        ]
        for (const [x, y] of corners) {
          quadPoints.push(x, y)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      const [r, g, b] = HIGHLIGHT_RGB[highlight.color]
      annotations.push({
        pageIndex: part.pageIndex,
        quadPoints,
        rect: [minX, minY, maxX, maxY],
        color: [r, g, b],
        note: noteUsed ? null : highlight.note
      })
      noteUsed = true
    }
  }
  return annotations
}
