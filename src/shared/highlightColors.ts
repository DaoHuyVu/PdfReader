import type { HighlightColor } from './documentData'

/** sRGB channels (0..1) of each Highlight Color, shared by the reader and PDF export. */
export const HIGHLIGHT_RGB: Record<HighlightColor, readonly [number, number, number]> = {
  yellow: [1, 0.89, 0.2],
  green: [0.56, 0.87, 0.4],
  blue: [0.45, 0.72, 1],
  pink: [1, 0.6, 0.8],
  orange: [1, 0.7, 0.3]
}

export function highlightCss(color: HighlightColor, alpha = 1): string {
  const [r, g, b] = HIGHLIGHT_RGB[color]
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}
