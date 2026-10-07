import type { ZoomSetting } from '../../../shared/documentData'

export const PAGE_GAP = 12
export const VIEW_PADDING = 16
export const MIN_SCALE = 0.1
export const MAX_SCALE = 5
export const ZOOM_STEPS = [25, 50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400]
export const MAX_CANVAS_PIXELS = 16_777_216
export const MAX_CANVAS_SIDE = 16_384

/** Page size in PDF units at scale 1. */
export interface PageSize {
  width: number
  height: number
}

/** Page placement in CSS pixels inside the scroll content. */
export interface PageBox {
  top: number
  width: number
  height: number
}

export interface PagePosition {
  pageIndex: number
  offsetRatio: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const clampScale = (scale: number) => clamp(scale, MIN_SCALE, MAX_SCALE)

export function computeScale(
  zoom: ZoomSetting,
  viewport: { width: number; height: number },
  pages: PageSize[]
): number {
  if (zoom.mode === 'percent') return clampScale(zoom.value / 100)
  if (pages.length === 0) return 1
  const maxWidth = Math.max(...pages.map((p) => p.width))
  const fitWidth = (viewport.width - 2 * VIEW_PADDING) / maxWidth
  if (zoom.mode === 'fit-width') return clampScale(fitWidth)
  const maxHeight = Math.max(...pages.map((p) => p.height))
  const fitHeight = (viewport.height - 2 * VIEW_PADDING) / maxHeight
  return clampScale(Math.min(fitWidth, fitHeight))
}

export function layoutPages(pages: PageSize[], scale: number): PageBox[] {
  let top = VIEW_PADDING
  return pages.map((page) => {
    const box = { top, width: page.width * scale, height: page.height * scale }
    top += box.height + PAGE_GAP
    return box
  })
}

export function totalHeight(boxes: PageBox[]): number {
  if (boxes.length === 0) return 0
  const last = boxes[boxes.length - 1]
  return last.top + last.height + VIEW_PADDING
}

export function contentWidth(boxes: PageBox[]): number {
  if (boxes.length === 0) return 0
  return Math.max(...boxes.map((b) => b.width)) + 2 * VIEW_PADDING
}

export function positionFromScroll(scrollTop: number, boxes: PageBox[]): PagePosition {
  if (boxes.length === 0) return { pageIndex: 0, offsetRatio: 0 }
  let pageIndex = 0
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].top <= scrollTop) pageIndex = i
    else break
  }
  const box = boxes[pageIndex]
  return { pageIndex, offsetRatio: clamp((scrollTop - box.top) / box.height, 0, 1) }
}

export function scrollTopForPosition(position: PagePosition, boxes: PageBox[]): number {
  if (boxes.length === 0) return 0
  const box = boxes[clamp(position.pageIndex, 0, boxes.length - 1)]
  return box.top + clamp(position.offsetRatio, 0, 1) * box.height
}

/** The page shown in the page indicator: the one a quarter of the way down the viewport. */
export function currentPageIndex(scrollTop: number, viewportHeight: number, boxes: PageBox[]): number {
  return positionFromScroll(scrollTop + viewportHeight * 0.25, boxes).pageIndex
}

export function visiblePageRange(
  scrollTop: number,
  viewportHeight: number,
  boxes: PageBox[],
  overscan = 1
): { first: number; last: number } {
  if (boxes.length === 0) return { first: 0, last: -1 }
  const bottom = scrollTop + viewportHeight
  let first = boxes.findIndex((b) => b.top + b.height >= scrollTop)
  if (first === -1) first = boxes.length - 1
  let last = first
  while (last + 1 < boxes.length && boxes[last + 1].top <= bottom) last++
  return { first: Math.max(0, first - overscan), last: Math.min(boxes.length - 1, last + overscan) }
}

/**
 * The largest ratio <= devicePixelRatio such that a cssWidth x cssHeight canvas scaled by
 * that ratio stays within Chromium's canvas area and side limits (so large pages at high
 * zoom render softer instead of blank).
 */
export function canvasPixelRatio(cssWidth: number, cssHeight: number, devicePixelRatio: number): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1
  if (cssWidth <= 0 || cssHeight <= 0) return dpr
  const areaLimit = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight))
  const sideLimit = Math.min(MAX_CANVAS_SIDE / cssWidth, MAX_CANVAS_SIDE / cssHeight)
  return Math.min(dpr, areaLimit, sideLimit)
}

export function stepZoom(currentScale: number, direction: 1 | -1): ZoomSetting {
  const current = currentScale * 100
  if (direction === 1) {
    const next = ZOOM_STEPS.find((step) => step > current + 0.5)
    return { mode: 'percent', value: next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1] }
  }
  const previous = [...ZOOM_STEPS].reverse().find((step) => step < current - 0.5)
  return { mode: 'percent', value: previous ?? ZOOM_STEPS[0] }
}
