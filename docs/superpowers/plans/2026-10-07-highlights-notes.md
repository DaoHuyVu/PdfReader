# Highlights & Notes Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader select text and save it as a colored Highlight with an optional Note, list and search Highlights in a sidebar, and keep Highlights and the Reading Position when a PDF file changes (Carry Over + re-anchoring).

**Architecture:** pdf.js `TextLayer` makes page text selectable. A selection is converted from screen rectangles into page units (scale 1, origin top-left) and stored as a `Highlight` inside the existing per-Document JSON (schemaVersion stays 1). The renderer draws Highlights as absolutely positioned overlays per page and saves changes through two new IPC calls; main applies them with `store.update`. Carry Over runs in main before a changed file's window opens; re-anchoring runs in the renderer by searching each carried Highlight's text in a folded text index of the whole Document.

**Tech Stack:** Electron 38, electron-vite 4, React 19, TypeScript 5.9 strict, pdfjs-dist 4.10.38 (`TextLayer`, `Util`), Vitest 3.

**Prerequisite:** Plan 1 (`docs/superpowers/plans/2026-10-07-reader-core.md`) is complete, including Fix A–D and the packaging commit. Read `CONTEXT.md` and `docs/adr/` first; use the glossary terms (Document, Highlight, Highlight Color, Note, Unanchored Highlight, Carry Over, Deleted Highlight) in code names.

## Global Constraints

- Platform: Windows 10/11 x64. Paths are Windows paths; compare paths case-insensitively.
- The app NEVER writes to, renames, or deletes the user's PDF files. It only reads them.
- Data Folder: env var `PDFREADER_DATA_DIR` if set; else `%OneDriveConsumer%\PdfReaderData`; else `%APPDATA%\PdfReader`.
- Document data: exactly one file per Document at `<Data Folder>\documents\<fingerprint>.json`, written atomically. `schemaVersion` stays `1`; this plan only adds the optional Highlight field `status`.
- Document Fingerprint: 64 lowercase hex characters (`/^[0-9a-f]{64}$/`).
- Merge rules (unchanged): Reading Position takes the higher `updatedAt`; Highlights are unioned by `id` keeping the higher `updatedAt`; a Deleted Highlight always wins over a Highlight with the same `id`.
- Highlight geometry: every `HighlightRect` is in page units of pdf.js `page.getViewport({ scale: 1 })` — scale 1, origin at the top-left of the page.
- Highlight Colors, in this order (keys `1`–`5`): `yellow`, `green`, `blue`, `pink`, `orange`.
- A Highlight crossing a page break is ONE Highlight with one `part` per page.
- Opening a Document writes nothing by itself. Writes happen only on user actions (scroll, zoom, create/edit/delete Highlight), on a confirmed Carry Over, and when re-anchoring carried Highlights.
- All user-visible text lives in `src/shared/strings.ts`, in Vietnamese.
- `pdfjs-dist` is pinned to exactly `4.10.38`.
- `npm run typecheck` and `npm test` must pass at the end of every task.
- Every commit message ends with a `Co-Authored-By:` line naming the model that made the commit.

## Verification environment (for manual/app checks)

- Clear `ELECTRON_RUN_AS_NODE` for every Electron child process (some agent shells set it to `1`; PowerShell `Start-Process` with the variable removed works).
- Use an isolated Data Folder: `PDFREADER_DATA_DIR=<temp dir>`. Back up and restore `%APPDATA%\pdf-reader\recent.json` around checks.
- Build first (`npm run build`), then run `npx electron . "<pdf>" --remote-debugging-port=9222` and drive the window through the Chrome DevTools Protocol (screenshots, `Runtime.evaluate`, `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent`). Kill every `electron.exe` before and after each run (single-instance lock).
- Test PDFs with real text: generate a multi-page PDF whose pages contain several lines of Helvetica text (e.g. "Page N line M: the quick brown fox"). Keep scratch files in `.superpowers/sdd/tmp/` (git-ignored).

## Roadmap context

Plan 3 (reader features) adds an Outline tab to the sidebar created here and reuses `getDocumentTextIndex` / `findAllText` for Ctrl+F. Plan 4 (export) reuses `HIGHLIGHT_RGB` and the Highlight geometry.

## File Structure

```
src/shared/documentData.ts              + validators, Highlight status, upsert/remove, Carry Over
src/shared/highlightColors.ts           NEW Highlight Color RGB values + CSS helper (shared with Plan 4 export)
src/shared/ipc.ts                       + saveHighlight / deleteHighlight
src/shared/strings.ts                   + carryOver, highlight strings
src/main/documentStore.ts               + reject invalid fingerprints
src/main/recent.ts                      + findCarryOverSource
src/main/index.ts                       + highlight IPC, payload validation, Carry Over on open
src/preload/index.ts                    + saveHighlight / deleteHighlight
src/renderer/src/reader/PdfPage.tsx     + text layer, data-page-index, children overlay
src/renderer/src/reader/pdf.ts          + loadPageTextRuns, getDocumentTextIndex
src/renderer/src/reader/ReaderView.tsx  + highlights state, selection, menu, sidebar, re-anchoring
src/renderer/src/reader/highlights/
  textIndex.ts          pure: fold text, index text runs, find text, match -> parts
  geometry.ts           pure: client rects -> parts, merge rects, hit test, sort, scroll target
  filter.ts             pure: panel color/text filter
  reanchor.ts           pure: re-anchor a carried Highlight
  selection.ts          DOM: read current selection, hit test a click
  useHighlights.ts      React state + persistence
  HighlightLayer.tsx    per-page overlay
  SelectionToolbar.tsx  color picker for a new selection
  HighlightMenu.tsx     color / Note / delete for an existing Highlight
  HighlightPanel.tsx    sidebar list with search + color filter
src/renderer/src/styles.css             + text layer, highlight, toolbar, menu, sidebar styles
```

---

### Task 1: Highlight data rules and validation

**Files:**
- Modify: `src/shared/documentData.ts`
- Test: `src/shared/documentData.test.ts`

**Interfaces:**
- Consumes: existing exports of `src/shared/documentData.ts`.
- Produces (new exports of `src/shared/documentData.ts`):
  - `FINGERPRINT_PATTERN: RegExp`, `isFingerprint(value: unknown): value is Fingerprint`
  - `HIGHLIGHT_STATUSES = ['carried', 'unanchored'] as const`, `type HighlightStatus`
  - `Highlight.status?: HighlightStatus` (absent = anchored normally)
  - `isReadingPosition(value: unknown): value is ReadingPosition`
  - `isHighlight(value: unknown): value is Highlight`
  - `upsertHighlight(data: DocumentData, highlight: Highlight): DocumentData`
  - `removeHighlight(data: DocumentData, id: string, deletedAt: number): DocumentData`
  - `hasCarryableContent(data: DocumentData): boolean`
  - `carryOver(source: DocumentData, target: DocumentData, now: number): DocumentData`
  - `parseDocumentData` now drops invalid nested values instead of trusting them.

- [ ] **Step 1: Write the failing tests**

In `src/shared/documentData.test.ts`, replace the import block at the top with:

```ts
import { describe, expect, it } from 'vitest'
import {
  carryOver,
  emptyDocumentData,
  hasCarryableContent,
  isFingerprint,
  isHighlight,
  isReadingPosition,
  mergeDocumentData,
  newerReading,
  parseDocumentData,
  readingProgress,
  removeHighlight,
  upsertHighlight,
  type DocumentData,
  type Highlight,
  type ReadingPosition
} from './documentData'
```

Append at the end of the file:

```ts
describe('isFingerprint', () => {
  it('accepts 64 lowercase hex characters only', () => {
    expect(isFingerprint('a'.repeat(64))).toBe(true)
    expect(isFingerprint('A'.repeat(64))).toBe(false)
    expect(isFingerprint('a'.repeat(63))).toBe(false)
    expect(isFingerprint('..\\..\\x')).toBe(false)
    expect(isFingerprint(42)).toBe(false)
  })
})

describe('isReadingPosition', () => {
  it('accepts a valid position', () => {
    expect(isReadingPosition(reading(3, 100, 0.5))).toBe(true)
    expect(isReadingPosition({ ...reading(0, 1), zoom: { mode: 'percent', value: 150 } })).toBe(true)
  })

  it('rejects out-of-range or malformed values', () => {
    expect(isReadingPosition({ ...reading(0, 1), pageIndex: -1 })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), pageIndex: 1.5 })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), offsetRatio: 2 })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), zoom: { mode: 'percent', value: 0 } })).toBe(false)
    expect(isReadingPosition({ ...reading(0, 1), zoom: { mode: 'huge' } })).toBe(false)
    expect(isReadingPosition({ pageIndex: 0, offsetRatio: 0, zoom: { mode: 'fit-width' } })).toBe(false)
    expect(isReadingPosition(null)).toBe(false)
  })
})

describe('isHighlight', () => {
  it('accepts a valid Highlight, with or without status', () => {
    expect(isHighlight(highlight('a'))).toBe(true)
    expect(isHighlight({ ...highlight('a'), status: 'carried' })).toBe(true)
    expect(isHighlight({ ...highlight('a'), note: 'my note' })).toBe(true)
  })

  it('rejects malformed Highlights', () => {
    expect(isHighlight({ ...highlight('a'), color: 'red' })).toBe(false)
    expect(isHighlight({ ...highlight('a'), id: '' })).toBe(false)
    expect(isHighlight({ ...highlight('a'), status: 'weird' })).toBe(false)
    expect(isHighlight({ ...highlight('a'), note: 3 })).toBe(false)
    expect(
      isHighlight({ ...highlight('a'), parts: [{ pageIndex: 0, rects: [{ x: Number.NaN, y: 0, width: 1, height: 1 }] }] })
    ).toBe(false)
    expect(isHighlight({ ...highlight('a'), parts: [{ pageIndex: -1, rects: [] }] })).toBe(false)
  })
})

describe('parseDocumentData validation', () => {
  it('drops invalid nested values instead of trusting them', () => {
    const parsed = parseDocumentData({
      schemaVersion: 1,
      fingerprint: FP,
      pageCount: -3,
      reading: { pageIndex: 'x' },
      highlights: [highlight('ok'), { id: 'bad' }],
      deletedHighlights: [{ id: 'gone', deletedAt: 5 }, { id: 7 }]
    })
    expect(parsed.pageCount).toBe(0)
    expect(parsed.reading).toBeNull()
    expect(parsed.highlights.map((h) => h.id)).toEqual(['ok'])
    expect(parsed.deletedHighlights).toEqual([{ id: 'gone', deletedAt: 5 }])
  })
})

describe('upsertHighlight', () => {
  it('adds a new Highlight, sorted by createdAt', () => {
    const data = upsertHighlight(doc({ highlights: [highlight('b', 1, 5)] }), highlight('a', 1, 2))
    expect(data.highlights.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('replaces a Highlight with the same id', () => {
    const edited = { ...highlight('a', 9), color: 'green' as const }
    expect(upsertHighlight(doc({ highlights: [highlight('a')] }), edited).highlights).toEqual([edited])
  })
})

describe('removeHighlight', () => {
  it('removes the Highlight and records a Deleted Highlight', () => {
    const data = removeHighlight(doc({ highlights: [highlight('a'), highlight('b')] }), 'a', 50)
    expect(data.highlights.map((h) => h.id)).toEqual(['b'])
    expect(data.deletedHighlights).toEqual([{ id: 'a', deletedAt: 50 }])
  })

  it('keeps a later existing deletion time', () => {
    const data = removeHighlight(doc({ deletedHighlights: [{ id: 'a', deletedAt: 90 }] }), 'a', 50)
    expect(data.deletedHighlights).toEqual([{ id: 'a', deletedAt: 90 }])
  })
})

describe('hasCarryableContent', () => {
  it('is true when there is a reading position or a Highlight', () => {
    expect(hasCarryableContent(doc({}))).toBe(false)
    expect(hasCarryableContent(doc({ reading: reading(1, 1) }))).toBe(true)
    expect(hasCarryableContent(doc({ highlights: [highlight('a')] }))).toBe(true)
  })
})

describe('carryOver', () => {
  const OLD = 'e'.repeat(64)

  it('copies the reading position and Highlights, stamped with now', () => {
    const source: DocumentData = { ...emptyDocumentData(OLD), reading: reading(7, 10), highlights: [highlight('a', 3)] }
    const result = carryOver(source, doc({}), 1000)
    expect(result.fingerprint).toBe(FP)
    expect(result.reading).toEqual(reading(7, 1000))
    expect(result.highlights).toEqual([{ ...highlight('a', 3), status: 'carried', updatedAt: 1000 }])
  })

  it('keeps the target reading position when it already has one', () => {
    const source: DocumentData = { ...emptyDocumentData(OLD), reading: reading(7, 10) }
    expect(carryOver(source, doc({ reading: reading(2, 5) }), 1000).reading).toEqual(reading(2, 5))
  })

  it('skips Highlights the target already has or has deleted', () => {
    const source: DocumentData = {
      ...emptyDocumentData(OLD),
      highlights: [highlight('kept'), highlight('dup'), highlight('deleted')]
    }
    const target = doc({ highlights: [highlight('dup', 9)], deletedHighlights: [{ id: 'deleted', deletedAt: 4 }] })
    const result = carryOver(source, target, 1000)
    expect(result.highlights.map((h) => [h.id, h.status])).toEqual([
      ['dup', undefined],
      ['kept', 'carried']
    ])
  })
})
```

