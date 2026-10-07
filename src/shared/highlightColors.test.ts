import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_COLORS } from './documentData'
import { HIGHLIGHT_RGB, highlightCss } from './highlightColors'

describe('highlightColors', () => {
  it('defines a color for every Highlight Color', () => {
    expect(Object.keys(HIGHLIGHT_RGB).sort()).toEqual([...HIGHLIGHT_COLORS].sort())
  })

  it('formats CSS rgba with 0-255 channels', () => {
    expect(highlightCss('yellow', 0.5)).toBe('rgba(255, 227, 51, 0.5)')
    expect(highlightCss('blue')).toBe('rgba(115, 184, 255, 1)')
  })
})
