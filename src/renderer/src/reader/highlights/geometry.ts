import type { Highlight, HighlightPart, HighlightRect } from '../../../../shared/documentData'
import type { PageBox } from '../layout'

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

/** A page element's position on screen (CSS px), from getBoundingClientRect. */
export interface PageFrame {
  pageIndex: number
  left: number
  top: number
  width: number
  height: number
}

const MIN_SIZE = 0.5
export const SCROLL_MARGIN = 48

/** Converts selection rectangles (screen px) into Highlight parts (page units), one part per page. */
export function clientRectsToParts(rects: ClientRectLike[], pages: PageFrame[], scale: number): HighlightPart[] {
  const byPage = new Map<number, HighlightRect[]>()
  for (const r of rects) {
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) continue
    const centerX = r.left + r.width / 2
    const centerY = r.top + r.height / 2
    const page = pages.find(
      (p) => centerX >= p.left && centerX <= p.left + p.width && centerY >= p.top && centerY <= p.top + p.height
    )
    if (!page) continue
    const left = Math.max(r.left, page.left)
    const top = Math.max(r.top, page.top)
    const right = Math.min(r.left + r.width, page.left + page.width)
    const bottom = Math.min(r.top + r.height, page.top + page.height)
    const rect = {
      x: (left - page.left) / scale,
      y: (top - page.top) / scale,
      width: (right - left) / scale,
      height: (bottom - top) / scale
    }
    const list = byPage.get(page.pageIndex) ?? []
    list.push(rect)
    byPage.set(page.pageIndex, list)
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, pageRects]) => ({ pageIndex, rects: mergeLineRects(pageRects) }))
}

function sameLine(a: HighlightRect, b: HighlightRect): boolean {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlap > 0.5 * Math.min(a.height, b.height)
}

/** Groups rectangles into lines, then merges rectangles on a line that touch or overlap. */
export function mergeLineRects(rects: HighlightRect[]): HighlightRect[] {
  const lines: HighlightRect[][] = []
  for (const rect of [...rects].sort((a, b) => a.y - b.y)) {
    const line = lines.find((l) => sameLine(l[0], rect))
    if (line) line.push(rect)
    else lines.push([rect])
  }
  const merged: HighlightRect[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let current = { ...line[0] }
    for (const rect of line.slice(1)) {
      if (rect.x <= current.x + current.width + 1) {
        const right = Math.max(current.x + current.width, rect.x + rect.width)
        const top = Math.min(current.y, rect.y)
        const bottom = Math.max(current.y + current.height, rect.y + rect.height)
        current = { x: current.x, y: top, width: right - current.x, height: bottom - top }
      } else {
        merged.push(current)
        current = { ...rect }
      }
    }
    merged.push(current)
  }
  return merged
}

/** The topmost (most recently saved) anchored Highlight covering a point in page units. */
export function highlightAt(highlights: Highlight[], pageIndex: number, x: number, y: number): Highlight | null {
  for (let i = highlights.length - 1; i >= 0; i--) {
    const highlight = highlights[i]
    if (highlight.status === 'unanchored') continue
    for (const part of highlight.parts) {
      if (part.pageIndex !== pageIndex) continue
      if (part.rects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)) return highlight
    }
  }
  return null
}

export function highlightsByPage(highlights: Highlight[]): Map<number, Highlight[]> {
  const byPage = new Map<number, Highlight[]>()
  for (const highlight of highlights) {
    if (highlight.status === 'unanchored') continue
    for (const pageIndex of new Set(highlight.parts.map((p) => p.pageIndex))) {
      const list = byPage.get(pageIndex) ?? []
      list.push(highlight)
      byPage.set(pageIndex, list)
    }
  }
  return byPage
}

function anchorOf(highlight: Highlight): { page: number; y: number; x: number } | null {
  if (highlight.status === 'unanchored') return null
  const part = highlight.parts[0]
  const rect = part?.rects[0]
  if (!part || !rect) return null
  return { page: part.pageIndex, y: rect.y, x: rect.x }
}

export function sortHighlightsByPosition(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) => {
    const pa = anchorOf(a)
    const pb = anchorOf(b)
    if (!pa || !pb) return (pa ? -1 : pb ? 1 : 0) || a.createdAt - b.createdAt
    return pa.page - pb.page || pa.y - pb.y || pa.x - pb.x || a.createdAt - b.createdAt
  })
}

export function highlightScrollTop(highlight: Highlight, boxes: PageBox[], scale: number): number | null {
  const anchor = anchorOf(highlight)
  if (!anchor) return null
  const box = boxes[anchor.page]
  if (!box) return null
  return Math.max(0, box.top + anchor.y * scale - SCROLL_MARGIN)
}