Note: `highlight('dup', 9)` and `highlight('kept')` both have `createdAt` 1, so the sort falls back to `id` (`dup` < `kept`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/documentData.test.ts`
Expected: FAIL — the new imports (`isFingerprint`, `carryOver`, …) are not exported.

- [ ] **Step 3: Implement in `src/shared/documentData.ts`**

3a. Replace the `Highlight` interface with:

```ts
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
```

3b. Directly after the `DocumentData` interface, add:

```ts
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
```

3c. Replace the `return { … }` of `parseDocumentData` with:

```ts
  return {
    schemaVersion: 1,
    fingerprint: r.fingerprint,
    pageCount: isIndex(r.pageCount) ? r.pageCount : 0,
    reading: isReadingPosition(r.reading) ? r.reading : null,
    highlights: Array.isArray(r.highlights) ? r.highlights.filter(isHighlight) : [],
    deletedHighlights: Array.isArray(r.deletedHighlights) ? r.deletedHighlights.filter(isDeletedHighlight) : []
  }
```

3d. In `mergeDocumentData`, replace the two `.sort(...)` callbacks with the shared comparators:

```ts
    highlights: [...highlights.values()].sort(byCreation),
    deletedHighlights: [...deleted.values()].sort(byId)
```

3e. At the end of the file, add:

```ts
export function upsertHighlight(data: DocumentData, highlight: Highlight): DocumentData {
  const others = data.highlights.filter((h) => h.id !== highlight.id)
  return { ...data, highlights: [...others, highlight].sort(byCreation) }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/documentData.test.ts`
Expected: PASS (all old and new tests).

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck` → exits 0. Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/documentData.ts src/shared/documentData.test.ts
git commit -m "feat: validate Document data and add Highlight edit and Carry Over rules

Co-Authored-By: <your model>"
```

---

### Task 2: Main process — Highlight IPC, payload validation, Carry Over on open

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/strings.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/recent.ts`, `src/main/documentStore.ts`
- Test: `src/main/recent.test.ts`, `src/main/documentStore.test.ts`

**Interfaces:**
- Consumes: Task 1 exports (`isFingerprint`, `isHighlight`, `isReadingPosition`, `upsertHighlight`, `removeHighlight`, `hasCarryableContent`, `carryOver`).
- Produces:
  - `IPC.saveHighlight = 'document:save-highlight'`, `IPC.deleteHighlight = 'document:delete-highlight'`
  - `PdfReaderApi.saveHighlight(highlight: Highlight): Promise<void>`, `PdfReaderApi.deleteHighlight(id: string): Promise<void>`
  - `findCarryOverSource(entries: RecentEntry[], path: string, fingerprint: Fingerprint): RecentEntry | null` in `src/main/recent.ts`
  - `DocumentStore.load/update` reject a non-Fingerprint argument with `Error('Invalid fingerprint: …')`
  - `t.carryOver` and `t.highlight` strings (used by Tasks 5–8)

- [ ] **Step 1: Write the failing tests**

In `src/main/recent.test.ts`, change the import line to:

```ts
import { addRecent, findCarryOverSource, RecentStore, type RecentEntry } from './recent'
```

and append:

```ts
describe('findCarryOverSource', () => {
  const OLD = 'a'.repeat(64)
  const NEW = 'b'.repeat(64)

  it('finds an entry with the same path (any case) and a different Fingerprint', () => {
    const entries = [entry(OLD, 'D:\\Books\\Contract.pdf')]
    expect(findCarryOverSource(entries, 'd:\\books\\contract.pdf', NEW)).toEqual(entries[0])
  })

  it('ignores the same Fingerprint and other paths', () => {
    expect(findCarryOverSource([entry(NEW, 'D:\\a.pdf')], 'D:\\a.pdf', NEW)).toBeNull()
    expect(findCarryOverSource([entry(OLD, 'D:\\b.pdf')], 'D:\\a.pdf', NEW)).toBeNull()
  })
})
```

In `src/main/documentStore.test.ts`, append inside the existing `describe('DocumentStore', …)` block (before its closing `})`):

```ts
  it('rejects a value that is not a Fingerprint', async () => {
    await expect(store.load('..\\..\\evil')).rejects.toThrow(/Invalid fingerprint/)
    await expect(store.update('ABC', (d) => d)).rejects.toThrow(/Invalid fingerprint/)
    expect(await readdir(dir).catch(() => [])).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/recent.test.ts src/main/documentStore.test.ts`
Expected: FAIL — `findCarryOverSource` is not exported; the store accepts the bad fingerprint.

- [ ] **Step 3: Implement `findCarryOverSource` in `src/main/recent.ts`**

Append:

```ts
/**
 * The Recent entry for the same path but a different Fingerprint: the file changed since it was
 * last opened here, so its old data can be offered for Carry Over.
 */
export function findCarryOverSource(entries: RecentEntry[], path: string, fingerprint: Fingerprint): RecentEntry | null {
  const target = path.toLowerCase()
  return entries.find((e) => e.path.toLowerCase() === target && e.fingerprint !== fingerprint) ?? null
}
```

- [ ] **Step 4: Guard fingerprints in `src/main/documentStore.ts`**

Add `isFingerprint` to the import from `'../shared/documentData'`, then replace `load` and `update` with:

```ts
  load(fingerprint: Fingerprint): Promise<DocumentData> {
    if (!isFingerprint(fingerprint)) return Promise.reject(new Error(`Invalid fingerprint: ${String(fingerprint)}`))
    return this.enqueue(fingerprint, () => this.loadUnlocked(fingerprint))
  }

  update(fingerprint: Fingerprint, mutate: (data: DocumentData) => DocumentData): Promise<DocumentData> {
    if (!isFingerprint(fingerprint)) return Promise.reject(new Error(`Invalid fingerprint: ${String(fingerprint)}`))
    return this.enqueue(fingerprint, async () => {
      const next = mutate(await this.loadUnlocked(fingerprint))
      await this.writeAtomic(fingerprint, next)
      return next
    })
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/recent.test.ts src/main/documentStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Extend the IPC contract — `src/shared/ipc.ts`**

Change the import to `import type { DocumentData, Fingerprint, Highlight, ReadingPosition } from './documentData'`. Add two channels to `IPC` (after `reportReadingPosition`):

```ts
  saveHighlight: 'document:save-highlight',
  deleteHighlight: 'document:delete-highlight',
```

Add two methods to `PdfReaderApi` (after `reportReadingPosition`):

```ts
  saveHighlight(highlight: Highlight): Promise<void>
  deleteHighlight(id: string): Promise<void>
```

- [ ] **Step 7: Preload — `src/preload/index.ts`**

Add to the `api` object (after `reportReadingPosition`):

```ts
  saveHighlight: (highlight) => ipcRenderer.invoke(IPC.saveHighlight, highlight),
  deleteHighlight: (id) => ipcRenderer.invoke(IPC.deleteHighlight, id),
```

- [ ] **Step 8: Strings — `src/shared/strings.ts`**

Add these two sections after `reader: { … }` (inside `t`):

```ts
  carryOver: {
    title: 'File đã thay đổi',
    message: (fileName: string) => `"${fileName}" đã thay đổi kể từ lần đọc trước.`,
    detail: (highlightCount: number) =>
      `Chuyển vị trí đọc và ${highlightCount} highlight từ bản cũ sang bản này? ` +
      'Highlight có thể lệch nếu nội dung trang đã thay đổi.',
    yes: 'Chuyển',
    no: 'Không'
  },
  highlight: {
    colors: { yellow: 'Vàng', green: 'Xanh lá', blue: 'Xanh dương', pink: 'Hồng', orange: 'Cam' },
    colorButton: (colorName: string, key: number) => `${colorName} (phím ${key})`,
    saveFailed: 'Không lưu được highlight. Thử lại sau.',
    note: 'Ghi chú',
    notePlaceholder: 'Thêm ghi chú…',
    saveNote: 'Lưu',
    delete: 'Xóa highlight',
    panelTitle: 'Highlight',
    togglePanel: 'Danh sách highlight (Ctrl+B)',
    search: 'Tìm trong highlight…',
    empty: 'Chưa có highlight nào. Bôi đen chữ để tạo highlight.',
    noMatch: 'Không có highlight phù hợp.',
    unanchored: 'Mất neo: không tìm thấy đoạn này trong bản hiện tại',
    page: (pageNumber: number) => `Trang ${pageNumber}`
  }
```

- [ ] **Step 9: Main — `src/main/index.ts`**

9a. Replace the `documentData` import with:

```ts
import {
  carryOver,
  hasCarryableContent,
  isHighlight,
  isReadingPosition,
  newerReading,
  readingProgress,
  removeHighlight,
  upsertHighlight
} from '../shared/documentData'
```

and change the recent import to `import { findCarryOverSource, RecentStore } from './recent'`.

9b. Replace the whole `openPath` function with the following functions (one window per Document is still registered synchronously after the last `await` that precedes it):

```ts
// Opens in progress, by Fingerprint, so two quick opens of the same file share one window and one Carry Over prompt.
const pendingOpens = new Map<string, Promise<OpenResult>>()

async function openPath(path: string): Promise<OpenResult> {
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.pdf')) return { ok: false, reason: 'not-pdf' }
  try {
    await access(path)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  let fingerprint: string
  try {
    fingerprint = await computeFingerprint(path)
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  if (windows.focusDocument(fingerprint)) {
    await recordRecent(fingerprint, path)
    return { ok: true }
  }
  const pending = pendingOpens.get(fingerprint)
  if (pending) return pending
  const opening = openNewDocument(path, fingerprint).finally(() => pendingOpens.delete(fingerprint))
  pendingOpens.set(fingerprint, opening)
  return opening
}

async function openNewDocument(path: string, fingerprint: string): Promise<OpenResult> {
  await offerCarryOver(path, fingerprint)
  if (!windows.focusDocument(fingerprint)) {
    windows.openDocument(
      { kind: 'document', path, fileName: basename(path), fingerprint },
      {
        onBlur: () => void saver.flush(fingerprint).catch(logSaveError),
        onClosed: () => void saver.flush(fingerprint).catch(logSaveError)
      }
    )
  }
  await recordRecent(fingerprint, path)
  return { ok: true }
}

async function recordRecent(fingerprint: string, path: string): Promise<void> {
  try {
    await recent.add({ fingerprint, path, openedAt: Date.now() })
  } catch (err) {
    console.error('Failed to update recent documents', err)
  }
}

/**
 * Carry Over: when this path was last opened with a different Fingerprint (the file changed),
 * and the old data has a position or Highlights while the new data has neither, ask the user
 * whether to copy them over. Never throws; a failure only skips the offer.
 */
async function offerCarryOver(path: string, fingerprint: string): Promise<void> {
  try {
    const source = findCarryOverSource(await recent.list(), path, fingerprint)
    if (!source) return
    const [previous, current] = await Promise.all([store.load(source.fingerprint), store.load(fingerprint)])
    if (!hasCarryableContent(previous) || hasCarryableContent(current)) return
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: t.carryOver.title,
      message: t.carryOver.message(basename(path)),
      detail: t.carryOver.detail(previous.highlights.length),
      buttons: [t.carryOver.yes, t.carryOver.no],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return
    await store.update(fingerprint, (data) => carryOver(previous, data, Date.now()))
  } catch (err) {
    console.error('Failed to carry over document data', err)
  }
}
```

9c. In `registerIpc`, replace the `reportReadingPosition` handler and add the two Highlight handlers:

```ts
  ipcMain.on(IPC.reportReadingPosition, (event, reading: unknown, pageCount: unknown) => {
    const context = documentOf(event)
    if (!context || !isReadingPosition(reading) || !Number.isInteger(pageCount) || (pageCount as number) < 0) return
    saver.report(context.fingerprint, { reading, pageCount: pageCount as number })
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || !win.isFocused()) {
      void saver.flush(context.fingerprint).catch(logSaveError)
    }
  })
  ipcMain.handle(IPC.saveHighlight, async (event, highlight: unknown) => {
    const { fingerprint } = requireDocument(event)
    if (!isHighlight(highlight)) throw new Error('Invalid highlight')
    await store.update(fingerprint, (data) => upsertHighlight(data, highlight))
  })
  ipcMain.handle(IPC.deleteHighlight, async (event, id: unknown) => {
    const { fingerprint } = requireDocument(event)
    if (typeof id !== 'string' || id === '') throw new Error('Invalid highlight id')
    await store.update(fingerprint, (data) => removeHighlight(data, id, Date.now()))
  })
```

- [ ] **Step 10: Typecheck, tests, build**

Run: `npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 11: App check — Carry Over**

Using the Verification environment:
1. Open a text PDF, scroll a few pages (wait ≥ 4 s). Close the app.
2. Append bytes to the PDF so its Fingerprint changes but it stays valid: `Add-Content -Path <pdf> -Value "%pdfreader-test"` (PowerShell). Do this on a scratch copy, never on a user file.
3. Open the same path again. Expected: a native dialog "File đã thay đổi" appears (screenshot the desktop or check the window list for its title). Accept it (default button; e.g. send `{ENTER}` with `[System.Windows.Forms.SendKeys]` after focusing it). The reader opens at the old position, and `<new fingerprint>.json` contains the copied `reading`.
4. Repeat steps 2–3 but choose "Không": no data is copied, and opening the file once more does NOT ask again (the Recent entry now points to the new Fingerprint).

- [ ] **Step 12: Commit**

```bash
git add src/shared/ipc.ts src/shared/strings.ts src/preload/index.ts src/main/index.ts src/main/recent.ts src/main/recent.test.ts src/main/documentStore.ts src/main/documentStore.test.ts
git commit -m "feat: save Highlights over IPC and offer Carry Over for changed files

Co-Authored-By: <your model>"
```

---

### Task 3: Text index and Highlight geometry (pure logic)

**Files:**
- Create: `src/renderer/src/reader/highlights/textIndex.ts`, `src/renderer/src/reader/highlights/geometry.ts`
- Test: `src/renderer/src/reader/highlights/textIndex.test.ts`, `src/renderer/src/reader/highlights/geometry.test.ts`

**Interfaces:**
- Consumes: `Highlight`, `HighlightPart`, `HighlightRect` from `src/shared/documentData.ts`; `PageBox`, `layoutPages` from `src/renderer/src/reader/layout.ts`.
- Produces from `textIndex.ts`:
  - `interface TextRun { pageIndex: number; text: string; rect: HighlightRect; hasEOL: boolean }`
  - `interface TextIndex { runs: TextRun[]; text: string; refs: (CharRef | null)[] }` (`CharRef = { run: number; offset: number }`)
  - `interface TextMatch { start: number; end: number }`
  - `foldChar(char: string): string`, `foldText(text: string): string`
  - `buildTextIndex(runs: TextRun[]): TextIndex`
  - `findText(index: TextIndex, query: string, from?: number): TextMatch | null`
  - `findAllText(index: TextIndex, query: string): TextMatch[]`
  - `matchToParts(index: TextIndex, match: TextMatch): HighlightPart[]`
- Produces from `geometry.ts`:
  - `interface ClientRectLike { left: number; top: number; width: number; height: number }`
  - `interface PageFrame { pageIndex: number; left: number; top: number; width: number; height: number }`
  - `clientRectsToParts(rects: ClientRectLike[], pages: PageFrame[], scale: number): HighlightPart[]`
  - `mergeLineRects(rects: HighlightRect[]): HighlightRect[]`
  - `highlightAt(highlights: Highlight[], pageIndex: number, x: number, y: number): Highlight | null`
  - `highlightsByPage(highlights: Highlight[]): Map<number, Highlight[]>`
  - `sortHighlightsByPosition(highlights: Highlight[]): Highlight[]`
  - `SCROLL_MARGIN = 48`, `highlightScrollTop(highlight: Highlight, boxes: PageBox[], scale: number): number | null`

Text is "folded" for matching: lower-case, Vietnamese diacritics removed (`đ` → `d`), whitespace collapsed to one space. Folding is done per character so every folded character maps back to its source run and offset.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/reader/highlights/textIndex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTextIndex, findAllText, findText, foldText, matchToParts, type TextRun } from './textIndex'

const RUNS: TextRun[] = [
  { pageIndex: 0, text: 'Hello world', rect: { x: 0, y: 0, width: 110, height: 10 }, hasEOL: true },
  { pageIndex: 0, text: 'Second line', rect: { x: 0, y: 20, width: 110, height: 10 }, hasEOL: false },
  { pageIndex: 1, text: 'Next page', rect: { x: 5, y: 5, width: 90, height: 10 }, hasEOL: false }
]

describe('foldText', () => {
  it('lower-cases, removes Vietnamese diacritics and collapses whitespace', () => {
    expect(foldText('Tìm  Kiếm\nĐường ')).toBe('tim kiem duong')
  })
})

describe('buildTextIndex', () => {
  it('joins runs with spaces at line ends and page breaks', () => {
    expect(buildTextIndex(RUNS).text).toBe('hello world second line next page')
  })

  it('maps every character back to its run', () => {
    const index = buildTextIndex(RUNS)
    expect(index.refs).toHaveLength(index.text.length)
    expect(index.refs[0]).toEqual({ run: 0, offset: 0 })
    expect(index.refs[11]).toBeNull() // the space inserted for the line end
  })
})

describe('findText', () => {
  const index = buildTextIndex(RUNS)

  it('matches case- and diacritic-insensitively across lines', () => {
    expect(findText(index, 'WORLD Second')).toEqual({ start: 6, end: 18 })
  })

  it('returns null for an empty query or no match', () => {
    expect(findText(index, '   ')).toBeNull()
    expect(findText(index, 'missing')).toBeNull()
  })

  it('searches from a given position', () => {
    const twice = buildTextIndex([{ pageIndex: 0, text: 'ab ab', rect: { x: 0, y: 0, width: 50, height: 10 }, hasEOL: false }])
    expect(findText(twice, 'ab', 1)).toEqual({ start: 3, end: 5 })
  })
})

describe('findAllText', () => {
  it('returns every non-overlapping match', () => {
    const index = buildTextIndex([{ pageIndex: 0, text: 'aaaa', rect: { x: 0, y: 0, width: 40, height: 10 }, hasEOL: false }])
    expect(findAllText(index, 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
  })
})

describe('matchToParts', () => {
  const index = buildTextIndex(RUNS)

  it('slices run rectangles in proportion to the matched characters', () => {
    expect(matchToParts(index, findText(index, 'world second')!)).toEqual([
      {
        pageIndex: 0,
        rects: [
          { x: 60, y: 0, width: 50, height: 10 },
          { x: 0, y: 20, width: 60, height: 10 }
        ]
      }
    ])
  })

  it('returns one part per page for a match across a page break', () => {
    expect(matchToParts(index, findText(index, 'line next')!)).toEqual([
      { pageIndex: 0, rects: [{ x: 70, y: 20, width: 40, height: 10 }] },
      { pageIndex: 1, rects: [{ x: 5, y: 5, width: 40, height: 10 }] }
    ])
  })
})
```

`src/renderer/src/reader/highlights/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { layoutPages } from '../layout'
import {
  clientRectsToParts,
  highlightAt,
  highlightsByPage,
  highlightScrollTop,
  mergeLineRects,
  sortHighlightsByPosition,
  type PageFrame
} from './geometry'

function hl(id: string, parts: Highlight['parts'], extra: Partial<Highlight> = {}): Highlight {
  return { id, color: 'yellow', note: null, text: id, parts, createdAt: 1, updatedAt: 1, ...extra }
}

const PAGES: PageFrame[] = [
  { pageIndex: 0, left: 100, top: 50, width: 200, height: 300 },
  { pageIndex: 1, left: 100, top: 362, width: 200, height: 300 }
]

describe('clientRectsToParts', () => {
  it('converts screen rectangles to page units per page and drops noise', () => {
    const parts = clientRectsToParts(
      [
        { left: 120, top: 70, width: 40, height: 10 },
        { left: 110, top: 372, width: 20, height: 10 },
        { left: 130, top: 80, width: 0.2, height: 10 },
        { left: 0, top: 0, width: 10, height: 10 }
      ],
      PAGES,
      2
    )
    expect(parts).toEqual([
      { pageIndex: 0, rects: [{ x: 10, y: 10, width: 20, height: 5 }] },
      { pageIndex: 1, rects: [{ x: 5, y: 5, width: 10, height: 5 }] }
    ])
  })
})

describe('mergeLineRects', () => {
  it('merges touching rectangles on the same line and keeps gaps and lines apart', () => {
    expect(
      mergeLineRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10.5, y: 0.5, width: 10, height: 10 },
        { x: 50, y: 0, width: 10, height: 10 },
        { x: 0, y: 20, width: 10, height: 10 }
      ])
    ).toEqual([
      { x: 0, y: 0, width: 20.5, height: 10.5 },
      { x: 50, y: 0, width: 10, height: 10 },
      { x: 0, y: 20, width: 10, height: 10 }
    ])
  })

  it('absorbs a rectangle contained in another', () => {
    expect(
      mergeLineRects([
        { x: 0, y: 0, width: 100, height: 10 },
        { x: 10, y: 1, width: 20, height: 8 }
      ])
    ).toEqual([{ x: 0, y: 0, width: 100, height: 10 }])
  })
})

describe('highlightAt', () => {
  const a = hl('a', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 50, height: 10 }] }])
  const b = hl('b', [{ pageIndex: 0, rects: [{ x: 40, y: 0, width: 50, height: 10 }] }])
  const lost = hl('lost', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 500, height: 500 }] }], { status: 'unanchored' })

  it('returns the topmost (last) Highlight under the point', () => {
    expect(highlightAt([a, b], 0, 45, 5)?.id).toBe('b')
    expect(highlightAt([a, b], 0, 5, 5)?.id).toBe('a')
  })

  it('ignores other pages, misses and Unanchored Highlights', () => {
    expect(highlightAt([a], 1, 5, 5)).toBeNull()
    expect(highlightAt([a], 0, 5, 50)).toBeNull()
    expect(highlightAt([lost], 0, 5, 5)).toBeNull()
  })
})

