import type { Highlight, HighlightPart } from '../../../../shared/documentData'
import { clientRectsToParts, highlightAt, type PageFrame } from './geometry'

// Matches geometry.ts's MIN_SIZE: below this, a rect is a collapsed/degenerate selection edge,
// not a real glyph box, and must not be used to anchor the toolbar.
const MIN_ANCHOR_RECT_SIZE = 0.5

export interface PendingSelection {
  parts: HighlightPart[]
  text: string
  /** Screen point (CSS px) just after the end of the selection, where the toolbar goes. */
  anchor: { x: number; y: number }
}

function pageFrames(container: HTMLElement): PageFrame[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.page[data-page-index]')).map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      pageIndex: Number(element.dataset.pageIndex),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  })
}

/**
 * Client rects of the text actually selected within `range`, one run per text node.
 * `range.getClientRects()` also reports a rect for any non-text element (e.g. a page's
 * `<canvas>`) that lies fully inside the range, which happens whenever a selection spans
 * from one page into the next; walking text nodes avoids that.
 */
function selectedTextRects(range: Range, container: HTMLElement): DOMRect[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const rects: DOMRect[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue
    const nodeRange = document.createRange()
    nodeRange.selectNodeContents(node)
    if (node === range.startContainer) nodeRange.setStart(node, range.startOffset)
    if (node === range.endContainer) nodeRange.setEnd(node, range.endOffset)
    rects.push(...Array.from(nodeRange.getClientRects()))
  }
  return rects
}

/** The current text selection inside `container`, converted to Highlight parts, or null. */
export function readSelection(container: HTMLElement, scale: number): PendingSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const clientRects = selectedTextRects(range, container)
  const parts = clientRectsToParts(clientRects, pageFrames(container), scale)
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (parts.length === 0 || text === '') return null
  const anchorRect = [...clientRects]
    .reverse()
    .find((r) => r.width >= MIN_ANCHOR_RECT_SIZE && r.height >= MIN_ANCHOR_RECT_SIZE)
  if (!anchorRect) return null
  return { parts, text, anchor: { x: anchorRect.right, y: anchorRect.bottom } }
}

/** The Highlight under a click, if the click landed on a page. */
export function hitTestHighlight(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  highlights: Highlight[],
  scale: number
): Highlight | null {
  if (!(target instanceof Element)) return null
  const pageElement = target.closest<HTMLElement>('.page[data-page-index]')
  if (!pageElement) return null
  const rect = pageElement.getBoundingClientRect()
  return highlightAt(
    highlights,
    Number(pageElement.dataset.pageIndex),
    (clientX - rect.left) / scale,
    (clientY - rect.top) / scale
  )
}

/** True when keyboard input should go to a form field, not to reader shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  )
}
