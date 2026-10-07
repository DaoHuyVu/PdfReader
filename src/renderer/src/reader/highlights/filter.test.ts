import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { filterHighlights } from './filter'

function hl(id: string, text: string, color: Highlight['color'], note: string | null = null): Highlight {
  return { id, color, note, text, parts: [], createdAt: 1, updatedAt: 1 }
}

const ITEMS = [hl('a', 'Điều khoản thanh toán', 'yellow'), hl('b', 'Phụ lục', 'green', 'Kiểm tra lại số tiền')]

describe('filterHighlights', () => {
  it('returns everything with no colors and no query', () => {
    expect(filterHighlights(ITEMS, new Set(), '').map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('filters by selected colors', () => {
    expect(filterHighlights(ITEMS, new Set(['green']), '').map((h) => h.id)).toEqual(['b'])
  })

  it('matches text or Note, ignoring case and diacritics', () => {
    expect(filterHighlights(ITEMS, new Set(), 'dieu KHOAN').map((h) => h.id)).toEqual(['a'])
    expect(filterHighlights(ITEMS, new Set(), 'so tien').map((h) => h.id)).toEqual(['b'])
  })

  it('combines colors and query', () => {
    expect(filterHighlights(ITEMS, new Set(['yellow']), 'phu luc')).toEqual([])
  })
})