describe('highlightsByPage', () => {
  it('lists a cross-page Highlight on each page and skips Unanchored ones', () => {
    const cross = hl('cross', [
      { pageIndex: 0, rects: [] },
      { pageIndex: 1, rects: [] }
    ])
    const lost = hl('lost', [{ pageIndex: 0, rects: [] }], { status: 'unanchored' })
    const byPage = highlightsByPage([cross, lost])
    expect(byPage.get(0)?.map((h) => h.id)).toEqual(['cross'])
    expect(byPage.get(1)?.map((h) => h.id)).toEqual(['cross'])
  })
})

describe('sortHighlightsByPosition', () => {
  it('sorts by page, then top, then left, with Unanchored Highlights last', () => {
    const p1 = hl('p1', [{ pageIndex: 1, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }])
    const low = hl('low', [{ pageIndex: 0, rects: [{ x: 0, y: 50, width: 1, height: 1 }] }])
    const right = hl('right', [{ pageIndex: 0, rects: [{ x: 30, y: 10, width: 1, height: 1 }] }])
    const left = hl('left', [{ pageIndex: 0, rects: [{ x: 5, y: 10, width: 1, height: 1 }] }])
    const lost = hl('lost', [], { status: 'unanchored' })
    expect(sortHighlightsByPosition([lost, p1, low, right, left]).map((h) => h.id)).toEqual([
      'left',
      'right',
      'low',
      'p1',
      'lost'
    ])
  })
})

