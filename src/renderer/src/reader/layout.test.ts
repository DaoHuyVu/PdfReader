import { describe, expect, it } from 'vitest'
import {
  canvasPixelRatio,
  computeScale,
  contentWidth,
  currentPageIndex,
  layoutPages,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  positionFromScroll,
  scrollTopForPosition,
  stepZoom,
  totalHeight,
  visiblePageRange,
  type PageSize
} from './layout'

// Two pages: 100x200 and 100x100 PDF units.
const PAGES: PageSize[] = [
  { width: 100, height: 200 },
  { width: 100, height: 100 }
]
// At scale 2: page 0 top 16, height 400; page 1 top 16 + 400 + 12 = 428, height 200.
const BOXES = layoutPages(PAGES, 2)

describe('layoutPages', () => {
  it('stacks pages with padding and gaps', () => {
    expect(BOXES).toEqual([
      { top: 16, width: 200, height: 400 },
      { top: 428, width: 200, height: 200 }
    ])
  })

  it('reports total height and content width including padding', () => {
    expect(totalHeight(BOXES)).toBe(644)
    expect(contentWidth(BOXES)).toBe(232)
  })

  it('handles an empty Document', () => {
    expect(totalHeight([])).toBe(0)
    expect(contentWidth([])).toBe(0)
  })
})

describe('computeScale', () => {
  it('uses the percentage directly', () => {
    expect(computeScale({ mode: 'percent', value: 150 }, { width: 500, height: 500 }, PAGES)).toBe(1.5)
  })

  it('fits the widest page to the viewport width minus padding', () => {
    expect(computeScale({ mode: 'fit-width' }, { width: 432, height: 232 }, PAGES)).toBe(4)
  })

  it('fits the tallest page entirely for fit-page', () => {
    expect(computeScale({ mode: 'fit-page' }, { width: 432, height: 232 }, PAGES)).toBe(1)
  })

  it('clamps to the allowed range', () => {
    expect(computeScale({ mode: 'percent', value: 1000 }, { width: 1, height: 1 }, PAGES)).toBe(5)
    expect(computeScale({ mode: 'fit-width' }, { width: 0, height: 0 }, PAGES)).toBe(0.1)
  })

  it('is 1 for an empty Document', () => {
    expect(computeScale({ mode: 'fit-width' }, { width: 500, height: 500 }, [])).toBe(1)
  })
})

describe('positionFromScroll', () => {
  it('is the start of page 0 above the first page', () => {
    expect(positionFromScroll(0, BOXES)).toEqual({ pageIndex: 0, offsetRatio: 0 })
  })

  it('finds the page and ratio at the top of the viewport', () => {
    expect(positionFromScroll(216, BOXES)).toEqual({ pageIndex: 0, offsetRatio: 0.5 })
    expect(positionFromScroll(528, BOXES)).toEqual({ pageIndex: 1, offsetRatio: 0.5 })
  })

  it('treats the gap after a page as the end of that page', () => {
    expect(positionFromScroll(420, BOXES)).toEqual({ pageIndex: 0, offsetRatio: 1 })
  })

  it('is page 0 for an empty Document', () => {
    expect(positionFromScroll(100, [])).toEqual({ pageIndex: 0, offsetRatio: 0 })
  })
})

describe('scrollTopForPosition', () => {
  it('is the inverse of positionFromScroll', () => {
    expect(scrollTopForPosition({ pageIndex: 1, offsetRatio: 0.5 }, BOXES)).toBe(528)
  })

  it('clamps a page index beyond the Document', () => {
    expect(scrollTopForPosition({ pageIndex: 9, offsetRatio: 0 }, BOXES)).toBe(428)
  })

  it('keeps the same position across zoom levels', () => {
    const position = { pageIndex: 1, offsetRatio: 0.25 }
    const atScale1 = layoutPages(PAGES, 1)
    expect(positionFromScroll(scrollTopForPosition(position, atScale1), atScale1)).toEqual(position)
    expect(positionFromScroll(scrollTopForPosition(position, BOXES), BOXES)).toEqual(position)
  })
})

describe('currentPageIndex', () => {
  it('uses the point a quarter down the viewport', () => {
    expect(currentPageIndex(0, 400, BOXES)).toBe(0)
    expect(currentPageIndex(300, 600, BOXES)).toBe(1)
  })
})

describe('visiblePageRange', () => {
  it('covers pages intersecting the viewport', () => {
    expect(visiblePageRange(0, 300, BOXES, 0)).toEqual({ first: 0, last: 0 })
    expect(visiblePageRange(0, 500, BOXES, 0)).toEqual({ first: 0, last: 1 })
    expect(visiblePageRange(500, 100, BOXES, 0)).toEqual({ first: 1, last: 1 })
  })

  it('adds overscan pages within bounds', () => {
    expect(visiblePageRange(0, 300, BOXES, 1)).toEqual({ first: 0, last: 1 })
  })

  it('is empty for an empty Document', () => {
    expect(visiblePageRange(0, 300, [], 1)).toEqual({ first: 0, last: -1 })
  })
})

describe('canvasPixelRatio', () => {
  it('uses the device pixel ratio for a small page', () => {
    expect(canvasPixelRatio(600, 800, 2)).toBe(2)
  })

  it('caps the ratio so the canvas area stays within the limit', () => {
    const r = canvasPixelRatio(4000, 4000, 2)
    expect(4000 * r * (4000 * r)).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(r).toBeCloseTo(1.024, 3)
  })

  it('caps the ratio so neither canvas side exceeds the limit', () => {
    expect(canvasPixelRatio(20000, 100, 1)).toBeCloseTo(MAX_CANVAS_SIDE / 20000, 6)
  })

  it('treats a devicePixelRatio of 0 or less as 1', () => {
    expect(canvasPixelRatio(600, 800, 0)).toBe(1)
  })
})

describe('stepZoom', () => {
  it('moves to the next zoom step', () => {
    expect(stepZoom(1, 1)).toEqual({ mode: 'percent', value: 110 })
    expect(stepZoom(1, -1)).toEqual({ mode: 'percent', value: 90 })
  })

  it('snaps a fit scale to the nearest step in the direction', () => {
    expect(stepZoom(1.33, 1)).toEqual({ mode: 'percent', value: 150 })
    expect(stepZoom(1.33, -1)).toEqual({ mode: 'percent', value: 125 })
  })

  it('stops at the ends', () => {
    expect(stepZoom(4, 1)).toEqual({ mode: 'percent', value: 400 })
    expect(stepZoom(0.25, -1)).toEqual({ mode: 'percent', value: 25 })
  })
})
