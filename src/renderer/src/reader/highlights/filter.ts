import type { Highlight, HighlightColor } from '../../../../shared/documentData'
import { foldText } from './textIndex'

/** Panel filter: selected colors (none = all) and a case/diacritic-insensitive search in text and Note. */
export function filterHighlights(highlights: Highlight[], colors: ReadonlySet<HighlightColor>, query: string): Highlight[] {
  const needle = foldText(query).trim()
  return highlights.filter(
    (h) =>
      (colors.size === 0 || colors.has(h.color)) &&
      (needle === '' || foldText(h.text).includes(needle) || (h.note !== null && foldText(h.note).includes(needle)))
  )
}