describe('highlightScrollTop', () => {
  // At scale 2: page 0 top 16 height 400; page 1 top 428.
  const boxes = layoutPages(
    [
      { width: 100, height: 200 },
      { width: 100, height: 100 }
    ],
    2
  )

  it('scrolls so the Highlight sits a margin below the top of the viewport', () => {
    const h = hl('h', [{ pageIndex: 1, rects: [{ x: 0, y: 50, width: 1, height: 1 }] }])
    expect(highlightScrollTop(h, boxes, 2)).toBe(428 + 100 - 48)
  })

  it('is null for Unanchored Highlights and unknown pages', () => {
    expect(highlightScrollTop(hl('x', [], { status: 'unanchored' }), boxes, 2)).toBeNull()
    expect(highlightScrollTop(hl('y', [{ pageIndex: 9, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }]), boxes, 2)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/reader/highlights`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/renderer/src/reader/highlights/textIndex.ts`**

```ts
import type { HighlightPart, HighlightRect } from '../../../../shared/documentData'

/** One piece of text pdf.js reports for a page, with its box in page units (scale 1, origin top-left). */
export interface TextRun {
  pageIndex: number
  text: string
  rect: HighlightRect
  /** True when the PDF marks a line break after this run. */
  hasEOL: boolean
}

interface CharRef {
  run: number
  /** Index of the source character inside `Array.from(run.text)`. */
  offset: number
}

export interface TextIndex {
  runs: TextRun[]
  /** Folded text of the whole Document: lower-case, no diacritics, single spaces. */
  text: string
  /** Source of each UTF-16 unit of `text`; null for spaces inserted at line ends and page breaks. */
  refs: (CharRef | null)[]
}

/** A match in `TextIndex.text`, as the half-open range [start, end). */
export interface TextMatch {
  start: number
  end: number
}

export function foldChar(char: string): string {
  const lower = char.toLowerCase()
  if (lower === 'đ') return 'd'
  return lower.normalize('NFD').replace(/\p{M}/gu, '')
}

const isSpace = (text: string) => /^\s+$/.test(text)

export function foldText(text: string): string {
  let out = ''
  for (const char of text) {
    const folded = foldChar(char)
    if (folded === '') continue
    if (isSpace(folded)) {
      if (out !== '' && !out.endsWith(' ')) out += ' '
    } else {
      out += folded
    }
  }
  return out.trimEnd()
}

export function buildTextIndex(runs: TextRun[]): TextIndex {
  let text = ''
  const refs: (CharRef | null)[] = []
  const pushSpace = (ref: CharRef | null) => {
    if (text !== '' && !text.endsWith(' ')) {
      text += ' '
      refs.push(ref)
    }
  }
  runs.forEach((run, runIndex) => {
    if (runIndex > 0 && runs[runIndex - 1].pageIndex !== run.pageIndex) pushSpace(null)
    Array.from(run.text).forEach((char, offset) => {
      const folded = foldChar(char)
      if (folded === '') return
      if (isSpace(folded)) {
        pushSpace({ run: runIndex, offset })
        return
      }
      for (let i = 0; i < folded.length; i++) {
        text += folded[i]
        refs.push({ run: runIndex, offset })
      }
    })
    if (run.hasEOL) pushSpace(null)
  })
  return { runs, text, refs }
}

export function findText(index: TextIndex, query: string, from = 0): TextMatch | null {
  const needle = foldText(query).trim()
  if (needle === '') return null
  const start = index.text.indexOf(needle, from)
  return start === -1 ? null : { start, end: start + needle.length }
}

export function findAllText(index: TextIndex, query: string): TextMatch[] {
  const matches: TextMatch[] = []
  let from = 0
  for (;;) {
    const match = findText(index, query, from)
    if (!match) return matches
    matches.push(match)
    from = match.end
  }
}

export function matchToParts(index: TextIndex, match: TextMatch): HighlightPart[] {
  const spans = new Map<number, { min: number; max: number }>()
  for (let i = match.start; i < match.end; i++) {
    const ref = index.refs[i]
    if (!ref) continue
    const span = spans.get(ref.run)
    if (!span) spans.set(ref.run, { min: ref.offset, max: ref.offset })
    else {
      span.min = Math.min(span.min, ref.offset)
      span.max = Math.max(span.max, ref.offset)
    }
  }
  const byPage = new Map<number, HighlightRect[]>()
  for (const [runIndex, { min, max }] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const run = index.runs[runIndex]
    const length = Math.max(1, Array.from(run.text).length)
    const rect: HighlightRect = {
      x: run.rect.x + (run.rect.width * min) / length,
      y: run.rect.y,
      width: (run.rect.width * (max + 1 - min)) / length,
      height: run.rect.height
    }
    const rects = byPage.get(run.pageIndex) ?? []
    rects.push(rect)
    byPage.set(run.pageIndex, rects)
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([pageIndex, rects]) => ({ pageIndex, rects }))
}
```

- [ ] **Step 4: Implement `src/renderer/src/reader/highlights/geometry.ts`**

```ts
import type { Highlight, HighlightPart, HighlightRect } from '../../../../shared/documentData'
import type { PageBox } from '../layout'

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

/** A page element's position on screen (CSS px), from getBoundingClientRect. */
export interface PageFrame {
  pageIndex: number
  left: number
  top: number
  width: number
  height: number
}

const MIN_SIZE = 0.5
export const SCROLL_MARGIN = 48

/** Converts selection rectangles (screen px) into Highlight parts (page units), one part per page. */
export function clientRectsToParts(rects: ClientRectLike[], pages: PageFrame[], scale: number): HighlightPart[] {
  const byPage = new Map<number, HighlightRect[]>()
  for (const r of rects) {
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) continue
    const centerX = r.left + r.width / 2
    const centerY = r.top + r.height / 2
    const page = pages.find(
      (p) => centerX >= p.left && centerX <= p.left + p.width && centerY >= p.top && centerY <= p.top + p.height
    )
    if (!page) continue
    const left = Math.max(r.left, page.left)
    const top = Math.max(r.top, page.top)
    const right = Math.min(r.left + r.width, page.left + page.width)
    const bottom = Math.min(r.top + r.height, page.top + page.height)
    const rect = {
      x: (left - page.left) / scale,
      y: (top - page.top) / scale,
      width: (right - left) / scale,
      height: (bottom - top) / scale
    }
    const list = byPage.get(page.pageIndex) ?? []
    list.push(rect)
    byPage.set(page.pageIndex, list)
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, pageRects]) => ({ pageIndex, rects: mergeLineRects(pageRects) }))
}

function sameLine(a: HighlightRect, b: HighlightRect): boolean {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlap > 0.5 * Math.min(a.height, b.height)
}

/** Groups rectangles into lines, then merges rectangles on a line that touch or overlap. */
export function mergeLineRects(rects: HighlightRect[]): HighlightRect[] {
  const lines: HighlightRect[][] = []
  for (const rect of [...rects].sort((a, b) => a.y - b.y)) {
    const line = lines.find((l) => sameLine(l[0], rect))
    if (line) line.push(rect)
    else lines.push([rect])
  }
  const merged: HighlightRect[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let current = { ...line[0] }
    for (const rect of line.slice(1)) {
      if (rect.x <= current.x + current.width + 1) {
        const right = Math.max(current.x + current.width, rect.x + rect.width)
        const top = Math.min(current.y, rect.y)
        const bottom = Math.max(current.y + current.height, rect.y + rect.height)
        current = { x: current.x, y: top, width: right - current.x, height: bottom - top }
      } else {
        merged.push(current)
        current = { ...rect }
      }
    }
    merged.push(current)
  }
  return merged
}

/** The topmost (most recently saved) anchored Highlight covering a point in page units. */
export function highlightAt(highlights: Highlight[], pageIndex: number, x: number, y: number): Highlight | null {
  for (let i = highlights.length - 1; i >= 0; i--) {
    const highlight = highlights[i]
    if (highlight.status === 'unanchored') continue
    for (const part of highlight.parts) {
      if (part.pageIndex !== pageIndex) continue
      if (part.rects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)) return highlight
    }
  }
  return null
}

export function highlightsByPage(highlights: Highlight[]): Map<number, Highlight[]> {
  const byPage = new Map<number, Highlight[]>()
  for (const highlight of highlights) {
    if (highlight.status === 'unanchored') continue
    for (const pageIndex of new Set(highlight.parts.map((p) => p.pageIndex))) {
      const list = byPage.get(pageIndex) ?? []
      list.push(highlight)
      byPage.set(pageIndex, list)
    }
  }
  return byPage
}

function anchorOf(highlight: Highlight): { page: number; y: number; x: number } | null {
  if (highlight.status === 'unanchored') return null
  const part = highlight.parts[0]
  const rect = part?.rects[0]
  if (!part || !rect) return null
  return { page: part.pageIndex, y: rect.y, x: rect.x }
}

export function sortHighlightsByPosition(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) => {
    const pa = anchorOf(a)
    const pb = anchorOf(b)
    if (!pa || !pb) return (pa ? -1 : pb ? 1 : 0) || a.createdAt - b.createdAt
    return pa.page - pb.page || pa.y - pb.y || pa.x - pb.x || a.createdAt - b.createdAt
  })
}

export function highlightScrollTop(highlight: Highlight, boxes: PageBox[], scale: number): number | null {
  const anchor = anchorOf(highlight)
  if (!anchor) return null
  const box = boxes[anchor.page]
  if (!box) return null
  return Math.max(0, box.top + anchor.y * scale - SCROLL_MARGIN)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/reader/highlights`
Expected: PASS.

- [ ] **Step 6: Typecheck and full suite**

`npm run typecheck` → 0. `npm test` → all pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/reader/highlights/textIndex.ts src/renderer/src/reader/highlights/textIndex.test.ts src/renderer/src/reader/highlights/geometry.ts src/renderer/src/reader/highlights/geometry.test.ts
git commit -m "feat: add text index and Highlight geometry helpers

Co-Authored-By: <your model>"
```

---

### Task 4: Selectable text layer

**Files:**
- Modify: `src/renderer/src/reader/PdfPage.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `TextLayer` from `pdfjs-dist` (4.10.38: `new TextLayer({ textContentSource, container, viewport })`, `render(): Promise<void>`, `cancel(): void`).
- Produces:
  - `PdfPage` renders `<div className="page" data-page-index={pageIndex}>` with CSS variable `--scale-factor` set to `scale`, a canvas, any `children` (overlay), and a `.textLayer` div on top.
  - `PdfPageProps.children?: ReactNode` (Task 5 passes the Highlight overlay).

pdf.js sizes the text layer with `calc(var(--scale-factor) * …px)`, so `--scale-factor` must be set on an ancestor of `.textLayer`. Only the text-layer rules of pdf.js's `web/pdf_viewer.css` are needed; they are copied below instead of importing the 2000-line viewer stylesheet.

- [ ] **Step 1: Replace `src/renderer/src/reader/PdfPage.tsx`**

```tsx
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { canvasPixelRatio, type PageBox } from './layout'

interface PdfPageProps {
  doc: PDFDocumentProxy
  pageIndex: number
  box: PageBox
  scale: number
  visible: boolean
  /** Overlay drawn above the canvas and below the selectable text (e.g. Highlights). */
  children?: ReactNode
}

export function PdfPage({ doc, pageIndex, box, scale, visible, children }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: ReturnType<PDFPageProxy['render']> | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1)
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const ratio = canvasPixelRatio(box.width, box.height, window.devicePixelRatio || 1)
        const viewport = page.getViewport({ scale: scale * ratio })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) return
        task = page.render({ canvasContext: context, viewport })
        await task.promise
      } catch (err) {
        if (!cancelled) console.error(`Failed to render page ${pageIndex + 1}`, err)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageIndex, scale, visible, box.width, box.height])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let layer: TextLayer | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1)
        const container = textRef.current
        if (cancelled || !container) return
        container.replaceChildren()
        layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport: page.getViewport({ scale })
        })
        await layer.render()
      } catch (err) {
        if (!cancelled) console.error(`Failed to render text layer of page ${pageIndex + 1}`, err)
      }
    })()
    return () => {
      cancelled = true
      layer?.cancel()
    }
  }, [doc, pageIndex, scale, visible])

  const style = { top: box.top, width: box.width, height: box.height, '--scale-factor': scale } as CSSProperties
  return (
    <div className="page" data-page-index={pageIndex} style={style}>
      {visible && <canvas ref={canvasRef} style={{ width: box.width, height: box.height }} />}
      {visible && children}
      {visible && <div ref={textRef} className="textLayer" />}
    </div>
  )
}
```

- [ ] **Step 2: Append text-layer styles to `src/renderer/src/styles.css`**

```css
/* Text layer: rules copied from pdfjs-dist 4.10.38 web/pdf_viewer.css (.textLayer). */
.page .textLayer {
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 2;
}
.textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.textLayer > :not(.markedContent),
.textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
}
.textLayer span.markedContent {
  top: 0;
  height: 0;
}
.textLayer ::selection {
  background: rgba(0 0 255 / 0.25);
}
.textLayer br::selection {
  background: transparent;
}
.textLayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}
.textLayer.selecting .endOfContent {
  top: 0;
}
```

- [ ] **Step 3: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 4: App check — text is selectable and aligned**

Using the Verification environment, open a text PDF and via CDP:
1. `Runtime.evaluate`: `document.querySelectorAll('.page .textLayer span').length` > 0 on visible pages.
2. Select the text of the first span with a Range (`document.createRange(); range.selectNodeContents(span); getSelection().addRange(range)`) and read `getSelection().toString()`: non-empty, equals the span's text.
3. Temporarily inject `.textLayer span { color: rgba(255,0,0,.6) !important }` (via `Runtime.evaluate` adding a `<style>`), take a screenshot, and confirm the red text lies on top of the rendered glyphs at 100% and 200% zoom. Remove the style afterwards (it is never committed).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/reader/PdfPage.tsx src/renderer/src/styles.css
git commit -m "feat: make page text selectable with the pdf.js text layer

Co-Authored-By: <your model>"
```

---

### Task 5: Create Highlights from a selection

**Files:**
- Create: `src/shared/highlightColors.ts`, `src/shared/highlightColors.test.ts`
- Create: `src/renderer/src/reader/highlights/selection.ts`, `useHighlights.ts`, `HighlightLayer.tsx`, `SelectionToolbar.tsx`
- Replace: `src/renderer/src/reader/ReaderView.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.api.saveHighlight/deleteHighlight` (Task 2), `t.highlight` (Task 2), `clientRectsToParts`, `highlightsByPage`, `highlightAt` (Task 3), `PdfPage` children + `data-page-index` (Task 4).
- Produces:
  - `HIGHLIGHT_RGB: Record<HighlightColor, readonly [number, number, number]>`, `highlightCss(color: HighlightColor, alpha?: number): string` (Plan 4 export reuses `HIGHLIGHT_RGB`)
  - `interface PendingSelection { parts: HighlightPart[]; text: string; anchor: { x: number; y: number } }`
  - `readSelection(container: HTMLElement, scale: number): PendingSelection | null`
  - `hitTestHighlight(target: EventTarget | null, clientX: number, clientY: number, highlights: Highlight[], scale: number): Highlight | null`
  - `isEditableTarget(target: EventTarget | null): boolean`
  - `useHighlights(initial: Highlight[], onError: () => void): { highlights: Highlight[]; save(h: Highlight): void; remove(id: string): void }`
  - `HighlightLayer` props `{ highlights: Highlight[]; pageIndex: number; scale: number; activeId: string | null }`
  - `SelectionToolbar` props `{ anchor: { x: number; y: number }; onPick(color: HighlightColor): void }`
  - `ReaderView` loads Highlights with the Document data and renders them.

Behavior:
- Selecting text inside the pages shows a floating toolbar with the 5 Highlight Colors below the end of the selection.
- Clicking a color, or pressing `1`–`5` while the toolbar is shown, creates one Highlight (`id` from `crypto.randomUUID()`, `note: null`, `text` = selection text with whitespace collapsed, `parts` from the selection) and clears the selection. `Escape` dismisses it. Scrolling hides the toolbar.
- Highlights draw as translucent colored boxes (multiply blend) under the text layer, so text stays selectable.
- Saving is optimistic: the Highlight appears immediately; if the IPC call fails, the error is logged and `t.highlight.saveFailed` is shown in an alert.

- [ ] **Step 1: Write the failing test for the color helper**

`src/shared/highlightColors.test.ts`:

```ts
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
```

Run: `npx vitest run src/shared/highlightColors.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `src/shared/highlightColors.ts`**

```ts
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
```

Run the test again → PASS.

- [ ] **Step 3: Create `src/renderer/src/reader/highlights/selection.ts`**

```ts
import type { Highlight, HighlightPart } from '../../../../shared/documentData'
import { clientRectsToParts, highlightAt, type PageFrame } from './geometry'

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

/** The current text selection inside `container`, converted to Highlight parts, or null. */
export function readSelection(container: HTMLElement, scale: number): PendingSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const clientRects = Array.from(range.getClientRects())
  const parts = clientRectsToParts(clientRects, pageFrames(container), scale)
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (parts.length === 0 || text === '') return null
  const last = clientRects[clientRects.length - 1]
  return { parts, text, anchor: { x: last.right, y: last.bottom } }
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
```

- [ ] **Step 4: Create `src/renderer/src/reader/highlights/useHighlights.ts`**

```ts
import { useCallback, useState } from 'react'
import type { Highlight } from '../../../../shared/documentData'

export interface HighlightActions {
  highlights: Highlight[]
  save(highlight: Highlight): void
  remove(id: string): void
}

/** Highlights of the open Document, updated optimistically and persisted through main. */
export function useHighlights(initial: Highlight[], onError: () => void): HighlightActions {
  const [highlights, setHighlights] = useState(initial)

  const save = useCallback(
    (highlight: Highlight) => {
      setHighlights((current) => [...current.filter((h) => h.id !== highlight.id), highlight])
      window.api.saveHighlight(highlight).catch((err) => {
        console.error('Failed to save highlight', err)
        onError()
      })
    },
    [onError]
  )

  const remove = useCallback(
    (id: string) => {
      setHighlights((current) => current.filter((h) => h.id !== id))
      window.api.deleteHighlight(id).catch((err) => {
        console.error('Failed to delete highlight', err)
        onError()
      })
    },
    [onError]
  )

  return { highlights, save, remove }
}
```

- [ ] **Step 5: Create `src/renderer/src/reader/highlights/HighlightLayer.tsx`**

```tsx
import type { Highlight } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'

interface HighlightLayerProps {
  highlights: Highlight[]
  pageIndex: number
  scale: number
  activeId: string | null
}

export function HighlightLayer({ highlights, pageIndex, scale, activeId }: HighlightLayerProps) {
  return (
    <div className="highlight-layer">
      {highlights.flatMap((highlight) =>
        highlight.parts
          .filter((part) => part.pageIndex === pageIndex)
          .flatMap((part, partIndex) =>
            part.rects.map((rect, rectIndex) => (
              <div
                key={`${highlight.id}-${partIndex}-${rectIndex}`}
                className={highlight.id === activeId ? 'highlight-rect active' : 'highlight-rect'}
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.height * scale,
                  background: highlightCss(highlight.color, 0.45)
                }}
              />
            ))
          )
      )}
    </div>
  )
}
```

- [ ] **Step 6: Create `src/renderer/src/reader/highlights/SelectionToolbar.tsx`**

```tsx
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'
import { t } from '../../../../shared/strings'

const TOOLBAR_WIDTH = 190
const TOOLBAR_HEIGHT = 40

interface SelectionToolbarProps {
  anchor: { x: number; y: number }
  onPick(color: HighlightColor): void
}

export function SelectionToolbar({ anchor, onPick }: SelectionToolbarProps) {
  const left = Math.max(8, Math.min(anchor.x - TOOLBAR_WIDTH / 2, window.innerWidth - TOOLBAR_WIDTH - 8))
  const top = Math.min(anchor.y + 8, window.innerHeight - TOOLBAR_HEIGHT - 8)
  return (
    // preventDefault on mousedown keeps the text selection alive while clicking a color.
    <div className="selection-toolbar" style={{ left, top }} onMouseDown={(event) => event.preventDefault()}>
      {HIGHLIGHT_COLORS.map((color, index) => {
        const label = t.highlight.colorButton(t.highlight.colors[color], index + 1)
        return (
          <button
            key={color}
            className="swatch"
            style={{ background: highlightCss(color) }}
            title={label}
            aria-label={label}
            onClick={() => onPick(color)}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 7: Replace `src/renderer/src/reader/ReaderView.tsx`**

This keeps all Plan 1 reader behavior (restore, suppressed programmatic scroll, zoom, reporting) and adds Highlights.

```tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  HIGHLIGHT_COLORS,
  type Highlight,
  type HighlightColor,
  type ReadingPosition,
  type ZoomSetting
} from '../../../shared/documentData'
import { t } from '../../../shared/strings'
import { highlightsByPage } from './highlights/geometry'
import { HighlightLayer } from './highlights/HighlightLayer'
import { isEditableTarget, readSelection, type PendingSelection } from './highlights/selection'
import { SelectionToolbar } from './highlights/SelectionToolbar'
import { useHighlights } from './highlights/useHighlights'
import {
  computeScale,
  contentWidth,
  currentPageIndex,
  layoutPages,
  positionFromScroll,
  scrollTopForPosition,
  stepZoom,
  totalHeight,
  visiblePageRange,
  type PagePosition
} from './layout'
import { loadPdf, type LoadedPdf } from './pdf'
import { PdfPage } from './PdfPage'
import { createThrottle } from './throttle'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; pdf: LoadedPdf; initial: ReadingPosition | null; highlights: Highlight[] }

const NO_HIGHLIGHTS: Highlight[] = []

export function ReaderView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const dataPromise = window.api.loadDocumentData().then(
        (data) => data,
        (err) => {
          console.error('Failed to load document data', err)
          return null
        }
      )
      try {
        const bytes = await window.api.readDocumentBytes()
        const pdf = await loadPdf(bytes)
        const data = await dataPromise
        if (!cancelled) {
          setState({ status: 'ready', pdf, initial: data?.reading ?? null, highlights: data?.highlights ?? NO_HIGHLIGHTS })
        }
      } catch (err) {
        console.error('Failed to open document', err)
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <div className="status">{t.reader.loading}</div>
  if (state.status === 'error') return <div className="status">{t.reader.loadFailed}</div>
  return <ReaderSurface pdf={state.pdf} initial={state.initial} initialHighlights={state.highlights} />
}

interface ReaderSurfaceProps {
  pdf: LoadedPdf
  initial: ReadingPosition | null
  initialHighlights: Highlight[]
}

function ReaderSurface({ pdf, initial, initialHighlights }: ReaderSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [zoom, setZoom] = useState<ZoomSetting>(initial?.zoom ?? { mode: 'fit-width' })
  // The page + ratio at the top of the viewport; kept across zoom and resize.
  const anchorRef = useRef<PagePosition>(initial ?? { pageIndex: 0, offsetRatio: 0 })
  const restoredRef = useRef(false)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // The scrollTop the app itself just set (restore after first measure, zoom change, or
  // resize); the next 'scroll' event caused by that assignment must not be treated as a
  // user scroll and must not report a Reading Position.
  const suppressedScrollTopRef = useRef<number | null>(null)
  // The zoom value in effect at mount, so the zoom-sync effect below does not report a
  // position just because it ran once after mount.
  const initialZoomRef = useRef(zoom)

  const onHighlightError = useCallback(() => alert(t.highlight.saveFailed), [])
  const { highlights, save } = useHighlights(initialHighlights, onHighlightError)
  const byPage = useMemo(() => highlightsByPage(highlights), [highlights])
  const [selection, setSelection] = useState<PendingSelection | null>(null)

  const pageCount = pdf.pageSizes.length
  const measured = viewport.width > 0
  const scale = useMemo(() => computeScale(zoom, viewport, pdf.pageSizes), [zoom, viewport, pdf.pageSizes])
  const boxes = useMemo(() => layoutPages(pdf.pageSizes, scale), [pdf.pageSizes, scale])

  const report = useMemo(
    () => createThrottle((reading: ReadingPosition) => window.api.reportReadingPosition(reading, pageCount), 500),
    [pageCount]
  )

  useLayoutEffect(() => {
    const element = scrollRef.current!
    const observer = new ResizeObserver(() =>
      setViewport({ width: element.clientWidth, height: element.clientHeight })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Restore the anchor whenever the layout changes (first measure, zoom, resize in fit modes).
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !measured) return
    element.scrollTop = scrollTopForPosition(anchorRef.current, boxes)
    suppressedScrollTopRef.current = element.scrollTop
    setScrollTop(element.scrollTop)
    restoredRef.current = true
  }, [boxes, measured])

  useEffect(() => {
    if (restoredRef.current && zoom !== initialZoomRef.current) {
      report.call({ ...anchorRef.current, zoom, updatedAt: Date.now() })
    }
  }, [zoom, report])

  useEffect(() => {
    const flush = () => report.flush()
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
      report.flush()
    }
  }, [report])

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  const createHighlight = useCallback(
    (color: HighlightColor) => {
      if (!selection) return
      const now = Date.now()
      save({
        id: crypto.randomUUID(),
        color,
        note: null,
        text: selection.text,
        parts: selection.parts,
        createdAt: now,
        updatedAt: now
      })
      clearSelection()
    },
    [selection, save, clearSelection]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey) {
        if (event.key === '=' || event.key === '+') setZoom(stepZoom(scale, 1))
        else if (event.key === '-') setZoom(stepZoom(scale, -1))
        else if (event.key === '0') setZoom({ mode: 'fit-width' })
        else return
        event.preventDefault()
        return
      }
      if (event.altKey || event.metaKey || isEditableTarget(event.target) || !selection) return
      const key = Number(event.key)
      if (Number.isInteger(key) && key >= 1 && key <= HIGHLIGHT_COLORS.length) {
        event.preventDefault()
        createHighlight(HIGHLIGHT_COLORS[key - 1])
      } else if (event.key === 'Escape') {
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scale, selection, createHighlight, clearSelection])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    setSelection(null)
    const suppressed = suppressedScrollTopRef.current
    suppressedScrollTopRef.current = null
    if (suppressed !== null && suppressed === element.scrollTop) {
      setScrollTop(element.scrollTop)
      return
    }
    setScrollTop(element.scrollTop)
    if (!restoredRef.current) return
    const position = positionFromScroll(element.scrollTop, boxes)
    anchorRef.current = position
    report.call({ ...position, zoom: zoomRef.current, updatedAt: Date.now() })
  }

  const onMouseUp = () => {
    const element = scrollRef.current
    if (!element) return
    setSelection(readSelection(element, scale))
  }

  const range = visiblePageRange(scrollTop, viewport.height, boxes)
  const current = currentPageIndex(scrollTop, viewport.height, boxes)

  return (
    <div className="reader">
      <div className="toolbar">
        <button title={t.reader.zoomOut} onClick={() => setZoom(stepZoom(scale, -1))}>
          −
        </button>
        <span className="zoom-value">{Math.round(scale * 100)}%</span>
        <button title={t.reader.zoomIn} onClick={() => setZoom(stepZoom(scale, 1))}>
          +
        </button>
        <button className={zoom.mode === 'fit-width' ? 'active' : ''} onClick={() => setZoom({ mode: 'fit-width' })}>
          {t.reader.fitWidth}
        </button>
        <button className={zoom.mode === 'fit-page' ? 'active' : ''} onClick={() => setZoom({ mode: 'fit-page' })}>
          {t.reader.fitPage}
        </button>
        <span className="page-indicator">{t.reader.page(current + 1, pageCount)}</span>
      </div>
      <div className="scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp}>
        <div className="pages" style={{ height: totalHeight(boxes), width: Math.max(viewport.width, contentWidth(boxes)) }}>
          {boxes.map((box, pageIndex) => (
            <PdfPage
              key={pageIndex}
              doc={pdf.doc}
              pageIndex={pageIndex}
              box={box}
              scale={scale}
              visible={pageIndex >= range.first && pageIndex <= range.last}
            >
              <HighlightLayer
                highlights={byPage.get(pageIndex) ?? NO_HIGHLIGHTS}
                pageIndex={pageIndex}
                scale={scale}
                activeId={null}
              />
            </PdfPage>
          ))}
        </div>
      </div>
      {selection && <SelectionToolbar anchor={selection.anchor} onPick={createHighlight} />}
    </div>
  )
}
```

- [ ] **Step 8: Append Highlight styles to `src/renderer/src/styles.css`**

```css
.highlight-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
.highlight-rect {
  position: absolute;
  mix-blend-mode: multiply;
  border-radius: 2px;
}
.highlight-rect.active {
  outline: 2px solid rgba(0, 0, 0, 0.45);
}
.selection-toolbar {
  position: fixed;
  z-index: 20;
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
}
.swatch {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}
.swatch.selected {
  outline: 2px solid #1f1f1f;
  outline-offset: 1px;
}
```

- [ ] **Step 9: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 10: App check — create Highlights**

Using the Verification environment, open a text PDF and via CDP:
1. Select part of a line (Range over a text span), then dispatch `mouseup` on the scroll container (`Input.dispatchMouseEvent` type `mouseReleased`, or `Runtime.evaluate` dispatching a `MouseEvent('mouseup', { bubbles: true })` on the span). Expected: `.selection-toolbar` exists with 5 `.swatch` buttons.
2. Press `2` (`Input.dispatchKeyEvent` keyDown/keyUp with `key: '2'`). Expected: a green `.highlight-rect` appears over the selected words (screenshot), the selection is cleared, and within ~1 s `<fp>.json` contains one Highlight with `color: "green"`, the selected text, and `parts[0].pageIndex` of that page.
3. Select text spanning the end of one page and the start of the next (Range from the last span of page N to the first span of page N+1), click the yellow swatch. Expected: ONE Highlight with two `parts` (pages N and N+1).
4. Relaunch the app: both Highlights are drawn again at the same places at a different zoom (e.g. Ctrl+= twice).

- [ ] **Step 11: Commit**

```bash
git add src/shared/highlightColors.ts src/shared/highlightColors.test.ts src/renderer/src/reader/highlights/selection.ts src/renderer/src/reader/highlights/useHighlights.ts src/renderer/src/reader/highlights/HighlightLayer.tsx src/renderer/src/reader/highlights/SelectionToolbar.tsx src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: create colored Highlights from selected text

