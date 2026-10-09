import type { DocumentData, Fingerprint, Highlight, ReadingPosition } from './documentData'
import type { DataFolderInfo, Settings } from './settings'

export const IPC = {
  getContext: 'window:get-context',
  readDocumentBytes: 'document:read-bytes',
  loadDocumentData: 'document:load-data',
  reportReadingPosition: 'document:report-reading-position',
  flushReadingPosition: 'document:flush-reading-position',
  saveHighlight: 'document:save-highlight',
  deleteHighlight: 'document:delete-highlight',
  openFileDialog: 'app:open-file-dialog',
  openPath: 'app:open-path',
  listRecent: 'app:list-recent',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  getDataFolderInfo: 'settings:data-folder',
  chooseDataFolder: 'settings:choose-data-folder',
  relaunchApp: 'app:relaunch',
  exportPdf: 'document:export-pdf'
} as const

export type DocumentContext = { kind: 'document'; path: string; fileName: string; fingerprint: Fingerprint }
export type WindowContext = { kind: 'home' } | DocumentContext

export interface RecentView {
  fingerprint: Fingerprint
  path: string
  fileName: string
  openedAt: number
  exists: boolean
  /** Reading Progress from 0 to 1, or null if the Document was never read. */
  progress: number | null
}

export type OpenResult = { ok: true } | { ok: false; reason: 'missing' | 'not-pdf' | 'error'; message?: string }

export interface PdfReaderApi {
  getContext(): Promise<WindowContext>
  readDocumentBytes(): Promise<Uint8Array>
  loadDocumentData(): Promise<DocumentData>
  reportReadingPosition(reading: ReadingPosition, pageCount: number): void
  saveHighlight(highlight: Highlight): Promise<void>
  deleteHighlight(id: string): Promise<void>
  openFileDialog(): Promise<void>
  openPath(path: string): Promise<OpenResult>
  listRecent(): Promise<RecentView[]>
  flushReadingPosition(): void
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  /** Subscribes to Settings changes made in any window; returns an unsubscribe function. */
  onSettingsChanged(listener: (settings: Settings) => void): () => void
  getDataFolderInfo(): Promise<DataFolderInfo>
  chooseDataFolder(): Promise<string | null>
  relaunchApp(): void
  exportPdf(annotations: ExportAnnotation[]): Promise<ExportResult>
}

export interface ExportAnnotation {
  pageIndex: number
  /** [x1, y1, x2, y2] in PDF user space (origin bottom-left). */
  rect: [number, number, number, number]
  /** 8 numbers per rectangle: upper-left, upper-right, lower-left, lower-right corners (x, y). */
  quadPoints: number[]
  /** sRGB channels 0..1. */
  color: [number, number, number]
  note: string | null
}
export type ExportResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'same-file' | 'encrypted' | 'error'; message?: string }
