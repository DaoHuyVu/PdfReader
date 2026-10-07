export type Fingerprint = string

export type ZoomSetting = { mode: 'fit-width' } | { mode: 'fit-page' } | { mode: 'percent'; value: number }

export interface ReadingPosition {
  /** 0-based index of the page at the top of the viewport. */
  pageIndex: number
  /** How far down that page the top of the viewport is, from 0 to 1. */
  offsetRatio: number
  zoom: ZoomSetting
  /** Epoch milliseconds. */
  updatedAt: number
}

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

/** A rectangle in PDF user-space units on one page (scale 1, origin top-left). */
export interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface HighlightPart {
  pageIndex: number
  rects: HighlightRect[]
}

export interface Highlight {
  id: string
  color: HighlightColor
  note: string | null
  /** The highlighted text, used to re-anchor the Highlight if the Document changes. */
  text: string
  parts: HighlightPart[]
  createdAt: number
  updatedAt: number
}

export interface DeletedHighlight {
  id: string
  deletedAt: number
}

export interface DocumentData {
  schemaVersion: 1
  fingerprint: Fingerprint
  pageCount: number
  reading: ReadingPosition | null
  highlights: Highlight[]
  deletedHighlights: DeletedHighlight[]
}

export function emptyDocumentData(fingerprint: Fingerprint): DocumentData {
  return { schemaVersion: 1, fingerprint, pageCount: 0, reading: null, highlights: [], deletedHighlights: [] }
}

export function parseDocumentData(raw: unknown): DocumentData {
  if (typeof raw !== 'object' || raw === null) throw new Error('Document data is not an object')
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${String(r.schemaVersion)}`)
  if (typeof r.fingerprint !== 'string' || r.fingerprint === '') throw new Error('Document data has no fingerprint')
  return {
    schemaVersion: 1,
    fingerprint: r.fingerprint,
    pageCount: typeof r.pageCount === 'number' ? r.pageCount : 0,
    reading: (r.reading ?? null) as ReadingPosition | null,
    highlights: Array.isArray(r.highlights) ? (r.highlights as Highlight[]) : [],
    deletedHighlights: Array.isArray(r.deletedHighlights) ? (r.deletedHighlights as DeletedHighlight[]) : []
  }
}

/** Picks the value with the higher updatedAt; ties are broken by content so merge order never matters. */
function pickNewer<T extends { updatedAt: number }>(a: T, b: T): T {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt > a.updatedAt ? b : a
  return JSON.stringify(b) > JSON.stringify(a) ? b : a
}

export function mergeDocumentData(a: DocumentData, b: DocumentData): DocumentData {
  const deleted = new Map<string, DeletedHighlight>()
  for (const d of [...a.deletedHighlights, ...b.deletedHighlights]) {
    const existing = deleted.get(d.id)
    if (!existing || d.deletedAt > existing.deletedAt) deleted.set(d.id, d)
  }

  const highlights = new Map<string, Highlight>()
  for (const h of [...a.highlights, ...b.highlights]) {
    if (deleted.has(h.id)) continue
    const existing = highlights.get(h.id)
    highlights.set(h.id, existing ? pickNewer(existing, h) : h)
  }

  let reading: ReadingPosition | null = a.reading ?? b.reading
  if (a.reading && b.reading) reading = pickNewer(a.reading, b.reading)

  return {
    schemaVersion: 1,
    fingerprint: a.fingerprint,
    pageCount: Math.max(a.pageCount, b.pageCount),
    reading,
    highlights: [...highlights.values()].sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id)),
    deletedHighlights: [...deleted.values()].sort((x, y) => x.id.localeCompare(y.id))
  }
}

export function readingProgress(reading: ReadingPosition | null, pageCount: number): number | null {
  if (!reading || pageCount <= 0) return null
  return Math.min(1, (reading.pageIndex + reading.offsetRatio) / pageCount)
}