Co-Authored-By: <your model>"
```

---

### Task 6: Edit Highlights — color, Note, delete

**Files:**
- Create: `src/renderer/src/reader/highlights/HighlightMenu.tsx`
- Modify: `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `hitTestHighlight` (Task 5), `useHighlights().remove` (Task 5), `t.highlight.note/notePlaceholder/saveNote/delete/colors` (Task 2).
- Produces: `HighlightMenu` props `{ highlight: Highlight; anchor: { x: number; y: number }; onChange(next: Highlight): void; onDelete(): void; onClose(): void }`.

Behavior:
- A click (no text selected) on a Highlight opens a menu at the click point: 5 color swatches (current one outlined), a Note textarea, "Lưu" and "Xóa highlight".
- Clicking a color saves immediately (`updatedAt` = now). "Lưu" saves the Note (trimmed; empty → `null`) and closes. "Xóa highlight" deletes it (main records a Deleted Highlight) and closes.
- `Escape` or a mousedown outside the menu closes it without saving the Note text.
- While the menu is open, the Highlight is outlined (`activeId`).
- Typing digits in the Note textarea never creates a Highlight.

- [ ] **Step 1: Create `src/renderer/src/reader/highlights/HighlightMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS, type Highlight } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'
import { t } from '../../../../shared/strings'

const MENU_WIDTH = 280
const MENU_HEIGHT = 230

interface HighlightMenuProps {
  highlight: Highlight
  anchor: { x: number; y: number }
  onChange(next: Highlight): void
  onDelete(): void
  onClose(): void
}

export function HighlightMenu({ highlight, anchor, onChange, onDelete, onClose }: HighlightMenuProps) {
  const [note, setNote] = useState(highlight.note ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const update = (patch: Partial<Pick<Highlight, 'color' | 'note'>>) =>
    onChange({ ...highlight, ...patch, updatedAt: Date.now() })

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.y + 8, window.innerHeight - MENU_HEIGHT - 8))

  return (
    <div ref={ref} className="highlight-menu" style={{ left, top, width: MENU_WIDTH }}>
      <div className="menu-swatches">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            className={color === highlight.color ? 'swatch selected' : 'swatch'}
            style={{ background: highlightCss(color) }}
            title={t.highlight.colors[color]}
            aria-label={t.highlight.colors[color]}
            onClick={() => update({ color })}
          />
        ))}
      </div>
      <label className="menu-note">
        {t.highlight.note}
        <textarea
          rows={4}
          value={note}
          placeholder={t.highlight.notePlaceholder}
          onChange={(event) => setNote(event.target.value)}
          autoFocus
        />
      </label>
      <div className="menu-actions">
        <button
          onClick={() => {
            const trimmed = note.trim()
            update({ note: trimmed === '' ? null : trimmed })
            onClose()
          }}
        >
          {t.highlight.saveNote}
        </button>
        <button className="danger" onClick={onDelete}>
          {t.highlight.delete}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the menu into `src/renderer/src/reader/ReaderView.tsx`**

2a. Add imports:

```ts
import { HighlightMenu } from './highlights/HighlightMenu'
```

and change the selection import to:

```ts
import { hitTestHighlight, isEditableTarget, readSelection, type PendingSelection } from './highlights/selection'
```

and add `type MouseEvent as ReactMouseEvent` to the React import:

```ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
```

2b. Replace

```ts
  const { highlights, save } = useHighlights(initialHighlights, onHighlightError)
