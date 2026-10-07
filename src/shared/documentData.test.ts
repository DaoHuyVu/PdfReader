import { describe, expect, it } from 'vitest'
import {
  carryOver,
  emptyDocumentData,
  hasCarryableContent,
  isFingerprint,
  isHighlight,
  isReadingPosition,
  mergeDocumentData,
  newerReading,
  parseDocumentData,
  readingProgress,
  removeHighlight,
  upsertHighlight,
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

describe('isFingerprint', () => {
  it('accepts 64 lowercase hex characters only', () => {
    expect(isFingerprint('a'.repeat(64))).toBe(true)
    expect(isFingerprint('A'.repeat(64))).toBe(false)
    expect(isFingerprint('a'.repeat(63))).toBe(false)
    expect(isFingerprint('..\\..\\x')).toBe(false)
    expect(isFingerprint(42)).toBe(false)
  })
})

describe('isReadingPosition', () => {
  it('accepts a valid position', () => {
    expect(isReadingPosition(reading(3, 100, 0.5))).toBe(true)
    expect(isReadingPosition({ ...reading(0, 1), zoom: { mode: 'percent', value: 150 } })).toBe(true)
  })

  it('rejects out-of-range or malformed values', () => {
    expect(isReadingPosition({ ...reading(0, 1), pageIndex: -1 })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), pageIndex: 1.5 })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), offsetRatio: 2 })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), zoom: { mode: 'percent', value: 0 } })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), zoom: { mode: 'huge' } })).toBe(false)
    expect(isReadingPosition({ pageIndex: 0, offsetRatio: 0, zoom: { mode: 'fit-width' } })).toBe(false)
    expect(isReadingPosition(null)).toBe(false)
  })
})

describe('isHighlight', () => {
  it('accepts a valid Highlight, with or without status', () => {
    expect(isHighlight(highlight('a'))).toBe(true)
    expect(isHighlight({ ...highlight('a'), status: 'carried' })).toBe(true)
    expect(isHighlight({ ...highlight('a'), note: 'my note' })).toBe(true)
  })

  it('rejects malformed Highlights', () => {
    expect(isHighlight({ ...highlight('a'), color: 'red' })).toBe(false)
    expect(isHighlight({ ...highlight('a'), id: '' })).toBe(false)
    expect(isHighlight({ ...highlight('a'), status: 'weird' })).toBe(false)
    expect(isHighlight({ ...highlight('a'), note: 3 })).toBe(false)
    expect(
      isHighlight({ ...highlight('a'), parts: [{ pageIndex: 0, rects: [{ x: Number.NaN, y: 0, width: 1, height: 1 }] }] })
    ).toBe(false)
    expect(isHighlight({ ...highlight('a'), parts: [{ pageIndex: -1, rects: [] }] })).toBe(false)
  })
})

describe('parseDocumentData validation', () => {
  it('drops invalid nested values instead of trusting them', () => {
    const parsed = parseDocumentData({
      schemaVersion: 1,
      fingerprint: FP,
      pageCount: -3,
      reading: { pageIndex: 'x' },
      highlights: [highlight('ok'), { id: 'bad' }],
      deletedHighlights: [{ id: 'gone', deletedAt: 5 }, { id: 7 }]
    })
    expect(parsed.pageCount).toBe(0)
    expect(parsed.reading).toBeNull()
    expect(parsed.highlights.map((h) => h.id)).toEqual(['ok'])
    expect(parsed.deletedHighlights).toEqual([{ id: 'gone', deletedAt: 5 }])
  })
})

describe('upsertHighlight', () => {
  it('adds a new Highlight, sorted by createdAt', () => {
    const data = upsertHighlight(doc({ highlights: [highlight('b', 1, 5)] }), highlight('a', 1, 2))
    expect(data.highlights.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('replaces a Highlight with the same id', () => {
    const edited = { ...highlight('a', 9), color: 'green' as const }
    expect(upsertHighlight(doc({ highlights: [highlight('a')] }), edited).highlights).toEqual([edited])
  })
})

describe('removeHighlight', () => {
  it('removes the Highlight and records a Deleted Highlight', () => {
    const data = removeHighlight(doc({ highlights: [highlight('a'), highlight('b')] }), 'a', 50)
    expect(data.highlights.map((h) => h.id)).toEqual(['b'])
    expect(data.deletedHighlights).toEqual([{ id: 'a', deletedAt: 50 }])
  })

  it('keeps a later existing deletion time', () => {
    const data = removeHighlight(doc({ deletedHighlights: [{ id: 'a', deletedAt: 90 }] }), 'a', 50)
    expect(data.deletedHighlights).toEqual([{ id: 'a', deletedAt: 90 }])
  })
})

describe('hasCarryableContent', () => {
  it('is true when there is a reading position or a Highlight', () => {
    expect(hasCarryableContent(doc({}))).toBe(false)
    expect(hasCarryableContent(doc({ reading: reading(1, 1) }))).toBe(true)
    expect(hasCarryableContent(doc({ highlights: [highlight('a')] }))).toBe(true)
  })
})

describe('carryOver', () => {
  const OLD = 'e'.repeat(64)

  it('copies the reading position and Highlights, stamped with now', () => {
    const source: DocumentData = { ...emptyDocumentData(OLD), reading: reading(7, 10), highlights: [highlight('a', 3)] }
    const result = carryOver(source, doc({}), 1000)
    expect(result.fingerprint).toBe(FP)
    expect(result.reading).toEqual(reading(7, 1000))
    expect(result.highlights).toEqual([{ ...highlight('a', 3), status: 'carried', updatedAt: 1000 }])
  })

  it('keeps the target reading position when it already has one', () => {
    const source: DocumentData = { ...emptyDocumentData(OLD), reading: reading(7, 10) }
    expect(carryOver(source, doc({ reading: reading(2, 5) }), 1000).reading).toEqual(reading(2, 5))
  })

  it('skips Highlights the target already has or has deleted', () => {
    const source: DocumentData = {
      ...emptyDocumentData(OLD),
      highlights: [highlight('kept'), highlight('dup'), highlight('deleted')]
    }
    const target = doc({ highlights: [highlight('dup', 9)], deletedHighlights: [{ id: 'deleted', deletedAt: 4 }] })
    const result = carryOver(source, target, 1000)
    expect(result.highlights.map((h) => [h.id, h.status])).toEqual([
      ['dup', undefined],
      ['kept', 'carried']
    ])
  })
})
