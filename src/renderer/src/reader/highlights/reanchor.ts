import type { Highlight, HighlightPart } from '../../../../shared/documentData'
import { findAllText, matchToParts, type TextIndex } from './textIndex'

const PAGE_WEIGHT = 100_000

/** Finds a carried Highlight's text in the Document; the closest occurrence to its old place wins. */
export function reanchorHighlight(index: TextIndex, highlight: Highlight, now: number): Highlight {
  const origin = highlight.parts[0]
  const originY = origin?.rects[0]?.y ?? 0
  let best: HighlightPart[] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const match of findAllText(index, highlight.text)) {
    const parts = matchToParts(index, match)
    const first = parts[0]
    if (!first) continue
    const score = origin
      ? Math.abs(first.pageIndex - origin.pageIndex) * PAGE_WEIGHT + Math.abs((first.rects[0]?.y ?? 0) - originY)
      : 0
    if (score < bestScore) {
      best = parts
      bestScore = score
    }
  }
  if (!best) return { ...highlight, status: 'unanchored', updatedAt: now }
  return { ...highlight, parts: best, status: undefined, updatedAt: now }
}

/**
 * Re-anchors the still-carried Highlights of `carriedIds` against the CURRENT list, so a
 * Highlight edited or deleted while the text index was building is not overwritten by a stale
 * copy. A Highlight that is gone, or whose status is no longer 'carried', is skipped.
 */
export function reanchorCarried(
  index: TextIndex,
  current: Highlight[],
  carriedIds: ReadonlySet<string>,
  now: number
): Highlight[] {
  const result: Highlight[] = []
  for (const highlight of current) {
    if (!carriedIds.has(highlight.id) || highlight.status !== 'carried') continue
    result.push(reanchorHighlight(index, highlight, now))
  }
  return result
}