```

with

```ts
  const { highlights, save, remove } = useHighlights(initialHighlights, onHighlightError)
  const [menu, setMenu] = useState<{ id: string; anchor: { x: number; y: number } } | null>(null)
  const menuHighlight = menu ? (highlights.find((h) => h.id === menu.id) ?? null) : null
  const closeMenu = useCallback(() => setMenu(null), [])
```

2c. Replace the whole `onMouseUp` function with:

```ts
  const onMouseUp = (event: ReactMouseEvent) => {
    const element = scrollRef.current
    if (!element) return
    const pending = readSelection(element, scale)
    setSelection(pending)
    if (pending) {
      setMenu(null)
      return
    }
    const hit = hitTestHighlight(event.target, event.clientX, event.clientY, highlights, scale)
    setMenu(hit ? { id: hit.id, anchor: { x: event.clientX, y: event.clientY } } : null)
  }
```

2d. In the JSX, change `activeId={null}` to `activeId={menu?.id ?? null}`, and after the `{selection && …}` line add:

```tsx
      {menu && menuHighlight && (
        <HighlightMenu
          key={menuHighlight.id}
          highlight={menuHighlight}
          anchor={menu.anchor}
          onChange={save}
          onDelete={() => {
            remove(menuHighlight.id)
            closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
```

- [ ] **Step 3: Append menu styles to `src/renderer/src/styles.css`**

```css
.highlight-menu {
  position: fixed;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
}
.menu-swatches {
  display: flex;
  gap: 6px;
}
.menu-note {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #555;
}
.menu-note textarea {
  font: inherit;
  resize: vertical;
  padding: 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.menu-actions {
  display: flex;
  justify-content: space-between;
}
.menu-actions button {
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 4px;
  padding: 4px 12px;
  font: inherit;
  cursor: pointer;
}
.menu-actions button.danger {
  color: #b3261e;
  border-color: #e6b0ab;
}
```

- [ ] **Step 4: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 5: App check — edit and delete**

With a Document that has a Highlight (from Task 5), via CDP:
1. Click (mousePressed + mouseReleased, no drag) in the middle of a `.highlight-rect`. Expected: `.highlight-menu` appears, the rect has class `active`.
2. Click the blue swatch. Expected: the overlay turns blue; JSON `color` becomes `"blue"` with a newer `updatedAt`.
3. Focus the textarea, type `ghi chú 123`, click "Lưu". Expected: menu closes; JSON `note` is `"ghi chú 123"`; no new Highlight was created by the digits.
4. Open the menu again; the textarea shows the Note. Click "Xóa highlight". Expected: overlay gone; JSON has no such Highlight and `deletedHighlights` contains its id.
5. Open the menu, press `Escape`: it closes and nothing is written.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/reader/highlights/HighlightMenu.tsx src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: change color, add Notes and delete Highlights

Co-Authored-By: <your model>"
```

---

### Task 7: Highlight sidebar panel

**Files:**
- Create: `src/renderer/src/reader/highlights/filter.ts`, `src/renderer/src/reader/highlights/filter.test.ts`, `src/renderer/src/reader/highlights/HighlightPanel.tsx`
- Modify: `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `foldText` (Task 3), `sortHighlightsByPosition`, `highlightScrollTop` (Task 3), `t.highlight.*` (Task 2).
- Produces:
  - `filterHighlights(highlights: Highlight[], colors: ReadonlySet<HighlightColor>, query: string): Highlight[]`
  - `HighlightPanel` props `{ highlights: Highlight[]; activeId: string | null; onSelect(highlight: Highlight): void }`
  - Reader layout: `.reader` → `.toolbar` + `.reader-body` (`aside.sidebar` + `.scroll`). Plan 3 adds tabs to `aside.sidebar`.

Behavior:
- A toolbar button (first in the toolbar) and `Ctrl+B` toggle a left sidebar. It starts closed.
- The panel lists Highlights sorted by position (page, then top, then left), Unanchored Highlights last. Each row: color dot, text (max 3 lines), Note (italic, if any), "Trang N" or the Unanchored label.
- Color chips filter by color (none selected = all). The search box filters by text or Note, ignoring case and Vietnamese diacritics.
- Clicking an anchored row scrolls so the Highlight is near the top and outlines it for 1.5 s. Unanchored rows are disabled.
- Empty states: `t.highlight.empty` (no Highlights), `t.highlight.noMatch` (filters exclude all).

- [ ] **Step 1: Write the failing filter test**

`src/renderer/src/reader/highlights/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { filterHighlights } from './filter'

function hl(id: string, text: string, color: Highlight['color'], note: string | null = null): Highlight {
  return { id, color, note, text, parts: [], createdAt: 1, updatedAt: 1 }
}

const ITEMS = [hl('a', 'Điều khoản thanh toán', 'yellow'), hl('b', 'Phụ lục', 'green', 'Kiểm tra lại số tiền')]

describe('filterHighlights', () => {
  it('returns everything with no colors and no query', () => {
    expect(filterHighlights(ITEMS, new Set(), '').map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('filters by selected colors', () => {
    expect(filterHighlights(ITEMS, new Set(['green']), '').map((h) => h.id)).toEqual(['b'])
  })

  it('matches text or Note, ignoring case and diacritics', () => {
    expect(filterHighlights(ITEMS, new Set(), 'dieu KHOAN').map((h) => h.id)).toEqual(['a'])
    expect(filterHighlights(ITEMS, new Set(), 'so tien').map((h) => h.id)).toEqual(['b'])
  })

  it('combines colors and query', () => {
    expect(filterHighlights(ITEMS, new Set(['yellow']), 'phu luc')).toEqual([])
  })
})
```

Run: `npx vitest run src/renderer/src/reader/highlights/filter.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `src/renderer/src/reader/highlights/filter.ts`**

```ts
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
```

Run the test again → PASS.

- [ ] **Step 3: Create `src/renderer/src/reader/highlights/HighlightPanel.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../../../../shared/documentData'
import { highlightCss } from '../../../../shared/highlightColors'
import { t } from '../../../../shared/strings'
import { filterHighlights } from './filter'
import { sortHighlightsByPosition } from './geometry'

interface HighlightPanelProps {
  highlights: Highlight[]
  activeId: string | null
  onSelect(highlight: Highlight): void
}

export function HighlightPanel({ highlights, activeId, onSelect }: HighlightPanelProps) {
  const [query, setQuery] = useState('')
  const [colors, setColors] = useState<ReadonlySet<HighlightColor>>(new Set())
  const sorted = useMemo(() => sortHighlightsByPosition(highlights), [highlights])
  const shown = useMemo(() => filterHighlights(sorted, colors, query), [sorted, colors, query])

  const toggleColor = (color: HighlightColor) =>
    setColors((current) => {
      const next = new Set(current)
      if (next.has(color)) next.delete(color)
      else next.add(color)
      return next
    })

  return (
    <div className="highlight-panel">
      <div className="panel-header">
        {t.highlight.panelTitle} <span className="panel-count">{highlights.length}</span>
      </div>
      <input
        className="panel-search"
        type="search"
        placeholder={t.highlight.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="panel-colors">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            className={colors.has(color) ? 'swatch selected' : 'swatch'}
            style={{ background: highlightCss(color) }}
            title={t.highlight.colors[color]}
            aria-label={t.highlight.colors[color]}
            aria-pressed={colors.has(color)}
            onClick={() => toggleColor(color)}
          />
        ))}
      </div>
      {highlights.length === 0 ? (
        <p className="panel-empty">{t.highlight.empty}</p>
      ) : shown.length === 0 ? (
        <p className="panel-empty">{t.highlight.noMatch}</p>
      ) : (
        <ul className="panel-list">
          {shown.map((highlight) => {
            const unanchored = highlight.status === 'unanchored'
            const firstPage = highlight.parts[0]?.pageIndex
            const classes = ['panel-item', highlight.id === activeId ? 'active' : '', unanchored ? 'unanchored' : '']
            return (
              <li key={highlight.id}>
                <button className={classes.join(' ').trim()} disabled={unanchored} onClick={() => onSelect(highlight)}>
                  <span className="panel-dot" style={{ background: highlightCss(highlight.color) }} />
                  <span className="panel-text">{highlight.text}</span>
                  {highlight.note && <span className="panel-note">{highlight.note}</span>}
                  <span className="panel-meta">
                    {unanchored ? t.highlight.unanchored : firstPage !== undefined ? t.highlight.page(firstPage + 1) : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the sidebar into `src/renderer/src/reader/ReaderView.tsx`**

4a. Add imports:

```ts
import { highlightScrollTop, highlightsByPage } from './highlights/geometry'
import { HighlightPanel } from './highlights/HighlightPanel'
```

(the first replaces the existing `import { highlightsByPage } from './highlights/geometry'`).

4b. After the `closeMenu` line, add:

```ts
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  useEffect(() => {
    if (focusedId === null) return
    const timer = setTimeout(() => setFocusedId(null), 1500)
    return () => clearTimeout(timer)
  }, [focusedId])

  const goToHighlight = (highlight: Highlight) => {
    const element = scrollRef.current
    const top = highlightScrollTop(highlight, boxes, scale)
    if (!element || top === null) return
    element.scrollTop = top
    setFocusedId(highlight.id)
  }
```

4c. In the keydown handler, inside the `if (event.ctrlKey) { … }` block, add a branch before the final `else return`:

```ts
        else if (event.key === 'b' || event.key === 'B') setSidebarOpen((open) => !open)
```

so the block reads:

```ts
      if (event.ctrlKey) {
        if (event.key === '=' || event.key === '+') setZoom(stepZoom(scale, 1))
        else if (event.key === '-') setZoom(stepZoom(scale, -1))
        else if (event.key === '0') setZoom({ mode: 'fit-width' })
        else if (event.key === 'b' || event.key === 'B') setSidebarOpen((open) => !open)
        else return
        event.preventDefault()
        return
      }
```

4d. Replace everything from `const range = visiblePageRange(…)` to the end of `ReaderSurface` with:

```tsx
  const range = visiblePageRange(scrollTop, viewport.height, boxes)
  const current = currentPageIndex(scrollTop, viewport.height, boxes)
  const activeId = menu?.id ?? focusedId

  return (
    <div className="reader">
      <div className="toolbar">
        <button
          className={sidebarOpen ? 'active' : ''}
          title={t.highlight.togglePanel}
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>
        <button title={t.reader.zoomOut} onClick={() => setZoom(stepZoom(scale, -1))}>
          −
        </button>
        <span className="zoom-value">{Math.round(scale * 100)}%</span>
        <button title={t.reader.zoomIn} onClick={() => setZoom(stepZoom(scale, 1))}>
          +
        </button>
        <button className={zoom.mode === 'fit-width' ? 'active' : ''} onClick={() => setZoom({ mode: 'fit-width' })}>
          {t.reader.fitWidth}
        </button>
        <button className={zoom.mode === 'fit-page' ? 'active' : ''} onClick={() => setZoom({ mode: 'fit-page' })}>
          {t.reader.fitPage}
        </button>
        <span className="page-indicator">{t.reader.page(current + 1, pageCount)}</span>
      </div>
      <div className="reader-body">
        {sidebarOpen && (
          <aside className="sidebar">
            <HighlightPanel highlights={highlights} activeId={activeId} onSelect={goToHighlight} />
          </aside>
        )}
        <div className="scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp}>
          <div className="pages" style={{ height: totalHeight(boxes), width: Math.max(viewport.width, contentWidth(boxes)) }}>
            {boxes.map((box, pageIndex) => (
              <PdfPage
                key={pageIndex}
                doc={pdf.doc}
                pageIndex={pageIndex}
                box={box}
                scale={scale}
                visible={pageIndex >= range.first && pageIndex <= range.last}
              >
                <HighlightLayer
                  highlights={byPage.get(pageIndex) ?? NO_HIGHLIGHTS}
                  pageIndex={pageIndex}
                  scale={scale}
                  activeId={activeId}
                />
              </PdfPage>
            ))}
          </div>
        </div>
      </div>
      {selection && <SelectionToolbar anchor={selection.anchor} onPick={createHighlight} />}
      {menu && menuHighlight && (
        <HighlightMenu
          key={menuHighlight.id}
          highlight={menuHighlight}
          anchor={menu.anchor}
          onChange={save}
          onDelete={() => {
            remove(menuHighlight.id)
            closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Append sidebar styles to `src/renderer/src/styles.css`**

The existing `.scroll` rule stays unchanged. Append:

```css
.reader-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.reader-body .scroll {
  flex: 1;
  min-width: 0;
}
.sidebar {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #fafafa;
  border-right: 1px solid #ddd;
  min-height: 0;
}
.highlight-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  min-height: 0;
  flex: 1;
}
.panel-header {
  font-weight: 600;
}
.panel-count {
  color: #777;
  font-weight: 400;
}
.panel-search {
  font: inherit;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.panel-colors {
  display: flex;
  gap: 6px;
}
.panel-colors .swatch {
  width: 22px;
  height: 22px;
}
.panel-empty {
  color: #777;
}
.panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.panel-item {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 2px 8px;
  width: 100%;
  margin-bottom: 6px;
  padding: 8px;
  text-align: left;
  background: #fff;
  border: 1px solid #e2e2e2;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}
.panel-item.active {
  border-color: #7aa7ff;
}
.panel-item.unanchored {
  cursor: default;
  opacity: 0.7;
}
.panel-dot {
  grid-row: span 3;
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 50%;
}
.panel-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.panel-note {
  font-style: italic;
  color: #555;
}
.panel-meta {
  color: #888;
  font-size: 12px;
}
```

- [ ] **Step 6: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 7: App check — panel**

With a Document that has ≥ 3 Highlights in different colors on different pages (one with a Note):
1. Press `Ctrl+B`: `.sidebar .highlight-panel` appears with the Highlights in page order; the page width re-fits (fit-width).
2. Type a Note word without diacritics into the search box: only the Highlight with that Note remains.
3. Click a color chip: only that color remains; click it again: all return.
4. Clear filters, click the last row: the view scrolls to that Highlight (its page indicator updates) and its overlay is outlined briefly.
5. Press `Ctrl+B` again: the sidebar closes.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/reader/highlights/filter.ts src/renderer/src/reader/highlights/filter.test.ts src/renderer/src/reader/highlights/HighlightPanel.tsx src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: add Highlight sidebar with search and color filter

Co-Authored-By: <your model>"
```

---

### Task 8: Re-anchor carried Highlights

**Files:**
- Create: `src/renderer/src/reader/highlights/reanchor.ts`, `src/renderer/src/reader/highlights/reanchor.test.ts`
- Modify: `src/renderer/src/reader/pdf.ts`, `src/renderer/src/reader/ReaderView.tsx`

**Interfaces:**
- Consumes: `buildTextIndex`, `findAllText`, `matchToParts`, `TextRun`, `TextIndex` (Task 3); `Util` from `pdfjs-dist`.
- Produces:
  - `reanchorHighlight(index: TextIndex, highlight: Highlight, now: number): Highlight`
  - `loadPageTextRuns(doc: PDFDocumentProxy, pageIndex: number): Promise<TextRun[]>` in `pdf.ts`
  - `getDocumentTextIndex(doc: PDFDocumentProxy): Promise<TextIndex>` in `pdf.ts` (cached per document; Plan 3 search reuses it)

Behavior: when a Document opens with Highlights whose `status` is `'carried'`, the reader builds the text index and, for each one, finds its `text` in the new file. If found, the occurrence closest to the old position (same page first, then nearest top) becomes its new `parts` and `status` is removed. If not found, `status` becomes `'unanchored'` (listed in the panel, not drawn). Each result is saved.

Text runs assume horizontal text; rotated text gets an approximate box (acceptable).

- [ ] **Step 1: Write the failing test**

`src/renderer/src/reader/highlights/reanchor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { reanchorHighlight } from './reanchor'
import { buildTextIndex, type TextRun } from './textIndex'

const RUNS: TextRun[] = [
  { pageIndex: 0, text: 'Payment terms apply', rect: { x: 0, y: 10, width: 190, height: 10 }, hasEOL: true },
  { pageIndex: 3, text: 'Payment terms again', rect: { x: 0, y: 40, width: 190, height: 10 }, hasEOL: false }
]
const INDEX = buildTextIndex(RUNS)

function carried(text: string, pageIndex: number, y: number): Highlight {
  return {
    id: 'h',
    color: 'yellow',
    note: 'kept',
    text,
    parts: [{ pageIndex, rects: [{ x: 0, y, width: 50, height: 10 }] }],
    createdAt: 1,
    updatedAt: 1,
    status: 'carried'
  }
}

describe('reanchorHighlight', () => {
  it('moves the Highlight to its text and clears the status', () => {
    const result = reanchorHighlight(INDEX, carried('payment TERMS', 0, 12), 99)
    expect(result.status).toBeUndefined()
    expect(result.updatedAt).toBe(99)
    expect(result.note).toBe('kept')
    expect(result.parts).toEqual([{ pageIndex: 0, rects: [{ x: 0, y: 10, width: 130, height: 10 }] }])
  })

  it('prefers the occurrence closest to the old page', () => {
    const result = reanchorHighlight(INDEX, carried('payment terms', 3, 40), 99)
    expect(result.parts[0].pageIndex).toBe(3)
  })

  it('marks the Highlight Unanchored when its text is gone', () => {
    const result = reanchorHighlight(INDEX, carried('termination clause', 0, 10), 99)
    expect(result.status).toBe('unanchored')
    expect(result.parts).toEqual(carried('termination clause', 0, 10).parts)
    expect(result.updatedAt).toBe(99)
  })
})
```

(Check: "payment terms" is 13 of the 19 characters of "Payment terms apply", so width = 190 × 13 / 19 = 130.)

Run: `npx vitest run src/renderer/src/reader/highlights/reanchor.test.ts` → FAIL (module not found).

- [ ] **Step 2: Create `src/renderer/src/reader/highlights/reanchor.ts`**

```ts
import type { Highlight, HighlightPart } from '../../../../shared/documentData'
import { findAllText, matchToParts, type TextIndex } from './textIndex'

const PAGE_WEIGHT = 100_000

/** Finds a carried Highlight's text in the Document; the closest occurrence to its old place wins. */
export function reanchorHighlight(index: TextIndex, highlight: Highlight, now: number): Highlight {
  const origin = highlight.parts[0]
  const originY = origin?.rects[0]?.y ?? 0
  let best: HighlightPart[] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const match of findAllText(index, highlight.text)) {
    const parts = matchToParts(index, match)
    const first = parts[0]
    if (!first) continue
    const score = origin
      ? Math.abs(first.pageIndex - origin.pageIndex) * PAGE_WEIGHT + Math.abs((first.rects[0]?.y ?? 0) - originY)
      : 0
    if (score < bestScore) {
      best = parts
      bestScore = score
    }
  }
  if (!best) return { ...highlight, status: 'unanchored', updatedAt: now }
  return { ...highlight, parts: best, status: undefined, updatedAt: now }
}
```

Run the test again → PASS.

- [ ] **Step 3: Add text loading to `src/renderer/src/reader/pdf.ts`**

Add imports at the top:

```ts
import { buildTextIndex, type TextIndex, type TextRun } from './highlights/textIndex'
```

Append:

```ts
/** Text runs of one page in page units (scale 1, origin top-left), for search and re-anchoring. */
export async function loadPageTextRuns(doc: PDFDocumentProxy, pageIndex: number): Promise<TextRun[]> {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const runs: TextRun[] = []
  for (const item of content.items) {
    if (!('str' in item)) continue
    if (item.str === '') {
      if (item.hasEOL && runs.length > 0) runs[runs.length - 1].hasEOL = true
      continue
    }
    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const height = Math.hypot(tx[2], tx[3])
    runs.push({
      pageIndex,
      text: item.str,
      hasEOL: item.hasEOL,
      rect: { x: tx[4], y: tx[5] - height, width: item.width, height }
    })
  }
  return runs
}

const textIndexCache = new WeakMap<PDFDocumentProxy, Promise<TextIndex>>()

/** Folded text index of the whole Document, built once per loaded document. */
export function getDocumentTextIndex(doc: PDFDocumentProxy): Promise<TextIndex> {
  let cached = textIndexCache.get(doc)
  if (!cached) {
    cached = Promise.all(Array.from({ length: doc.numPages }, (_, i) => loadPageTextRuns(doc, i))).then((pages) =>
      buildTextIndex(pages.flat())
    )
    textIndexCache.set(doc, cached)
  }
  return cached
}
```

- [ ] **Step 4: Re-anchor on open in `src/renderer/src/reader/ReaderView.tsx`**

Add imports:

```ts
import { reanchorHighlight } from './highlights/reanchor'
```

and change `import { loadPdf, type LoadedPdf } from './pdf'` to:

```ts
import { getDocumentTextIndex, loadPdf, type LoadedPdf } from './pdf'
```

After the `useHighlights(...)` line block (after `closeMenu`), add:

```ts
  // Carried Highlights came from an earlier version of this file; find their text again.
  useEffect(() => {
    const carried = initialHighlights.filter((h) => h.status === 'carried')
    if (carried.length === 0) return
    let cancelled = false
    getDocumentTextIndex(pdf.doc)
      .then((index) => {
        if (cancelled) return
        const now = Date.now()
        for (const highlight of carried) save(reanchorHighlight(index, highlight, now))
      })
      .catch((err) => console.error('Failed to re-anchor highlights', err))
    return () => {
      cancelled = true
    }
  }, [pdf.doc, initialHighlights, save])
```

- [ ] **Step 5: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 6: App check — Carry Over end to end**

1. Generate PDF v1 with text on several pages; open it, create 2 Highlights: one on text that will stay, one on text that will be removed. Close.
2. Generate PDF v2 at the SAME path from the same generator with: the kept text moved to a different line/page, and the removed text deleted. (The Fingerprint changes because the content changes.)
3. Open it, accept Carry Over. Expected: the kept Highlight is drawn over its text at the new place; the removed one is not drawn, appears in the panel (Ctrl+B) as "Mất neo…" and is disabled; the JSON shows the first without `status` and the second with `"status": "unanchored"`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/reader/highlights/reanchor.ts src/renderer/src/reader/highlights/reanchor.test.ts src/renderer/src/reader/pdf.ts src/renderer/src/reader/ReaderView.tsx
git commit -m "feat: re-anchor carried Highlights by their text

Co-Authored-By: <your model>"
```

---

### Task 9: End-to-end verification

**Files:**
- No code changes expected. If a check fails, fix it in the file that owns the behavior, add a unit test when the cause is in pure logic, and commit the fix separately.

- [ ] **Step 1: Automated checks**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 2: Sync of Highlights between "machines"**

With an isolated Data Folder:
1. Open a PDF, create Highlight A, close the app.
2. Copy `<fp>.json` to `<fp>-LAPTOP.json`. In the copy, add Highlight B (copy A's object, new `id`, other `color`, larger `updatedAt`) and add `{ "id": "<A's id>", "deletedAt": <now> }` to `deletedHighlights`.
3. Open the PDF. Expected: only B is drawn; the conflict copy is gone; the main JSON has B and the Deleted Highlight for A.

- [ ] **Step 3: Malformed data does not break the reader**

Add a malformed Highlight object (e.g. `{ "id": "x" }`) and a `reading` with `pageIndex: -5` to the JSON. Open: the PDF opens at page 1, valid Highlights draw, no errors. A later edit rewrites the file without the malformed entries.

- [ ] **Step 4: Production build**

`npm run dist` → installer builds. Run `dist\win-unpacked\PdfReader.exe "<pdf>"` with an isolated Data Folder: selecting text and pressing `1` creates a Highlight that survives a restart.

- [ ] **Step 5: Pending human checks (list them in the report)**

Real mouse drag selection across lines and pages; feel of the toolbar position; Note editing with a Vietnamese IME; Carry Over dialog wording.

- [ ] **Step 6: Commit any fixes**

Only if Steps 1–4 needed fixes; each fix has its own test and commit.
