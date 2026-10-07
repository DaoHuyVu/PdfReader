import type { HighlightPart } from '../../../../shared/documentData'
import { SCROLL_MARGIN } from '../highlights/geometry'
import { findAllText, matchToParts, type TextIndex } from '../highlights/textIndex'
import type { PageBox } from '../layout'

export interface SearchHit {
  parts: HighlightPart[]
}

export function searchDocument(index: TextIndex, query: string): SearchHit[] {
  return findAllText(index, query)
    .map((match) => ({ parts: matchToParts(index, match) }))
    .filter((hit) => hit.parts.length > 0)
}

/** Next/previous hit index, wrapping; -1 when there are no hits. */
export function stepHit(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

/** The first hit on or after `pageIndex`, else the first hit; -1 when there are none. */
export function firstHitFrom(hits: SearchHit[], pageIndex: number): number {
  if (hits.length === 0) return -1
  const index = hits.findIndex((hit) => hit.parts[0].pageIndex >= pageIndex)
  return index === -1 ? 0 : index
}

export function hitScrollTop(hit: SearchHit, boxes: PageBox[], scale: number): number | null {
  const part = hit.parts[0]
  const rect = part?.rects[0]
  const box = part ? boxes[part.pageIndex] : undefined
  if (!part || !rect || !box) return null
  return Math.max(0, box.top + rect.y * scale - SCROLL_MARGIN)
}

export function hitsByPage(hits: SearchHit[]): Map<number, { hitIndex: number; part: HighlightPart }[]> {
  const byPage = new Map<number, { hitIndex: number; part: HighlightPart }[]>()
  hits.forEach((hit, hitIndex) => {
    for (const part of hit.parts) {
      const list = byPage.get(part.pageIndex) ?? []
      list.push({ hitIndex, part })
      byPage.set(part.pageIndex, list)
    }
  })
  return byPage
}
