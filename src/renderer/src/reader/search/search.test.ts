import { describe, expect, it } from 'vitest'
import { buildTextIndex, type TextRun } from '../highlights/textIndex'
import { layoutPages } from '../layout'
import { firstHitFrom, hitsByPage, hitScrollTop, searchDocument, stepHit } from './search'

const RUNS: TextRun[] = [
  { pageIndex: 0, text: 'Hợp đồng mua bán', rect: { x: 0, y: 10, width: 160, height: 10 }, hasEOL: true },
  { pageIndex: 2, text: 'Phụ lục hợp đồng', rect: { x: 0, y: 30, width: 160, height: 10 }, hasEOL: false }
]
const INDEX = buildTextIndex(RUNS)

describe('searchDocument', () => {
  it('finds every hit ignoring case and diacritics', () => {
    const hits = searchDocument(INDEX, 'HOP DONG')
    expect(hits.map((h) => h.parts[0].pageIndex)).toEqual([0, 2])
  })

  it('returns no hits for an empty query', () => {
    expect(searchDocument(INDEX, '  ')).toEqual([])
  })
})

describe('stepHit', () => {
  it('wraps in both directions', () => {
    expect(stepHit(2, 3, 1)).toBe(0)
    expect(stepHit(0, 3, -1)).toBe(2)
    expect(stepHit(-1, 3, 1)).toBe(0)
    expect(stepHit(-1, 3, -1)).toBe(2)
    expect(stepHit(0, 0, 1)).toBe(-1)
  })
})

describe('firstHitFrom', () => {
  const hits = searchDocument(INDEX, 'hop dong')

  it('picks the first hit on or after a page, wrapping to the start', () => {
    expect(firstHitFrom(hits, 1)).toBe(1)
    expect(firstHitFrom(hits, 3)).toBe(0)
    expect(firstHitFrom([], 0)).toBe(-1)
  })
})

describe('hitScrollTop and hitsByPage', () => {
  const hits = searchDocument(INDEX, 'hop dong')
  const boxes = layoutPages(
    [
      { width: 200, height: 300 },
      { width: 200, height: 300 },
      { width: 200, height: 300 }
    ],
    1
  )

  it('scrolls a hit a margin below the top', () => {
    // Page 2 top = 16 + 300 + 12 + 300 + 12 = 640; hit y = 30.
    expect(hitScrollTop(hits[1], boxes, 1)).toBe(640 + 30 - 48)
  })

  it('groups hit parts by page with their hit index', () => {
    const byPage = hitsByPage(hits)
    expect(byPage.get(0)?.map((e) => e.hitIndex)).toEqual([0])
    expect(byPage.get(2)?.map((e) => e.hitIndex)).toEqual([1])
  })
})
