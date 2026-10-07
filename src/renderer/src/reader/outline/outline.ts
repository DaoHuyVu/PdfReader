import type { PageBox } from '../layout'

/** Where an outline entry points: a page, and optionally a position on it (page units, scale 1). */
export interface OutlineTarget {
  pageIndex: number
  top: number | null
}

export interface OutlineNode {
  title: string
  target: OutlineTarget | null
  children: OutlineNode[]
}

export function outlineScrollTop(target: OutlineTarget, boxes: PageBox[], scale: number): number | null {
  const box = boxes[target.pageIndex]
  if (!box) return null
  return Math.max(0, box.top + Math.max(0, target.top ?? 0) * scale)
}
