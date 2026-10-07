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

export const HIGHLIGHT_STATUSES = ['carried', 'unanchored'] as const
/**
 * Absent: anchored normally.
 * 'carried': copied from an earlier version of the file by Carry Over; not yet re-anchored.
 * 'unanchored': its text could not be found in this Document (an Unanchored Highlight).
 */
export type HighlightStatus = (typeof HIGHLIGHT_STATUSES)[number]

export interface Highlight {
  id: string
  color: HighlightColor
  note: string | null
  /** The highlighted text, used to re-anchor the Highlight if the Document changes. */
  text: string
  parts: HighlightPart[]
  createdAt: number
  updatedAt: number
  status?: HighlightStatus
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

export const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/

export function isFingerprint(value: unknown): value is Fingerprint {
  return typeof value === 'string' && FINGERPRINT_PATTERN.test(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

function isZoomSetting(value: unknown): value is ZoomSetting {
  if (!isRecord(value)) return false
  if (value.mode === 'fit-width' || value.mode === 'fit-page') return true
  return value.mode === 'percent' && isFiniteNumber(value.value) && value.value > 0
}

export function isReadingPosition(value: unknown): value is ReadingPosition {
  return (
    isRecord(value) &&
    isIndex(value.pageIndex) &&
    isFiniteNumber(value.offsetRatio) &&
    value.offsetRatio >= 0 &&
    value.offsetRatio <= 1 &&
    isZoomSetting(value.zoom) &&
    isFiniteNumber(value.updatedAt)
  )
}

function isHighlightRect(value: unknown): value is HighlightRect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width >= 0 &&
    value.height >= 0
  )
}

function isHighlightPart(value: unknown): value is HighlightPart {
  return isRecord(value) && isIndex(value.pageIndex) && Array.isArray(value.rects) && value.rects.every(isHighlightRect)
}

export function isHighlight(value: unknown): value is Highlight {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    (HIGHLIGHT_COLORS as readonly unknown[]).includes(value.color) &&
    (value.note === null || typeof value.note === 'string') &&
    typeof value.text === 'string' &&
    Array.isArray(value.parts) &&
    value.parts.every(isHighlightPart) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    (value.status === undefined || (HIGHLIGHT_STATUSES as readonly unknown[]).includes(value.status))
  )
}

function isDeletedHighlight(value: unknown): value is DeletedHighlight {
  return isRecord(value) && typeof value.id === 'string' && value.id !== '' && isFiniteNumber(value.deletedAt)
}

const byCreation = (x: Highlight, y: Highlight) => x.createdAt - y.createdAt || x.id.localeCompare(y.id)
const byId = (x: DeletedHighlight, y: DeletedHighlight) => x.id.localeCompare(y.id)

export function emptyDocumentData(fingerprint: Fingerprint): DocumentData {
  return { schemaVersion: 1, fingerprint, pageCount: 0, reading: null, highlights: [], deletedHighlights: [] }
}

export function parseDocumentData(raw: unknown): DocumentData {
  if (typeof raw !== 'object' || raw === null) throw new Error('Document data is not an object')
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion: ${String(r.schemaVersion)}`)
  if (typeof r.fingerprint !== 'string' || r.fingerprint === '') throw new Error('Document data has no fingerprint')
  const deletedHighlights = Array.isArray(r.deletedHighlights) ? r.deletedHighlights.filter(isDeletedHighlight) : []
  const deletedIds = new Set(deletedHighlights.map((d) => d.id))
  const highlights = Array.isArray(r.highlights)
    ? r.highlights.filter(isHighlight).filter((h) => !deletedIds.has(h.id))
    : []
  return {
    schemaVersion: 1,
    fingerprint: r.fingerprint,
    pageCount: isIndex(r.pageCount) ? r.pageCount : 0,
    reading: isReadingPosition(r.reading) ? r.reading : null,
    highlights,
    deletedHighlights
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
    highlights: [...highlights.values()].sort(byCreation),
    deletedHighlights: [...deleted.values()].sort(byId)
  }
}

/** Returns whichever of `current`/`incoming` is newer, same tie-break as `mergeDocumentData`. */
export function newerReading(current: ReadingPosition | null, incoming: ReadingPosition): ReadingPosition {
  if (!current) return incoming
  return pickNewer(current, incoming)
}

export function readingProgress(reading: ReadingPosition | null, pageCount: number): number | null {
  if (!reading || pageCount <= 0) return null
  return Math.min(1, (reading.pageIndex + reading.offsetRatio) / pageCount)
}

export function upsertHighlight(data: DocumentData, highlight: Highlight): DocumentData {
  if (data.deletedHighlights.some((d) => d.id === highlight.id)) return data
  const others = data.highlights.filter((h) => h.id !== highlight.id)
  return { ...data, highlights: [...others, highlight].sort(byCreation) }
}

/** Rebuilds a Highlight from known fields only, dropping any extra properties before it is persisted. */
export function normalizeHighlight(highlight: Highlight): Highlight {
  const normalized: Highlight = {
    id: highlight.id,
    color: highlight.color,
    note: highlight.note,
    text: highlight.text,
    parts: highlight.parts.map((p) => ({
      pageIndex: p.pageIndex,
      rects: p.rects.map(({ x, y, width, height }) => ({ x, y, width, height }))
    })),
    createdAt: highlight.createdAt,
    updatedAt: highlight.updatedAt
  }
  if (highlight.status !== undefined) normalized.status = highlight.status
  return normalized
}

export function removeHighlight(data: DocumentData, id: string, deletedAt: number): DocumentData {
  const existing = data.deletedHighlights.find((d) => d.id === id)
  const deletedHighlights =
    existing && existing.deletedAt >= deletedAt
      ? data.deletedHighlights
      : [...data.deletedHighlights.filter((d) => d.id !== id), { id, deletedAt }].sort(byId)
  return { ...data, highlights: data.highlights.filter((h) => h.id !== id), deletedHighlights }
}

/** True when a Document has something worth offering to Carry Over. */
export function hasCarryableContent(data: DocumentData): boolean {
  return data.reading !== null || data.highlights.length > 0
}

/**
 * Carry Over: copies the reading position (only if the target has none) and the Highlights the
 * target does not already have or has not deleted. Carried Highlights get status 'carried' so the
 * reader re-anchors them against the new file's text.
 */
export function carryOver(source: DocumentData, target: DocumentData, now: number): DocumentData {
  const present = new Set(target.highlights.map((h) => h.id))
  const deleted = new Set(target.deletedHighlights.map((d) => d.id))
  const carried = source.highlights
    .filter((h) => !present.has(h.id) && !deleted.has(h.id))
    .map((h): Highlight => ({ ...h, status: 'carried', updatedAt: now }))
  return {
    ...target,
    reading: target.reading ?? (source.reading ? { ...source.reading, updatedAt: now } : null),
    highlights: [...target.highlights, ...carried].sort(byCreation)
  }
}
