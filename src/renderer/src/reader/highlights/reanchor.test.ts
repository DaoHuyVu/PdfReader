import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { reanchorHighlight } from './reanchor'
import { buildTextIndex, type TextRun } from './textIndex'

const RUNS: TextRun[] = [
  { pageIndex: 0, text: 'Payment terms apply', rect: { x: 0, y: 10, width: 190, height: 10 }, hasEOL: true },
  { pageIndex: 3, text: 'Payment terms again', rect: { x: 0, y: 40, width: 190, height: 10 }, hasEOL: false }
]
const INDEX = buildTextIndex(RUNS)

function carried(text: string, pageIndex: number, y: number): Highlight {
  return {
    id: 'h',
    color: 'yellow',
    note: 'kept',
    text,
    parts: [{ pageIndex, rects: [{ x: 0, y, width: 50, height: 10 }] }],
    createdAt: 1,
    updatedAt: 1,
    status: 'carried'
  }
}

describe('reanchorHighlight', () => {
  it('moves the Highlight to its text and clears the status', () => {
    const result = reanchorHighlight(INDEX, carried('payment TERMS', 0, 12), 99)
    expect(result.status).toBeUndefined()
    expect(result.updatedAt).toBe(99)
    expect(result.note).toBe('kept')
    expect(result.parts).toEqual([{ pageIndex: 0, rects: [{ x: 0, y: 10, width: 130, height: 10 }] }])
  })

  it('prefers the occurrence closest to the old page', () => {
    const result = reanchorHighlight(INDEX, carried('payment terms', 3, 40), 99)
    expect(result.parts[0].pageIndex).toBe(3)
  })

  it('marks the Highlight Unanchored when its text is gone', () => {
    const result = reanchorHighlight(INDEX, carried('termination clause', 0, 10), 99)
    expect(result.status).toBe('unanchored')
    expect(result.parts).toEqual(carried('termination clause', 0, 10).parts)
    expect(result.updatedAt).toBe(99)
  })
})
