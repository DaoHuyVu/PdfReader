import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { layoutPages } from '../layout'
import {
  clientRectsToParts,
  highlightAt,
  highlightsByPage,
  highlightScrollTop,
  mergeLineRects,
  sortHighlightsByPosition,
  type PageFrame
} from './geometry'

function hl(id: string, parts: Highlight['parts'], extra: Partial<Highlight> = {}): Highlight {
  return { id, color: 'yellow', note: null, text: id, parts, createdAt: 1, updatedAt: 1, ...extra }
}

const PAGES: PageFrame[] = [
  { pageIndex: 0, left: 100, top: 50, width: 200, height: 300 },
  { pageIndex: 1, left: 100, top: 362, width: 200, height: 300 }
]

describe('clientRectsToParts', () => {
  it('converts screen rectangles to page units per page and drops noise', () => {
    const parts = clientRectsToParts(
      [
        { left: 120, top: 70, width: 40, height: 10 },
        { left: 110, top: 372, width: 20, height: 10 },
        { left: 130, top: 80, width: 0.2, height: 10 },
        { left: 0, top: 0, width: 10, height: 10 }
      ],
      PAGES,
      2
    )
    expect(parts).toEqual([
      { pageIndex: 0, rects: [{ x: 10, y: 10, width: 20, height: 5 }] },
      { pageIndex: 1, rects: [{ x: 5, y: 5, width: 10, height: 5 }] }
    ])
  })
})

describe('mergeLineRects', () => {
  it('merges touching rectangles on the same line and keeps gaps and lines apart', () => {
    expect(
      mergeLineRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10.5, y: 0.5, width: 10, height: 10 },
        { x: 50, y: 0, width: 10, height: 10 },
        { x: 0, y: 20, width: 10, height: 10 }
      ])
    ).toEqual([
      { x: 0, y: 0, width: 20.5, height: 10.5 },
      { x: 50, y: 0, width: 10, height: 10 },
      { x: 0, y: 20, width: 10, height: 10 }
    ])
  })

  it('absorbs a rectangle contained in another', () => {
    expect(
      mergeLineRects([
        { x: 0, y: 0, width: 100, height: 10 },
        { x: 10, y: 1, width: 20, height: 8 }
      ])
    ).toEqual([{ x: 0, y: 0, width: 100, height: 10 }])
  })
})

describe('highlightAt', () => {
  const a = hl('a', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 50, height: 10 }] }])
  const b = hl('b', [{ pageIndex: 0, rects: [{ x: 40, y: 0, width: 50, height: 10 }] }])
  const lost = hl('lost', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 500, height: 500 }] }], { status: 'unanchored' })

  it('returns the topmost (last) Highlight under the point', () => {
    expect(highlightAt([a, b], 0, 45, 5)?.id).toBe('b')
    expect(highlightAt([a, b], 0, 5, 5)?.id).toBe('a')
  })

  it('ignores other pages, misses and Unanchored Highlights', () => {
    expect(highlightAt([a], 1, 5, 5)).toBeNull()
    expect(highlightAt([a], 0, 5, 50)).toBeNull()
    expect(highlightAt([lost], 0, 5, 5)).toBeNull()
  })
})

describe('highlightsByPage', () => {
  it('lists a cross-page Highlight on each page and skips Unanchored ones', () => {
    const cross = hl('cross', [
      { pageIndex: 0, rects: [] },
      { pageIndex: 1, rects: [] }
    ])
    const lost = hl('lost', [{ pageIndex: 0, rects: [] }], { status: 'unanchored' })
    const byPage = highlightsByPage([cross, lost])
    expect(byPage.get(0)?.map((h) => h.id)).toEqual(['cross'])
    expect(byPage.get(1)?.map((h) => h.id)).toEqual(['cross'])
  })
})

describe('sortHighlightsByPosition', () => {
  it('sorts by page, then top, then left, with Unanchored Highlights last', () => {
    const p1 = hl('p1', [{ pageIndex: 1, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }])
    const low = hl('low', [{ pageIndex: 0, rects: [{ x: 0, y: 50, width: 1, height: 1 }] }])
    const right = hl('right', [{ pageIndex: 0, rects: [{ x: 30, y: 10, width: 1, height: 1 }] }])
    const left = hl('left', [{ pageIndex: 0, rects: [{ x: 5, y: 10, width: 1, height: 1 }] }])
    const lost = hl('lost', [], { status: 'unanchored' })
    expect(sortHighlightsByPosition([lost, p1, low, right, left]).map((h) => h.id)).toEqual([
      'left',
      'right',
      'low',
      'p1',
      'lost'
    ])
  })
})

describe('highlightScrollTop', () => {
  // At scale 2: page 0 top 16 height 400; page 1 top 428.
  const boxes = layoutPages(
    [
      { width: 100, height: 200 },
      { width: 100, height: 100 }
    ],
    2
  )

  it('scrolls so the Highlight sits a margin below the top of the viewport', () => {
    const h = hl('h', [{ pageIndex: 1, rects: [{ x: 0, y: 50, width: 1, height: 1 }] }])
    expect(highlightScrollTop(h, boxes, 2)).toBe(428 + 100 - 48)
  })

  it('is null for Unanchored Highlights and unknown pages', () => {
    expect(highlightScrollTop(hl('x', [], { status: 'unanchored' }), boxes, 2)).toBeNull()
    expect(highlightScrollTop(hl('y', [{ pageIndex: 9, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }]), boxes, 2)).toBeNull()
  })
})
