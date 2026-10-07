import { describe, expect, it } from 'vitest'
import {
  emptyDocumentData,
  mergeDocumentData,
  newerReading,
  parseDocumentData,
  readingProgress,
  type DocumentData,
  type Highlight,
  type ReadingPosition
} from './documentData'

const FP = 'f'.repeat(64)

function reading(pageIndex: number, updatedAt: number, offsetRatio = 0): ReadingPosition {
  return { pageIndex, offsetRatio, zoom: { mode: 'fit-width' }, updatedAt }
}

function highlight(id: string, updatedAt = 1, createdAt = 1): Highlight {
  return {
    id,
    color: 'yellow',
    note: null,
    text: `text ${id}`,
    parts: [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] }],
    createdAt,
    updatedAt
  }
}

function doc(patch: Partial<DocumentData>): DocumentData {
  return { ...emptyDocumentData(FP), ...patch }
}

describe('emptyDocumentData', () => {
  it('has no reading position and no highlights', () => {
    expect(emptyDocumentData(FP)).toEqual({
      schemaVersion: 1,
      fingerprint: FP,
      pageCount: 0,
      reading: null,
      highlights: [],
      deletedHighlights: []
    })
  })
})

describe('parseDocumentData', () => {
  it('round-trips serialized data', () => {
    const data = doc({ pageCount: 12, reading: reading(3, 100), highlights: [highlight('a')] })
    expect(parseDocumentData(JSON.parse(JSON.stringify(data)))).toEqual(data)
  })

  it('fills missing arrays and pageCount with defaults', () => {
    expect(parseDocumentData({ schemaVersion: 1, fingerprint: FP })).toEqual(emptyDocumentData(FP))
  })

  it('rejects non-objects', () => {
    expect(() => parseDocumentData('nope')).toThrow()
    expect(() => parseDocumentData(null)).toThrow()
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseDocumentData({ schemaVersion: 2, fingerprint: FP })).toThrow(/schemaVersion/)
  })

  it('rejects missing fingerprint', () => {
    expect(() => parseDocumentData({ schemaVersion: 1 })).toThrow(/fingerprint/)
  })
})

describe('mergeDocumentData', () => {
  it('keeps the more recently updated reading position', () => {
    const older = doc({ reading: reading(80, 1000) })
    const newer = doc({ reading: reading(60, 2000) })
    expect(mergeDocumentData(older, newer).reading).toEqual(reading(60, 2000))
    expect(mergeDocumentData(newer, older).reading).toEqual(reading(60, 2000))
  })

  it('keeps a reading position when the other side has none', () => {
    expect(mergeDocumentData(doc({}), doc({ reading: reading(5, 1) })).reading).toEqual(reading(5, 1))
    expect(mergeDocumentData(doc({ reading: reading(5, 1) }), doc({})).reading).toEqual(reading(5, 1))
  })

  it('unions highlights by id', () => {
    const merged = mergeDocumentData(doc({ highlights: [highlight('a')] }), doc({ highlights: [highlight('b')] }))
    expect(merged.highlights.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('keeps the more recently updated version of the same highlight', () => {
    const old = { ...highlight('a', 1), color: 'yellow' as const }
    const edited = { ...highlight('a', 5), color: 'green' as const }
    expect(mergeDocumentData(doc({ highlights: [old] }), doc({ highlights: [edited] })).highlights).toEqual([edited])
    expect(mergeDocumentData(doc({ highlights: [edited] }), doc({ highlights: [old] })).highlights).toEqual([edited])
  })

  it('drops a highlight that the other side deleted, even if edited later', () => {
    const merged = mergeDocumentData(
      doc({ highlights: [highlight('a', 999)] }),
      doc({ deletedHighlights: [{ id: 'a', deletedAt: 10 }] })
    )
    expect(merged.highlights).toEqual([])
    expect(merged.deletedHighlights).toEqual([{ id: 'a', deletedAt: 10 }])
  })

  it('unions deleted highlights and keeps the latest deletedAt', () => {
    const merged = mergeDocumentData(
      doc({ deletedHighlights: [{ id: 'a', deletedAt: 1 }, { id: 'c', deletedAt: 3 }] }),
      doc({ deletedHighlights: [{ id: 'a', deletedAt: 7 }, { id: 'b', deletedAt: 2 }] })
    )
    expect(merged.deletedHighlights).toEqual([
      { id: 'a', deletedAt: 7 },
      { id: 'b', deletedAt: 2 },
      { id: 'c', deletedAt: 3 }
    ])
  })

  it('sorts highlights by createdAt, then id', () => {
    const merged = mergeDocumentData(
      doc({ highlights: [highlight('z', 1, 5), highlight('b', 1, 2)] }),
      doc({ highlights: [highlight('a', 1, 2)] })
    )
    expect(merged.highlights.map((h) => h.id)).toEqual(['a', 'b', 'z'])
  })

  it('takes the larger pageCount', () => {
    expect(mergeDocumentData(doc({ pageCount: 0 }), doc({ pageCount: 40 })).pageCount).toBe(40)
  })

  it('gives the same result in either order', () => {
    const a = doc({ pageCount: 10, reading: reading(2, 50), highlights: [highlight('x', 3)], deletedHighlights: [{ id: 'y', deletedAt: 4 }] })
    const b = doc({ pageCount: 10, reading: reading(7, 60), highlights: [highlight('x', 9), highlight('y', 1)] })
    expect(mergeDocumentData(a, b)).toEqual(mergeDocumentData(b, a))
  })
})

describe('newerReading', () => {
  it('returns incoming when current is null', () => {
    const incoming = reading(5, 10)
    expect(newerReading(null, incoming)).toEqual(incoming)
  })

  it('returns incoming when current is older', () => {
    const current = reading(1, 100)
    const incoming = reading(2, 200)
    expect(newerReading(current, incoming)).toEqual(incoming)
  })

  it('returns current when current is newer', () => {
    const current = reading(2, 200)
    const incoming = reading(1, 100)
    expect(newerReading(current, incoming)).toEqual(current)
  })

  it('on equal timestamps, picks the same result as mergeDocumentData, order-independent', () => {
    const current = reading(1, 100)
    const incoming = reading(2, 100)
    const viaMerge = mergeDocumentData(doc({ reading: current }), doc({ reading: incoming })).reading
    expect(newerReading(current, incoming)).toEqual(viaMerge)
    expect(newerReading(incoming, current)).toEqual(viaMerge)
  })
})

describe('readingProgress', () => {
  it('is null when there is no reading position', () => {
    expect(readingProgress(null, 10)).toBeNull()
  })

  it('is null when the page count is unknown', () => {
    expect(readingProgress(reading(3, 1), 0)).toBeNull()
  })

  it('counts pages before the position plus the offset within the page', () => {
    expect(readingProgress(reading(4, 1, 0.5), 10)).toBeCloseTo(0.45)
  })

  it('never exceeds 1', () => {
    expect(readingProgress(reading(20, 1, 1), 10)).toBe(1)
  })
})
