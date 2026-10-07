import { describe, expect, it } from 'vitest'
import { layoutPages } from '../layout'
import { outlineScrollTop } from './outline'

// At scale 2: page 0 top 16 (height 400); page 1 top 428.
const BOXES = layoutPages(
  [
    { width: 100, height: 200 },
    { width: 100, height: 100 }
  ],
  2
)

describe('outlineScrollTop', () => {
  it('scrolls to the page top when the destination has no position', () => {
    expect(outlineScrollTop({ pageIndex: 1, top: null }, BOXES, 2)).toBe(428)
  })

  it('scrolls to the destination position inside the page', () => {
    expect(outlineScrollTop({ pageIndex: 1, top: 30 }, BOXES, 2)).toBe(488)
  })

  it('clamps a position above the page and rejects unknown pages', () => {
    expect(outlineScrollTop({ pageIndex: 0, top: -50 }, BOXES, 2)).toBe(16)
    expect(outlineScrollTop({ pageIndex: 7, top: null }, BOXES, 2)).toBeNull()
  })
})
