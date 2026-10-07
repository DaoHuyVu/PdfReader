import { describe, expect, it } from 'vitest'
import { buildTextIndex, findAllText, findText, foldText, matchToParts, type TextRun } from './textIndex'

const RUNS: TextRun[] = [
  { pageIndex: 0, text: 'Hello world', rect: { x: 0, y: 0, width: 110, height: 10 }, hasEOL: true },
  { pageIndex: 0, text: 'Second line', rect: { x: 0, y: 20, width: 110, height: 10 }, hasEOL: false },
  { pageIndex: 1, text: 'Next page', rect: { x: 5, y: 5, width: 90, height: 10 }, hasEOL: false }
]

describe('foldText', () => {
  it('lower-cases, removes Vietnamese diacritics and collapses whitespace', () => {
    expect(foldText('Tìm  Kiếm\nĐường ')).toBe('tim kiem duong')
  })
})

describe('buildTextIndex', () => {
  it('joins runs with spaces at line ends and page breaks', () => {
    expect(buildTextIndex(RUNS).text).toBe('hello world second line next page')
  })

  it('maps every character back to its run', () => {
    const index = buildTextIndex(RUNS)
    expect(index.refs).toHaveLength(index.text.length)
    expect(index.refs[0]).toEqual({ run: 0, offset: 0 })
    expect(index.refs[11]).toBeNull() // the space inserted for the line end
  })
})

describe('findText', () => {
  const index = buildTextIndex(RUNS)

  it('matches case- and diacritic-insensitively across lines', () => {
    expect(findText(index, 'WORLD Second')).toEqual({ start: 6, end: 18 })
  })

  it('returns null for an empty query or no match', () => {
    expect(findText(index, '   ')).toBeNull()
    expect(findText(index, 'missing')).toBeNull()
  })

  it('searches from a given position', () => {
    const twice = buildTextIndex([{ pageIndex: 0, text: 'ab ab', rect: { x: 0, y: 0, width: 50, height: 10 }, hasEOL: false }])
    expect(findText(twice, 'ab', 1)).toEqual({ start: 3, end: 5 })
  })
})

describe('findAllText', () => {
  it('returns every non-overlapping match', () => {
    const index = buildTextIndex([{ pageIndex: 0, text: 'aaaa', rect: { x: 0, y: 0, width: 40, height: 10 }, hasEOL: false }])
    expect(findAllText(index, 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
  })
})

describe('matchToParts', () => {
  const index = buildTextIndex(RUNS)

  it('slices run rectangles in proportion to the matched characters', () => {
    expect(matchToParts(index, findText(index, 'world second')!)).toEqual([
      {
        pageIndex: 0,
        rects: [
          { x: 60, y: 0, width: 50, height: 10 },
          { x: 0, y: 20, width: 60, height: 10 }
        ]
      }
    ])
  })

  it('returns one part per page for a match across a page break', () => {
    expect(matchToParts(index, findText(index, 'line next')!)).toEqual([
      { pageIndex: 0, rects: [{ x: 70, y: 20, width: 40, height: 10 }] },
      { pageIndex: 1, rects: [{ x: 5, y: 5, width: 40, height: 10 }] }
    ])
  })
})
