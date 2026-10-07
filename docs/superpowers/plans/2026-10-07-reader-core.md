# Reader Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows desktop app that opens PDFs in continuous-scroll view and automatically remembers each Document's Reading Position (page, scroll offset, zoom), synced across machines through a OneDrive Data Folder.

**Architecture:** Electron app built with electron-vite. The main process owns all file I/O: it computes Document Fingerprints, stores one JSON file per Document in the Data Folder (atomic writes, OneDrive Conflict Copy merging), keeps the per-machine Recent Documents list, and manages one window per Document. The React renderer renders PDFs with pdf.js, virtualizes pages, and reports the Reading Position to main over IPC; main debounces writes. Pure logic (merge, fingerprint, layout math) lives in small modules with Vitest unit tests.

**Tech Stack:** Electron 38+, electron-vite 4, Vite 7, React 19, TypeScript 5.9 (strict), pdfjs-dist 4.10.38, Vitest 3.

**Domain language:** Read `CONTEXT.md` before starting. Use its terms (Document, Document Fingerprint, Reading Position, Reading Progress, Highlight, Deleted Highlight, Data Folder, Conflict Copy, Recent Documents) in code names. Design decisions are recorded in `docs/adr/0001-identify-documents-by-content.md` and `docs/adr/0002-per-document-json-in-onedrive.md`.

## Global Constraints

- Platform: Windows 10/11 x64. Paths are Windows paths; compare paths case-insensitively.
- The app NEVER writes to, renames, or deletes the user's PDF files. It only reads them.
- Data Folder: env var `PDFREADER_DATA_DIR` if set; else `%OneDriveConsumer%\PdfReaderData` (personal OneDrive; work `%OneDrive%`/`%OneDriveCommercial%` ignored); else `%APPDATA%\PdfReader`.
- Document data: exactly one file per Document at `<Data Folder>\documents\<fingerprint>.json`, always written atomically (temp file in the same folder, then rename).
- Document Fingerprint: SHA-256 hex (64 chars) of `"pdfreader-v1:<fileSize>:"` followed by the first 4 MiB (4 * 1024 * 1024 bytes) of the file.
- OneDrive Conflict Copy: any file in the documents folder named `<fingerprint>-<anything>.json`.
- Merge rules: Reading Position takes the higher `updatedAt`; Highlights are unioned by `id` keeping the higher `updatedAt`; a Deleted Highlight always wins over a Highlight with the same `id`.
- Reading Position save: main writes 3000 ms after the last reported change, immediately when the Document window loses focus or closes, and before the app quits.
- One window per Document. Opening a Document that is already open focuses its window.
- Recent Documents: local to each machine, stored at `<userData>\recent.json`, newest first, max 20 entries.
- All user-visible text lives in `src/shared/strings.ts`, in Vietnamese.
- `pdfjs-dist` is pinned to exactly `4.10.38`.
- `npm run typecheck` and `npm test` must pass at the end of every task.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Roadmap (later plans, not part of this plan)

- **Plan 2 — Highlights & Notes:** pdf.js text layer, select-text floating toolbar with 5 Highlight Colors (keys `1`–`5`), Notes, Highlights crossing page breaks, Highlight sidebar panel (sorted by position, color filter, search in current Document), re-anchoring by stored text, Unanchored Highlights, Carry Over prompt when a Recent Documents path now has a different Fingerprint.
- **Plan 3 — Reader features:** Ctrl+F search, outline sidebar, dark mode with optional page inversion, password-protected PDFs (prompt, never stored), "no text layer" notice for scanned PDFs, Settings screen to change the Data Folder.
- **Plan 4 — Export & packaging:** Export to a new PDF with `pdf-lib` (Highlights as highlight annotations, Notes as popup annotations, Save As with default name `<name> (highlighted).pdf`), NSIS installer via `electron-builder` with "Open with" registration for `.pdf`.

## File Structure

```
package.json                     scripts + dev dependencies
tsconfig.json                    one strict TS config for all code
electron.vite.config.ts          main / preload / renderer builds
vitest.config.ts                 unit tests under src/**/*.test.ts
.gitignore
src/shared/documentData.ts       DocumentData types, parse, merge, Reading Progress
src/shared/ipc.ts                IPC channel names + API types shared by main/preload/renderer
src/shared/strings.ts            all Vietnamese UI strings
src/main/fingerprint.ts          Document Fingerprint from file content
src/main/dataFolder.ts           Data Folder resolution
src/main/documentStore.ts        per-Document JSON store: atomic write, Conflict Copy merge, per-Document queue
src/main/positionSaver.ts        debounced Reading Position writes
src/main/recent.ts               Recent Documents list (pure + file store)
src/main/argv.ts                 find a PDF path in process argv
src/main/windows.ts              home window + one window per Document
src/main/index.ts                app lifecycle, IPC handlers, menu
src/preload/index.ts             exposes window.api
src/renderer/index.html
src/renderer/src/main.tsx        React entry
src/renderer/src/App.tsx         picks Home or Reader view
src/renderer/src/env.d.ts        window.api typing + vite client types
src/renderer/src/styles.css
src/renderer/src/reader/layout.ts     pure page layout / scroll math / zoom steps
src/renderer/src/reader/throttle.ts   trailing throttle
src/renderer/src/reader/pdf.ts        pdf.js setup + loading
src/renderer/src/reader/PdfPage.tsx   one virtualized page canvas
src/renderer/src/reader/ReaderView.tsx  reader screen
src/renderer/src/home/HomeView.tsx    Recent Documents screen
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts `dev`, `build`, `preview`, `typecheck`, `test`; build outputs `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`.

- [ ] **Step 1: Initialize git**

The project folder already contains `CONTEXT.md` and `docs/`. Keep them.

```bash
git init
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
out/
dist/
*.log
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "pdf-reader",
  "version": "0.1.0",
  "private": true,
  "description": "Personal PDF reader that remembers where you stopped and lets you highlight text",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: Install dependencies**

All packages are dev dependencies: the renderer bundles React and pdf.js, and main/preload only use Node and Electron built-ins.

```bash
npm install -D electron@^38 electron-vite@^4 vite@^7 @vitejs/plugin-react@^5 typescript@^5.9 vitest@^3 @types/node@^22 react@^19 react-dom@^19 @types/react@^19 @types/react-dom@^19 pdfjs-dist@4.10.38
```

If npm reports a peer dependency conflict between `electron-vite` and `vite`, run `npm view electron-vite@4 peerDependencies` and install the highest `vite` major it lists.

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["node", "vite/client"],
    "noEmit": true
  },
  "include": ["src", "electron.vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: Create `electron.vite.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
```

- [ ] **Step 7: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
```

- [ ] **Step 8: Create minimal main process `src/main/index.ts`**

Task 7 replaces this file.

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 9: Create minimal preload `src/preload/index.ts`**

Task 7 replaces this file.

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 10: Create renderer files**

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <title>PdfReader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/src/App.tsx` (replaced in Task 7):

```tsx
export function App() {
  return <h1>PdfReader</h1>
}
```

`src/renderer/src/env.d.ts` (Task 7 adds `window.api` typing):

```ts
/// <reference types="vite/client" />
```

`src/renderer/src/styles.css`:

```css
:root {
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
}
* {
  box-sizing: border-box;
}
html,
body,
#root {
  margin: 0;
  height: 100%;
}
body {
  background: #f3f3f3;
  color: #1f1f1f;
}
```

- [ ] **Step 11: Verify typecheck and empty test run**

Run: `npm run typecheck`
Expected: exits 0, no output.

Run: `npx vitest run --passWithNoTests`
Expected: "No test files found, exiting with code 0".

- [ ] **Step 12: Verify the app launches**

Run: `npm run dev`
Expected: one window opens showing the heading "PdfReader". Close it; the process exits.

- [ ] **Step 13: Commit**

```bash
git add .
git commit -m "chore: scaffold electron-vite React app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Document data model, merge, Reading Progress

**Files:**
- Create: `src/shared/documentData.ts`
- Test: `src/shared/documentData.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact exports of `src/shared/documentData.ts`):
  - `type Fingerprint = string`
  - `type ZoomSetting = { mode: 'fit-width' } | { mode: 'fit-page' } | { mode: 'percent'; value: number }`
  - `interface ReadingPosition { pageIndex: number; offsetRatio: number; zoom: ZoomSetting; updatedAt: number }`
  - `const HIGHLIGHT_COLORS`, `type HighlightColor`, `interface HighlightRect`, `interface HighlightPart`, `interface Highlight`, `interface DeletedHighlight`
  - `interface DocumentData { schemaVersion: 1; fingerprint; pageCount; reading: ReadingPosition | null; highlights: Highlight[]; deletedHighlights: DeletedHighlight[] }`
  - `emptyDocumentData(fingerprint: Fingerprint): DocumentData`
  - `parseDocumentData(raw: unknown): DocumentData` (throws on invalid input)
  - `mergeDocumentData(a: DocumentData, b: DocumentData): DocumentData`
  - `readingProgress(reading: ReadingPosition | null, pageCount: number): number | null`

The Highlight types are defined now so the file format and merge rules are fixed from the first saved file. Plan 2 builds the Highlight UI on them.

- [ ] **Step 1: Write the failing tests**

`src/shared/documentData.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  emptyDocumentData,
  mergeDocumentData,
  parseDocumentData,
  readingProgress,
  type DocumentData,
  type Highlight,
  type ReadingPosition
} from './documentData'

const FP = 'f'.repeat(64)

function reading(pageIndex: number, updatedAt: number, offsetRatio = 0): ReadingPosition {
  return { pageIndex, offsetRatio, zoom: { mode: 'fit-width' }, updatedAt }
}

function highlight(id: string, updatedAt = 1, createdAt = 1): Highlight {
  return {
    id,
    color: 'yellow',
    note: null,
    text: `text ${id}`,
    parts: [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] }],
    createdAt,
    updatedAt
  }
}

function doc(patch: Partial<DocumentData>): DocumentData {
  return { ...emptyDocumentData(FP), ...patch }
}

describe('emptyDocumentData', () => {
  it('has no reading position and no highlights', () => {
    expect(emptyDocumentData(FP)).toEqual({
      schemaVersion: 1,
      fingerprint: FP,
      pageCount: 0,
      reading: null,
      highlights: [],
      deletedHighlights: []
    })
  })
})

describe('parseDocumentData', () => {
  it('round-trips serialized data', () => {
    const data = doc({ pageCount: 12, reading: reading(3, 100), highlights: [highlight('a')] })
    expect(parseDocumentData(JSON.parse(JSON.stringify(data)))).toEqual(data)
  })

  it('fills missing arrays and pageCount with defaults', () => {
    expect(parseDocumentData({ schemaVersion: 1, fingerprint: FP })).toEqual(emptyDocumentData(FP))
  })

  it('rejects non-objects', () => {
    expect(() => parseDocumentData('nope')).toThrow()
    expect(() => parseDocumentData(null)).toThrow()
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseDocumentData({ schemaVersion: 2, fingerprint: FP })).toThrow(/schemaVersion/)
  })

  it('rejects missing fingerprint', () => {
    expect(() => parseDocumentData({ schemaVersion: 1 })).toThrow(/fingerprint/)
  })
})

describe('mergeDocumentData', () => {
  it('keeps the more recently updated reading position', () => {
    const older = doc({ reading: reading(80, 1000) })
    const newer = doc({ reading: reading(60, 2000) })
    expect(mergeDocumentData(older, newer).reading).toEqual(reading(60, 2000))
    expect(mergeDocumentData(newer, older).reading).toEqual(reading(60, 2000))
  })

  it('keeps a reading position when the other side has none', () => {
    expect(mergeDocumentData(doc({}), doc({ reading: reading(5, 1) })).reading).toEqual(reading(5, 1))
    expect(mergeDocumentData(doc({ reading: reading(5, 1) }), doc({})).reading).toEqual(reading(5, 1))
  })

  it('unions highlights by id', () => {
    const merged = mergeDocumentData(doc({ highlights: [highlight('a')] }), doc({ highlights: [highlight('b')] }))
    expect(merged.highlights.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('keeps the more recently updated version of the same highlight', () => {
    const old = { ...highlight('a', 1), color: 'yellow' as const }
    const edited = { ...highlight('a', 5), color: 'green' as const }
    expect(mergeDocumentData(doc({ highlights: [old] }), doc({ highlights: [edited] })).highlights).toEqual([edited])
    expect(mergeDocumentData(doc({ highlights: [edited] }), doc({ highlights: [old] })).highlights).toEqual([edited])
  })

  it('drops a highlight that the other side deleted, even if edited later', () => {
    const merged = mergeDocumentData(
      doc({ highlights: [highlight('a', 999)] }),
      doc({ deletedHighlights: [{ id: 'a', deletedAt: 10 }] })
    )
    expect(merged.highlights).toEqual([])
    expect(merged.deletedHighlights).toEqual([{ id: 'a', deletedAt: 10 }])
  })

  it('unions deleted highlights and keeps the latest deletedAt', () => {
    const merged = mergeDocumentData(
      doc({ deletedHighlights: [{ id: 'a', deletedAt: 1 }, { id: 'c', deletedAt: 3 }] }),
      doc({ deletedHighlights: [{ id: 'a', deletedAt: 7 }, { id: 'b', deletedAt: 2 }] })
    )
    expect(merged.deletedHighlights).toEqual([
      { id: 'a', deletedAt: 7 },
      { id: 'b', deletedAt: 2 },
      { id: 'c', deletedAt: 3 }
    ])
  })

  it('sorts highlights by createdAt, then id', () => {
    const merged = mergeDocumentData(
      doc({ highlights: [highlight('z', 1, 5), highlight('b', 1, 2)] }),
      doc({ highlights: [highlight('a', 1, 2)] })
    )
    expect(merged.highlights.map((h) => h.id)).toEqual(['a', 'b', 'z'])
  })

  it('takes the larger pageCount', () => {
    expect(mergeDocumentData(doc({ pageCount: 0 }), doc({ pageCount: 40 })).pageCount).toBe(40)
  })

  it('gives the same result in either order', () => {
    const a = doc({ pageCount: 10, reading: reading(2, 50), highlights: [highlight('x', 3)], deletedHighlights: [{ id: 'y', deletedAt: 4 }] })
    const b = doc({ pageCount: 10, reading: reading(7, 60), highlights: [highlight('x', 9), highlight('y', 1)] })
    expect(mergeDocumentData(a, b)).toEqual(mergeDocumentData(b, a))
  })
})

describe('readingProgress', () => {
  it('is null when there is no reading position', () => {
    expect(readingProgress(null, 10)).toBeNull()
  })

  it('is null when the page count is unknown', () => {
    expect(readingProgress(reading(3, 1), 0)).toBeNull()
  })

  it('counts pages before the position plus the offset within the page', () => {
    expect(readingProgress(reading(4, 1, 0.5), 10)).toBeCloseTo(0.45)
  })

  it('never exceeds 1', () => {
    expect(readingProgress(reading(20, 1, 1), 10)).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/documentData.test.ts`
Expected: FAIL, "Failed to resolve import "./documentData"".

- [ ] **Step 3: Implement `src/shared/documentData.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/documentData.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/documentData.ts src/shared/documentData.test.ts
git commit -m "feat: add Document data model with merge rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Document Fingerprint

**Files:**
- Create: `src/main/fingerprint.ts`
- Test: `src/main/fingerprint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FINGERPRINT_HEAD_BYTES: number`, `fingerprintFromHead(head: Uint8Array, fileSize: number): string`, `computeFingerprint(filePath: string): Promise<string>` (64 lowercase hex chars).

- [ ] **Step 1: Write the failing tests**

`src/main/fingerprint.test.ts`:

```ts
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeFingerprint, FINGERPRINT_HEAD_BYTES, fingerprintFromHead } from './fingerprint'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdfreader-fp-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('fingerprintFromHead', () => {
  it('is 64 lowercase hex characters', () => {
    expect(fingerprintFromHead(new Uint8Array([1, 2, 3]), 3)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('depends on the file size, not only the head bytes', () => {
    const head = new Uint8Array([1, 2, 3])
    expect(fingerprintFromHead(head, 3)).not.toBe(fingerprintFromHead(head, 4))
  })
})

describe('computeFingerprint', () => {
  it('gives the same fingerprint for a renamed or moved copy', async () => {
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'renamed copy.pdf')
    await writeFile(a, 'same pdf bytes')
    await copyFile(a, b)
    expect(await computeFingerprint(b)).toBe(await computeFingerprint(a))
  })

  it('gives different fingerprints for different content', async () => {
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    await writeFile(a, 'content one')
    await writeFile(b, 'content two')
    expect(await computeFingerprint(a)).not.toBe(await computeFingerprint(b))
  })

  it('matches fingerprintFromHead for a small file', async () => {
    const bytes = Buffer.from('small pdf')
    const path = join(dir, 'small.pdf')
    await writeFile(path, bytes)
    expect(await computeFingerprint(path)).toBe(fingerprintFromHead(bytes, bytes.length))
  })

  it('only reads the first 4 MiB: a change after that keeps the fingerprint (accepted trade-off)', async () => {
    const size = FINGERPRINT_HEAD_BYTES + 1024
    const original = Buffer.alloc(size, 1)
    const changedTail = Buffer.from(original)
    changedTail[size - 1] = 2
    const changedHead = Buffer.from(original)
    changedHead[100] = 2
    await writeFile(join(dir, 'o.pdf'), original)
    await writeFile(join(dir, 't.pdf'), changedTail)
    await writeFile(join(dir, 'h.pdf'), changedHead)
    const fp = await computeFingerprint(join(dir, 'o.pdf'))
    expect(await computeFingerprint(join(dir, 't.pdf'))).toBe(fp)
    expect(await computeFingerprint(join(dir, 'h.pdf'))).not.toBe(fp)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/fingerprint.test.ts`
Expected: FAIL, "Failed to resolve import "./fingerprint"".

- [ ] **Step 3: Implement `src/main/fingerprint.ts`**

```ts
import { createHash } from 'crypto'
import { open } from 'fs/promises'

export const FINGERPRINT_HEAD_BYTES = 4 * 1024 * 1024

export function fingerprintFromHead(head: Uint8Array, fileSize: number): string {
  return createHash('sha256').update(`pdfreader-v1:${fileSize}:`).update(head).digest('hex')
}

/** Document Fingerprint: hash of the file size and its first 4 MiB. See docs/adr/0001. */
export async function computeFingerprint(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, FINGERPRINT_HEAD_BYTES)
    const head = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const { bytesRead } = await handle.read(head, offset, length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return fingerprintFromHead(head.subarray(0, offset), size)
  } finally {
    await handle.close()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/fingerprint.ts src/main/fingerprint.test.ts
git commit -m "feat: compute Document Fingerprint from file content

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Data Folder and Document store

**Files:**
- Create: `src/main/dataFolder.ts`, `src/main/documentStore.ts`
- Test: `src/main/dataFolder.test.ts`, `src/main/documentStore.test.ts`

**Interfaces:**
- Consumes: from `src/shared/documentData.ts`: `DocumentData`, `Fingerprint`, `emptyDocumentData`, `mergeDocumentData`, `parseDocumentData`.
- Produces:
  - `resolveDataFolder(env: Record<string, string | undefined>): string`
  - `documentsDir(dataFolder: string): string`
  - `class DocumentStore { constructor(dir: string, now?: () => number); load(fingerprint: Fingerprint): Promise<DocumentData>; update(fingerprint: Fingerprint, mutate: (data: DocumentData) => DocumentData): Promise<DocumentData> }`

Behavior of `DocumentStore`:
- `load` and `update` for the same Fingerprint run one at a time (per-Fingerprint queue), so concurrent updates never lose each other's changes.
- Every load merges all Conflict Copies (`<fp>-*.json`) into the main data. If any were merged, it writes the merged result and deletes those copies.
- A Conflict Copy that cannot be parsed, or has a different fingerprint inside, is left untouched.
- A main file that cannot be parsed is renamed to `<fp>.corrupt-<timestamp>.bak` (never deleted), and loading continues as if it were empty.
- Writes are atomic: write `<fp>.json.<uuid>.tmp`, then rename over `<fp>.json`. Rename retries on `EPERM`/`EBUSY`/`EACCES`, which happen on Windows while OneDrive or antivirus holds the file.

- [ ] **Step 1: Write the failing Data Folder tests**

`src/main/dataFolder.test.ts`:

```ts
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { documentsDir, resolveDataFolder } from './dataFolder'

describe('resolveDataFolder', () => {
  it('uses PDFREADER_DATA_DIR when set', () => {
    expect(resolveDataFolder({ PDFREADER_DATA_DIR: 'X:\\dev-data', OneDrive: 'C:\\OneDrive' })).toBe('X:\\dev-data')
  })

  it('defaults to a folder inside OneDrive', () => {
    expect(resolveDataFolder({ OneDrive: 'C:\\Users\\me\\OneDrive', APPDATA: 'C:\\AppData' })).toBe(
      join('C:\\Users\\me\\OneDrive', 'PdfReaderData')
    )
  })

  it('falls back to APPDATA without OneDrive', () => {
    expect(resolveDataFolder({ APPDATA: 'C:\\AppData' })).toBe(join('C:\\AppData', 'PdfReader'))
  })

  it('throws when nothing is available', () => {
    expect(() => resolveDataFolder({})).toThrow(/data folder/i)
  })
})

describe('documentsDir', () => {
  it('is the documents subfolder', () => {
    expect(documentsDir('D:\\data')).toBe(join('D:\\data', 'documents'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/dataFolder.test.ts`
Expected: FAIL, "Failed to resolve import "./dataFolder"".

- [ ] **Step 3: Implement `src/main/dataFolder.ts`**

```ts
import { join } from 'path'

/** The Data Folder holds all Document data. See docs/adr/0002. */
export function resolveDataFolder(env: Record<string, string | undefined>): string {
  if (env.PDFREADER_DATA_DIR) return env.PDFREADER_DATA_DIR
  if (env.OneDrive) return join(env.OneDrive, 'PdfReaderData')
  if (env.APPDATA) return join(env.APPDATA, 'PdfReader')
  throw new Error('Cannot resolve the data folder: neither OneDrive nor APPDATA is set')
}

export function documentsDir(dataFolder: string): string {
  return join(dataFolder, 'documents')
}
```

- [ ] **Step 4: Run Data Folder tests to verify they pass**

Run: `npx vitest run src/main/dataFolder.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store tests**

`src/main/documentStore.test.ts`:

```ts
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDocumentData, parseDocumentData, type Highlight, type ReadingPosition } from '../shared/documentData'
import { DocumentStore } from './documentStore'

const FP = 'a'.repeat(64)
let dir: string
let store: DocumentStore

function reading(pageIndex: number, updatedAt: number): ReadingPosition {
  return { pageIndex, offsetRatio: 0, zoom: { mode: 'fit-width' }, updatedAt }
}

function highlight(id: string): Highlight {
  return {
    id,
    color: 'yellow',
    note: null,
    text: id,
    parts: [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] }],
    createdAt: 1,
    updatedAt: 1
  }
}

async function readMain() {
  return parseDocumentData(JSON.parse(await readFile(join(dir, `${FP}.json`), 'utf8')))
}

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'pdfreader-store-')), 'documents')
  store = new DocumentStore(dir, () => 12345)
})

afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true })
})

describe('DocumentStore', () => {
  it('returns empty data for an unknown Document without writing a file', async () => {
    expect(await store.load(FP)).toEqual(emptyDocumentData(FP))
    expect(await readdir(dir)).toEqual([])
  })

  it('persists updates', async () => {
    await store.update(FP, (d) => ({ ...d, pageCount: 10, reading: reading(3, 100) }))
    expect((await store.load(FP)).reading).toEqual(reading(3, 100))
    expect((await readMain()).pageCount).toBe(10)
  })

  it('leaves no temp files after writing', async () => {
    await store.update(FP, (d) => ({ ...d, pageCount: 1 }))
    expect(await readdir(dir)).toEqual([`${FP}.json`])
  })

  it('serializes concurrent updates to the same Document', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.update(FP, (d) => ({ ...d, highlights: [...d.highlights, highlight(`h${i}`)] }))
      )
    )
    expect((await store.load(FP)).highlights).toHaveLength(10)
  })

  it('merges a OneDrive Conflict Copy, saves the result, and deletes the copy', async () => {
    await store.update(FP, (d) => ({ ...d, reading: reading(3, 1000) }))
    const copy = { ...emptyDocumentData(FP), reading: reading(9, 2000), highlights: [highlight('from-laptop')] }
    await writeFile(join(dir, `${FP}-LAPTOP.json`), JSON.stringify(copy))

    const loaded = await store.load(FP)

    expect(loaded.reading).toEqual(reading(9, 2000))
    expect(loaded.highlights.map((h) => h.id)).toEqual(['from-laptop'])
    expect(await readdir(dir)).toEqual([`${FP}.json`])
    expect((await readMain()).reading).toEqual(reading(9, 2000))
  })

  it('merges a Conflict Copy even when the main file is missing', async () => {
    const copy = { ...emptyDocumentData(FP), reading: reading(4, 1) }
    await store.update(FP, (d) => d)
    await rm(join(dir, `${FP}.json`))
    await writeFile(join(dir, `${FP}-PC-2.json`), JSON.stringify(copy))
    expect((await store.load(FP)).reading).toEqual(reading(4, 1))
  })

  it('leaves an unreadable Conflict Copy in place', async () => {
    await store.update(FP, (d) => ({ ...d, pageCount: 2 }))
    await writeFile(join(dir, `${FP}-LAPTOP.json`), '{ half synced')
    expect((await store.load(FP)).pageCount).toBe(2)
    expect((await readdir(dir)).sort()).toEqual([`${FP}-LAPTOP.json`, `${FP}.json`])
  })

  it('backs up a corrupt main file instead of deleting it', async () => {
    await store.update(FP, (d) => d)
    await writeFile(join(dir, `${FP}.json`), '{ oops')
    expect(await store.load(FP)).toEqual(emptyDocumentData(FP))
    expect(await readdir(dir)).toEqual([`${FP}.corrupt-12345.bak`])
  })

  it('does not touch other Documents', async () => {
    const other = 'b'.repeat(64)
    await store.update(other, (d) => ({ ...d, pageCount: 7 }))
    await store.update(FP, (d) => ({ ...d, pageCount: 3 }))
    expect((await store.load(other)).pageCount).toBe(7)
  })
})
```

- [ ] **Step 6: Run store tests to verify they fail**

Run: `npx vitest run src/main/documentStore.test.ts`
Expected: FAIL, "Failed to resolve import "./documentStore"".

- [ ] **Step 7: Implement `src/main/documentStore.ts`**

```ts
import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  emptyDocumentData,
  mergeDocumentData,
  parseDocumentData,
  type DocumentData,
  type Fingerprint
} from '../shared/documentData'

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** One JSON file per Document in the Data Folder. See docs/adr/0002. */
export class DocumentStore {
  private readonly queues = new Map<Fingerprint, Promise<unknown>>()

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now
  ) {}

  load(fingerprint: Fingerprint): Promise<DocumentData> {
    return this.enqueue(fingerprint, () => this.loadUnlocked(fingerprint))
  }

  update(fingerprint: Fingerprint, mutate: (data: DocumentData) => DocumentData): Promise<DocumentData> {
    return this.enqueue(fingerprint, async () => {
      const next = mutate(await this.loadUnlocked(fingerprint))
      await this.writeAtomic(fingerprint, next)
      return next
    })
  }

  private enqueue<T>(fingerprint: Fingerprint, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(fingerprint) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.catch(() => undefined)
    this.queues.set(fingerprint, tail)
    void tail.then(() => {
      if (this.queues.get(fingerprint) === tail) this.queues.delete(fingerprint)
    })
    return run
  }

  private mainPath(fingerprint: Fingerprint): string {
    return join(this.dir, `${fingerprint}.json`)
  }

  private async loadUnlocked(fingerprint: Fingerprint): Promise<DocumentData> {
    await mkdir(this.dir, { recursive: true })
    let data = emptyDocumentData(fingerprint)

    const mainPath = this.mainPath(fingerprint)
    const main = await readIfExists(mainPath)
    if (main !== null) {
      try {
        data = parseDocumentData(JSON.parse(main))
      } catch {
        await rename(mainPath, join(this.dir, `${fingerprint}.corrupt-${this.now()}.bak`))
      }
    }

    const mergedCopies: string[] = []
    for (const name of await readdir(this.dir)) {
      if (!name.startsWith(`${fingerprint}-`) || !name.endsWith('.json')) continue
      const copyPath = join(this.dir, name)
      try {
        const copy = parseDocumentData(JSON.parse(await readFile(copyPath, 'utf8')))
        if (copy.fingerprint !== fingerprint) continue
        data = mergeDocumentData(data, copy)
        mergedCopies.push(copyPath)
      } catch {
        // Unreadable or half-synced Conflict Copy: leave it for a later load.
      }
    }

    if (mergedCopies.length > 0) {
      await this.writeAtomic(fingerprint, data)
      for (const copyPath of mergedCopies) await unlink(copyPath)
    }
    return data
  }

  private async writeAtomic(fingerprint: Fingerprint, data: DocumentData): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tempPath = join(this.dir, `${fingerprint}.json.${randomUUID()}.tmp`)
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
    try {
      await renameWithRetry(tempPath, this.mainPath(fingerprint))
    } catch (err) {
      await unlink(tempPath).catch(() => undefined)
      throw err
    }
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (attempt >= attempts || !RETRYABLE_RENAME_CODES.has(code)) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
    }
  }
}
```

- [ ] **Step 8: Run store tests to verify they pass**

Run: `npx vitest run src/main/documentStore.test.ts src/main/dataFolder.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and full test run**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/main/dataFolder.ts src/main/dataFolder.test.ts src/main/documentStore.ts src/main/documentStore.test.ts
git commit -m "feat: store Document data as JSON with Conflict Copy merging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Debounced Reading Position saver

**Files:**
- Create: `src/main/positionSaver.ts`
- Test: `src/main/positionSaver.test.ts`

**Interfaces:**
- Consumes: `Fingerprint`, `ReadingPosition` from `src/shared/documentData.ts`.
- Produces:
  - `interface PendingPosition { reading: ReadingPosition; pageCount: number }`
  - `class PositionSaver { constructor(write: (fingerprint: Fingerprint, position: PendingPosition) => Promise<void>, delayMs?: number /* default 3000 */); report(fingerprint, position): void; flush(fingerprint): Promise<void>; flushAll(): Promise<void>; hasPending(): boolean }`

- [ ] **Step 1: Write the failing tests**

`src/main/positionSaver.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PositionSaver, type PendingPosition } from './positionSaver'

function position(pageIndex: number): PendingPosition {
  return { pageCount: 10, reading: { pageIndex, offsetRatio: 0, zoom: { mode: 'fit-width' }, updatedAt: pageIndex } }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PositionSaver', () => {
  it('writes the latest position 3 s after the last report', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    await vi.advanceTimersByTimeAsync(2000)
    saver.report('fp', position(2))
    await vi.advanceTimersByTimeAsync(2999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('fp', position(2))
  })

  it('debounces each Document separately', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('a', position(1))
    saver.report('b', position(2))
    await vi.advanceTimersByTimeAsync(3000)
    expect(write).toHaveBeenCalledWith('a', position(1))
    expect(write).toHaveBeenCalledWith('b', position(2))
  })

  it('flush writes immediately and cancels the timer', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('fp', position(5))
    await saver.flush('fp')
    expect(write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when nothing is pending', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await new PositionSaver(write).flush('fp')
    expect(write).not.toHaveBeenCalled()
  })

  it('flushAll writes every pending Document and clears hasPending', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('a', position(1))
    saver.report('b', position(2))
    expect(saver.hasPending()).toBe(true)
    await saver.flushAll()
    expect(write).toHaveBeenCalledTimes(2)
    expect(saver.hasPending()).toBe(false)
  })

  it('logs instead of throwing when a timed write fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const saver = new PositionSaver(vi.fn().mockRejectedValue(new Error('disk full')))
    saver.report('fp', position(1))
    await vi.advanceTimersByTimeAsync(3000)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/positionSaver.test.ts`
Expected: FAIL, "Failed to resolve import "./positionSaver"".

- [ ] **Step 3: Implement `src/main/positionSaver.ts`**

```ts
import type { Fingerprint, ReadingPosition } from '../shared/documentData'

export interface PendingPosition {
  reading: ReadingPosition
  pageCount: number
}

/** Batches Reading Position writes so OneDrive does not upload on every scroll. */
export class PositionSaver {
  private readonly pending = new Map<Fingerprint, PendingPosition>()
  private readonly timers = new Map<Fingerprint, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly write: (fingerprint: Fingerprint, position: PendingPosition) => Promise<void>,
    private readonly delayMs = 3000
  ) {}

  report(fingerprint: Fingerprint, position: PendingPosition): void {
    this.pending.set(fingerprint, position)
    const existing = this.timers.get(fingerprint)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.set(
      fingerprint,
      setTimeout(() => {
        this.flush(fingerprint).catch((err) => console.error('Failed to save reading position', err))
      }, this.delayMs)
    )
  }

  async flush(fingerprint: Fingerprint): Promise<void> {
    const timer = this.timers.get(fingerprint)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(fingerprint)
    const position = this.pending.get(fingerprint)
    if (!position) return
    this.pending.delete(fingerprint)
    await this.write(fingerprint, position)
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((fingerprint) => this.flush(fingerprint)))
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/positionSaver.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/positionSaver.ts src/main/positionSaver.test.ts
git commit -m "feat: debounce Reading Position writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Recent Documents and launch arguments

**Files:**
- Create: `src/main/recent.ts`, `src/main/argv.ts`
- Test: `src/main/recent.test.ts`, `src/main/argv.test.ts`

**Interfaces:**
- Consumes: `Fingerprint` from `src/shared/documentData.ts`.
- Produces:
  - `interface RecentEntry { fingerprint: Fingerprint; path: string; openedAt: number }`
  - `MAX_RECENT = 20`
  - `addRecent(list: RecentEntry[], entry: RecentEntry, max?: number): RecentEntry[]`
  - `class RecentStore { constructor(filePath: string); list(): Promise<RecentEntry[]>; add(entry: RecentEntry): Promise<void> }`
  - `findPdfArg(argv: readonly string[]): string | null`

- [ ] **Step 1: Write the failing tests**

`src/main/recent.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addRecent, RecentStore, type RecentEntry } from './recent'

function entry(fingerprint: string, path: string, openedAt = 1): RecentEntry {
  return { fingerprint, path, openedAt }
}

describe('addRecent', () => {
  it('puts the new entry first', () => {
    expect(addRecent([entry('a', 'C:\\a.pdf')], entry('b', 'C:\\b.pdf'))).toEqual([
      entry('b', 'C:\\b.pdf'),
      entry('a', 'C:\\a.pdf')
    ])
  })

  it('replaces an entry for the same Document opened from a new path', () => {
    expect(addRecent([entry('a', 'C:\\old\\a.pdf')], entry('a', 'D:\\new\\a.pdf', 2))).toEqual([
      entry('a', 'D:\\new\\a.pdf', 2)
    ])
  })

  it('replaces an entry for the same path, ignoring case', () => {
    expect(addRecent([entry('old-fp', 'C:\\Books\\A.pdf')], entry('new-fp', 'c:\\books\\a.pdf'))).toEqual([
      entry('new-fp', 'c:\\books\\a.pdf')
    ])
  })

  it('keeps at most max entries', () => {
    const list = Array.from({ length: 5 }, (_, i) => entry(`fp${i}`, `C:\\${i}.pdf`))
    expect(addRecent(list, entry('new', 'C:\\new.pdf'), 3).map((e) => e.fingerprint)).toEqual(['new', 'fp0', 'fp1'])
  })
})

describe('RecentStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfreader-recent-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is empty when the file does not exist', async () => {
    expect(await new RecentStore(join(dir, 'recent.json')).list()).toEqual([])
  })

  it('is empty when the file is corrupt', async () => {
    await writeFile(join(dir, 'recent.json'), 'not json')
    expect(await new RecentStore(join(dir, 'recent.json')).list()).toEqual([])
  })

  it('persists added entries', async () => {
    const path = join(dir, 'recent.json')
    await new RecentStore(path).add(entry('a', 'C:\\a.pdf'))
    await new RecentStore(path).add(entry('b', 'C:\\b.pdf'))
    expect((await new RecentStore(path).list()).map((e) => e.fingerprint)).toEqual(['b', 'a'])
  })

  it('drops malformed entries', async () => {
    await writeFile(join(dir, 'recent.json'), JSON.stringify([entry('a', 'C:\\a.pdf'), { path: 3 }]))
    expect(await new RecentStore(join(dir, 'recent.json')).list()).toEqual([entry('a', 'C:\\a.pdf')])
  })
})
```

`src/main/argv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findPdfArg } from './argv'

describe('findPdfArg', () => {
  it('finds a PDF path passed by Explorer', () => {
    expect(findPdfArg(['C:\\App\\PdfReader.exe', 'D:\\Books\\A Book.PDF'])).toBe('D:\\Books\\A Book.PDF')
  })

  it('ignores Chromium flags', () => {
    expect(findPdfArg(['app.exe', '--allow-file-access-from-files', 'D:\\a.pdf'])).toBe('D:\\a.pdf')
  })

  it('returns null when no PDF is given', () => {
    expect(findPdfArg(['electron.exe', '.'])).toBeNull()
  })

  it('never treats the executable itself as a document', () => {
    expect(findPdfArg(['weird.pdf'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/recent.test.ts src/main/argv.test.ts`
Expected: FAIL, "Failed to resolve import".

- [ ] **Step 3: Implement `src/main/recent.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { Fingerprint } from '../shared/documentData'

export interface RecentEntry {
  fingerprint: Fingerprint
  path: string
  openedAt: number
}

export const MAX_RECENT = 20

export function addRecent(list: RecentEntry[], entry: RecentEntry, max = MAX_RECENT): RecentEntry[] {
  const path = entry.path.toLowerCase()
  const rest = list.filter((e) => e.fingerprint !== entry.fingerprint && e.path.toLowerCase() !== path)
  return [entry, ...rest].slice(0, max)
}

function isRecentEntry(value: unknown): value is RecentEntry {
  const v = value as RecentEntry
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fingerprint === 'string' &&
    typeof v.path === 'string' &&
    typeof v.openedAt === 'number'
  )
}

/** Recent Documents for this machine only; paths differ between machines. */
export class RecentStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<RecentEntry[]> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      return Array.isArray(raw) ? raw.filter(isRecentEntry) : []
    } catch {
      return []
    }
  }

  async add(entry: RecentEntry): Promise<void> {
    const next = addRecent(await this.list(), entry)
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}
```

- [ ] **Step 4: Implement `src/main/argv.ts`**

```ts
/** Returns the PDF path Windows passes when the user opens a .pdf with this app. */
export function findPdfArg(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (!arg.startsWith('-') && arg.toLowerCase().endsWith('.pdf')) return arg
  }
  return null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/recent.test.ts src/main/argv.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/recent.ts src/main/recent.test.ts src/main/argv.ts src/main/argv.test.ts
git commit -m "feat: add Recent Documents list and PDF launch argument parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Main process wiring, IPC, preload

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/strings.ts`, `src/main/windows.ts`
- Replace: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 2–6.
- Produces:
  - `src/shared/ipc.ts`: `IPC` channel name constants; `type DocumentContext = { kind: 'document'; path: string; fileName: string; fingerprint: Fingerprint }`; `type WindowContext = { kind: 'home' } | DocumentContext`; `interface RecentView { fingerprint; path; fileName; openedAt; exists: boolean; progress: number | null }`; `type OpenResult = { ok: true } | { ok: false; reason: 'missing' | 'not-pdf' | 'error'; message?: string }`; `interface PdfReaderApi` (below).
  - `window.api: PdfReaderApi` in the renderer:
    - `getContext(): Promise<WindowContext>`
    - `readDocumentBytes(): Promise<Uint8Array>`
    - `loadDocumentData(): Promise<DocumentData>`
    - `reportReadingPosition(reading: ReadingPosition, pageCount: number): void`
    - `openFileDialog(): Promise<void>`
    - `openPath(path: string): Promise<OpenResult>`
    - `listRecent(): Promise<RecentView[]>`
  - `src/shared/strings.ts`: `t` object with all UI strings (used by main and renderer).

This task has no unit tests: it is glue around Electron APIs. Its logic is already covered by Tasks 2–6. Verification is manual (Step 9).

- [ ] **Step 1: Create `src/shared/ipc.ts`**

```ts
import type { DocumentData, Fingerprint, ReadingPosition } from './documentData'

export const IPC = {
  getContext: 'window:get-context',
  readDocumentBytes: 'document:read-bytes',
  loadDocumentData: 'document:load-data',
  reportReadingPosition: 'document:report-reading-position',
  openFileDialog: 'app:open-file-dialog',
  openPath: 'app:open-path',
  listRecent: 'app:list-recent'
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
  openFileDialog(): Promise<void>
  openPath(path: string): Promise<OpenResult>
  listRecent(): Promise<RecentView[]>
}
```

- [ ] **Step 2: Create `src/shared/strings.ts`**

```ts
import type { OpenResult } from './ipc'

export const t = {
  appName: 'PdfReader',
  menu: {
    file: 'Tệp',
    open: 'Mở PDF…',
    recent: 'Tài liệu gần đây',
    quit: 'Thoát',
    view: 'Xem'
  },
  dialog: {
    openTitle: 'Mở PDF',
    pdfFilter: 'Tài liệu PDF',
    openFailedTitle: 'Không mở được file'
  },
  openError(path: string, result: Extract<OpenResult, { ok: false }>): string {
    if (result.reason === 'missing') return `Không tìm thấy file:\n${path}`
    if (result.reason === 'not-pdf') return `File không phải PDF:\n${path}`
    return `Lỗi khi mở file:\n${path}\n\n${result.message ?? ''}`
  },
  home: {
    title: 'Tài liệu gần đây',
    open: 'Mở PDF…',
    empty: 'Chưa mở tài liệu nào. Bấm "Mở PDF…" hoặc Ctrl+O.',
    missing: 'Không tìm thấy file',
    notStarted: 'Chưa đọc'
  },
  reader: {
    loading: 'Đang tải…',
    loadFailed: 'Không đọc được file PDF.',
    page: (current: number, total: number) => `Trang ${current} / ${total}`,
    zoomIn: 'Phóng to (Ctrl +)',
    zoomOut: 'Thu nhỏ (Ctrl -)',
    fitWidth: 'Vừa chiều ngang',
    fitPage: 'Vừa trang'
  }
}
```

- [ ] **Step 3: Create `src/main/windows.ts`**

```ts
import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { DocumentContext, WindowContext } from '../shared/ipc'
import { t } from '../shared/strings'

export interface DocumentWindowHooks {
  onBlur(): void
  onClosed(): void
}

/** The home window plus one window per Document. */
export class AppWindows {
  private readonly contexts = new Map<number, WindowContext>()
  private readonly documentWindows = new Map<string, BrowserWindow>()
  private home: BrowserWindow | null = null

  contextFor(webContentsId: number): WindowContext | undefined {
    return this.contexts.get(webContentsId)
  }

  showHome(): void {
    if (this.home && !this.home.isDestroyed()) {
      focus(this.home)
      return
    }
    this.home = this.create({ kind: 'home' }, t.appName)
    this.home.on('closed', () => {
      this.home = null
    })
  }

  /** Focuses the window already showing this Document. Returns false if there is none. */
  focusDocument(fingerprint: string): boolean {
    const win = this.documentWindows.get(fingerprint)
    if (!win || win.isDestroyed()) return false
    focus(win)
    return true
  }

  openDocument(context: DocumentContext, hooks: DocumentWindowHooks): void {
    const win = this.create(context, `${context.fileName} - ${t.appName}`)
    this.documentWindows.set(context.fingerprint, win)
    win.on('blur', hooks.onBlur)
    win.on('closed', () => {
      this.documentWindows.delete(context.fingerprint)
      hooks.onClosed()
    })
  }

  private create(context: WindowContext, title: string): BrowserWindow {
    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      title,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true
      }
    })
    const id = win.webContents.id
    this.contexts.set(id, context)
    win.on('closed', () => this.contexts.delete(id))
    win.on('page-title-updated', (event) => event.preventDefault())
    win.once('ready-to-show', () => win.show())
    if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
    return win
  }
}

function focus(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.focus()
}
```

- [ ] **Step 4: Replace `src/main/index.ts`**

```ts
import { app, dialog, ipcMain, Menu, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { access, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { readingProgress, type ReadingPosition } from '../shared/documentData'
import { IPC, type DocumentContext, type OpenResult, type RecentView } from '../shared/ipc'
import { t } from '../shared/strings'
import { findPdfArg } from './argv'
import { documentsDir, resolveDataFolder } from './dataFolder'
import { DocumentStore } from './documentStore'
import { computeFingerprint } from './fingerprint'
import { PositionSaver } from './positionSaver'
import { RecentStore } from './recent'
import { AppWindows } from './windows'

const windows = new AppWindows()
const store = new DocumentStore(documentsDir(resolveDataFolder(process.env)))
const recent = new RecentStore(join(app.getPath('userData'), 'recent.json'))
const saver = new PositionSaver(async (fingerprint, { reading, pageCount }) => {
  await store.update(fingerprint, (data) => ({ ...data, pageCount, reading }))
})

function logSaveError(err: unknown): void {
  console.error('Failed to save reading position', err)
}

async function openPath(path: string): Promise<OpenResult> {
  if (!path.toLowerCase().endsWith('.pdf')) return { ok: false, reason: 'not-pdf' }
  try {
    await access(path)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    const fingerprint = await computeFingerprint(path)
    await recent.add({ fingerprint, path, openedAt: Date.now() })
    if (!windows.focusDocument(fingerprint)) {
      windows.openDocument(
        { kind: 'document', path, fileName: basename(path), fingerprint },
        {
          onBlur: () => void saver.flush(fingerprint).catch(logSaveError),
          onClosed: () => void saver.flush(fingerprint).catch(logSaveError)
        }
      )
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

async function openAndReport(path: string): Promise<boolean> {
  const result = await openPath(path)
  if (!result.ok) dialog.showErrorBox(t.dialog.openFailedTitle, t.openError(path, result))
  return result.ok
}

async function showOpenDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: t.dialog.openTitle,
    filters: [{ name: t.dialog.pdfFilter, extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })
  for (const path of result.filePaths) await openAndReport(path)
}

async function listRecentViews(): Promise<RecentView[]> {
  const entries = await recent.list()
  return Promise.all(
    entries.map(async (entry) => {
      const exists = await access(entry.path).then(
        () => true,
        () => false
      )
      const data = await store.load(entry.fingerprint)
      return {
        ...entry,
        fileName: basename(entry.path),
        exists,
        progress: readingProgress(data.reading, data.pageCount)
      }
    })
  )
}

function documentOf(event: IpcMainEvent | IpcMainInvokeEvent): DocumentContext | null {
  const context = windows.contextFor(event.sender.id)
  return context?.kind === 'document' ? context : null
}

function requireDocument(event: IpcMainInvokeEvent): DocumentContext {
  const context = documentOf(event)
  if (!context) throw new Error('This window has no document')
  return context
}

function registerIpc(): void {
  ipcMain.handle(IPC.getContext, (event) => windows.contextFor(event.sender.id) ?? { kind: 'home' })
  ipcMain.handle(IPC.readDocumentBytes, (event) => readFile(requireDocument(event).path))
  ipcMain.handle(IPC.loadDocumentData, (event) => store.load(requireDocument(event).fingerprint))
  ipcMain.on(IPC.reportReadingPosition, (event, reading: ReadingPosition, pageCount: number) => {
    const context = documentOf(event)
    if (context) saver.report(context.fingerprint, { reading, pageCount })
  })
  ipcMain.handle(IPC.openFileDialog, () => showOpenDialog())
  ipcMain.handle(IPC.openPath, (_event, path: string) => openPath(path))
  ipcMain.handle(IPC.listRecent, () => listRecentViews())
}

function setMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: t.menu.file,
        submenu: [
          { label: t.menu.open, accelerator: 'CmdOrCtrl+O', click: () => void showOpenDialog() },
          { label: t.menu.recent, accelerator: 'CmdOrCtrl+H', click: () => windows.showHome() },
          { type: 'separator' },
          { label: t.menu.quit, role: 'quit' }
        ]
      },
      {
        label: t.menu.view,
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }]
      }
    ])
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const path = findPdfArg(argv)
    if (path) void openAndReport(path)
    else windows.showHome()
  })

  app.whenReady().then(async () => {
    registerIpc()
    setMenu()
    const path = findPdfArg(process.argv)
    if (!path || !(await openAndReport(path))) windows.showHome()
  })

  app.on('window-all-closed', () => app.quit())

  app.on('will-quit', (event) => {
    if (!saver.hasPending()) return
    event.preventDefault()
    void saver
      .flushAll()
      .catch(logSaveError)
      .finally(() => app.quit())
  })
}
```

- [ ] **Step 5: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PdfReaderApi } from '../shared/ipc'

const api: PdfReaderApi = {
  getContext: () => ipcRenderer.invoke(IPC.getContext),
  readDocumentBytes: () => ipcRenderer.invoke(IPC.readDocumentBytes),
  loadDocumentData: () => ipcRenderer.invoke(IPC.loadDocumentData),
  reportReadingPosition: (reading, pageCount) => ipcRenderer.send(IPC.reportReadingPosition, reading, pageCount),
  openFileDialog: () => ipcRenderer.invoke(IPC.openFileDialog),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  listRecent: () => ipcRenderer.invoke(IPC.listRecent)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 6: Replace `src/renderer/src/env.d.ts`**

```ts
/// <reference types="vite/client" />
import type { PdfReaderApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: PdfReaderApi
  }
}

export {}
```

- [ ] **Step 7: Replace `src/renderer/src/App.tsx` with a temporary context probe**

Tasks 9 and 10 replace this file.

```tsx
import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])
  return <pre>{JSON.stringify(context, null, 2)}</pre>
}
```

- [ ] **Step 8: Typecheck and tests**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 9: Manual verification**

Use a throwaway Data Folder so you do not write into the real OneDrive. In PowerShell:

```powershell
$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run dev
```

Check each item:
1. A window titled "PdfReader" shows `{ "kind": "home" }`.
2. Ctrl+O opens a file dialog filtered to PDF. Pick any PDF. A new window titled `<file name> - PdfReader` shows `kind: "document"` and a 64-character `fingerprint`.
3. Ctrl+O and pick the same PDF again. No new window opens; the existing Document window gets focus.
4. The menu "Tệp" contains "Mở PDF…", "Tài liệu gần đây", "Thoát". "Tài liệu gần đây" (Ctrl+H) focuses or reopens the home window.
5. `%APPDATA%\pdf-reader\recent.json` contains the opened file. (Electron names the userData folder after `name` in `package.json`.)
6. Close all windows. The process exits.

- [ ] **Step 10: Commit**

```bash
git add src/shared/ipc.ts src/shared/strings.ts src/main/windows.ts src/main/index.ts src/preload/index.ts src/renderer/src/App.tsx src/renderer/src/env.d.ts
git commit -m "feat: wire main process, IPC and one window per Document

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Reader layout math and throttle

**Files:**
- Create: `src/renderer/src/reader/layout.ts`, `src/renderer/src/reader/throttle.ts`
- Test: `src/renderer/src/reader/layout.test.ts`, `src/renderer/src/reader/throttle.test.ts`

**Interfaces:**
- Consumes: `ZoomSetting` from `src/shared/documentData.ts`.
- Produces (from `layout.ts`):
  - `PAGE_GAP = 12`, `VIEW_PADDING = 16`, `MIN_SCALE = 0.1`, `MAX_SCALE = 5`, `ZOOM_STEPS: number[]`
  - `interface PageSize { width: number; height: number }` (PDF units at scale 1)
  - `interface PageBox { top: number; width: number; height: number }` (CSS px)
  - `interface PagePosition { pageIndex: number; offsetRatio: number }`
  - `computeScale(zoom: ZoomSetting, viewport: { width: number; height: number }, pages: PageSize[]): number`
  - `layoutPages(pages: PageSize[], scale: number): PageBox[]`
  - `totalHeight(boxes: PageBox[]): number`
  - `contentWidth(boxes: PageBox[]): number`
  - `positionFromScroll(scrollTop: number, boxes: PageBox[]): PagePosition`
  - `scrollTopForPosition(position: PagePosition, boxes: PageBox[]): number`
  - `currentPageIndex(scrollTop: number, viewportHeight: number, boxes: PageBox[]): number`
  - `visiblePageRange(scrollTop: number, viewportHeight: number, boxes: PageBox[], overscan?: number): { first: number; last: number }`
  - `stepZoom(currentScale: number, direction: 1 | -1): ZoomSetting`
- Produces (from `throttle.ts`): `interface Throttled<T> { call(value: T): void; flush(): void; cancel(): void }`, `createThrottle<T>(fn: (value: T) => void, intervalMs: number): Throttled<T>`.

Reading Position is stored as page + ratio within that page, not raw pixels, so it survives zoom and window size changes.

- [ ] **Step 1: Write the failing layout tests**

`src/renderer/src/reader/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
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
  type PageSize
} from './layout'

// Two pages: 100x200 and 100x100 PDF units.
const PAGES: PageSize[] = [
  { width: 100, height: 200 },
  { width: 100, height: 100 }
]
// At scale 2: page 0 top 16, height 400; page 1 top 16 + 400 + 12 = 428, height 200.
const BOXES = layoutPages(PAGES, 2)

describe('layoutPages', () => {
  it('stacks pages with padding and gaps', () => {
    expect(BOXES).toEqual([
      { top: 16, width: 200, height: 400 },
      { top: 428, width: 200, height: 200 }
    ])
  })

  it('reports total height and content width including padding', () => {
    expect(totalHeight(BOXES)).toBe(644)
    expect(contentWidth(BOXES)).toBe(232)
  })

  it('handles an empty Document', () => {
    expect(totalHeight([])).toBe(0)
    expect(contentWidth([])).toBe(0)
  })
})

describe('computeScale', () => {
  it('uses the percentage directly', () => {
    expect(computeScale({ mode: 'percent', value: 150 }, { width: 500, height: 500 }, PAGES)).toBe(1.5)
  })

  it('fits the widest page to the viewport width minus padding', () => {
    expect(computeScale({ mode: 'fit-width' }, { width: 432, height: 232 }, PAGES)).toBe(4)
  })

  it('fits the tallest page entirely for fit-page', () => {
    expect(computeScale({ mode: 'fit-page' }, { width: 432, height: 232 }, PAGES)).toBe(1)
  })

  it('clamps to the allowed range', () => {
    expect(computeScale({ mode: 'percent', value: 1000 }, { width: 1, height: 1 }, PAGES)).toBe(5)
    expect(computeScale({ mode: 'fit-width' }, { width: 0, height: 0 }, PAGES)).toBe(0.1)
  })

  it('is 1 for an empty Document', () => {
    expect(computeScale({ mode: 'fit-width' }, { width: 500, height: 500 }, [])).toBe(1)
  })
})

describe('positionFromScroll', () => {
  it('is the start of page 0 above the first page', () => {
    expect(positionFromScroll(0, BOXES)).toEqual({ pageIndex: 0, offsetRatio: 0 })
  })

  it('finds the page and ratio at the top of the viewport', () => {
    expect(positionFromScroll(216, BOXES)).toEqual({ pageIndex: 0, offsetRatio: 0.5 })
    expect(positionFromScroll(528, BOXES)).toEqual({ pageIndex: 1, offsetRatio: 0.5 })
  })

  it('treats the gap after a page as the end of that page', () => {
    expect(positionFromScroll(420, BOXES)).toEqual({ pageIndex: 0, offsetRatio: 1 })
  })

  it('is page 0 for an empty Document', () => {
    expect(positionFromScroll(100, [])).toEqual({ pageIndex: 0, offsetRatio: 0 })
  })
})

describe('scrollTopForPosition', () => {
  it('is the inverse of positionFromScroll', () => {
    expect(scrollTopForPosition({ pageIndex: 1, offsetRatio: 0.5 }, BOXES)).toBe(528)
  })

  it('clamps a page index beyond the Document', () => {
    expect(scrollTopForPosition({ pageIndex: 9, offsetRatio: 0 }, BOXES)).toBe(428)
  })

  it('keeps the same position across zoom levels', () => {
    const position = { pageIndex: 1, offsetRatio: 0.25 }
    const atScale1 = layoutPages(PAGES, 1)
    expect(positionFromScroll(scrollTopForPosition(position, atScale1), atScale1)).toEqual(position)
    expect(positionFromScroll(scrollTopForPosition(position, BOXES), BOXES)).toEqual(position)
  })
})

describe('currentPageIndex', () => {
  it('uses the point a quarter down the viewport', () => {
    expect(currentPageIndex(0, 400, BOXES)).toBe(0)
    expect(currentPageIndex(300, 600, BOXES)).toBe(1)
  })
})

describe('visiblePageRange', () => {
  it('covers pages intersecting the viewport', () => {
    expect(visiblePageRange(0, 300, BOXES, 0)).toEqual({ first: 0, last: 0 })
    expect(visiblePageRange(0, 500, BOXES, 0)).toEqual({ first: 0, last: 1 })
    expect(visiblePageRange(500, 100, BOXES, 0)).toEqual({ first: 1, last: 1 })
  })

  it('adds overscan pages within bounds', () => {
    expect(visiblePageRange(0, 300, BOXES, 1)).toEqual({ first: 0, last: 1 })
  })

  it('is empty for an empty Document', () => {
    expect(visiblePageRange(0, 300, [], 1)).toEqual({ first: 0, last: -1 })
  })
})

describe('stepZoom', () => {
  it('moves to the next zoom step', () => {
    expect(stepZoom(1, 1)).toEqual({ mode: 'percent', value: 110 })
    expect(stepZoom(1, -1)).toEqual({ mode: 'percent', value: 90 })
  })

  it('snaps a fit scale to the nearest step in the direction', () => {
    expect(stepZoom(1.33, 1)).toEqual({ mode: 'percent', value: 150 })
    expect(stepZoom(1.33, -1)).toEqual({ mode: 'percent', value: 125 })
  })

  it('stops at the ends', () => {
    expect(stepZoom(4, 1)).toEqual({ mode: 'percent', value: 400 })
    expect(stepZoom(0.25, -1)).toEqual({ mode: 'percent', value: 25 })
  })
})
```

- [ ] **Step 2: Write the failing throttle tests**

`src/renderer/src/reader/throttle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from './throttle'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createThrottle', () => {
  it('delivers only the latest value once per interval', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(1)
    throttled.call(2)
    throttled.call(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })

  it('starts a new interval after delivering', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(1)
    vi.advanceTimersByTime(500)
    throttled.call(2)
    vi.advanceTimersByTime(500)
    expect(fn.mock.calls).toEqual([[1], [2]])
  })

  it('flush delivers the pending value immediately', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(7)
    throttled.flush()
    expect(fn).toHaveBeenCalledWith(7)
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when nothing is pending', () => {
    const fn = vi.fn()
    createThrottle(fn, 500).flush()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel drops the pending value', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(1)
    throttled.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/reader`
Expected: FAIL, "Failed to resolve import".

- [ ] **Step 4: Implement `src/renderer/src/reader/layout.ts`**

```ts
import type { ZoomSetting } from '../../../shared/documentData'

export const PAGE_GAP = 12
export const VIEW_PADDING = 16
export const MIN_SCALE = 0.1
export const MAX_SCALE = 5
export const ZOOM_STEPS = [25, 50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400]

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

export function stepZoom(currentScale: number, direction: 1 | -1): ZoomSetting {
  const current = currentScale * 100
  if (direction === 1) {
    const next = ZOOM_STEPS.find((step) => step > current + 0.5)
    return { mode: 'percent', value: next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1] }
  }
  const previous = [...ZOOM_STEPS].reverse().find((step) => step < current - 0.5)
  return { mode: 'percent', value: previous ?? ZOOM_STEPS[0] }
}
```

- [ ] **Step 5: Implement `src/renderer/src/reader/throttle.ts`**

```ts
export interface Throttled<T> {
  call(value: T): void
  flush(): void
  cancel(): void
}

/** Delivers at most one value per interval: the latest one, at the end of the interval. */
export function createThrottle<T>(fn: (value: T) => void, intervalMs: number): Throttled<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const fire = () => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    fn(value)
  }

  return {
    call(value) {
      pending = { value }
      if (timer === null) timer = setTimeout(fire, intervalMs)
    },
    flush() {
      if (timer !== null) clearTimeout(timer)
      fire()
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/reader`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/reader/layout.ts src/renderer/src/reader/layout.test.ts src/renderer/src/reader/throttle.ts src/renderer/src/reader/throttle.test.ts
git commit -m "feat: add reader layout math and trailing throttle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Reader view with Reading Position restore

**Files:**
- Create: `src/renderer/src/reader/pdf.ts`, `src/renderer/src/reader/PdfPage.tsx`, `src/renderer/src/reader/ReaderView.tsx`
- Modify: `src/renderer/src/styles.css` (append reader styles)
- Replace: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.api` (Task 7), `t` (Task 7), everything in `layout.ts` and `throttle.ts` (Task 8), `DocumentData`, `ReadingPosition`, `ZoomSetting` (Task 2).
- Produces: `ReaderView` React component (no props). `loadPdf(bytes: Uint8Array): Promise<LoadedPdf>` with `interface LoadedPdf { doc: PDFDocumentProxy; pageSizes: PageSize[] }`.

Behavior:
- Loads bytes and Document data in parallel, then the PDF. Shows `t.reader.loading`, or `t.reader.loadFailed` on error (including password-protected PDFs, which Plan 3 handles).
- Continuous vertical scroll. Only pages in `visiblePageRange` (overscan 1) get a canvas, rendered at `scale * devicePixelRatio` for sharp text.
- Initial zoom is the saved `reading.zoom`, else fit-width. Initial scroll is the saved position.
- When zoom or window size changes the layout, it keeps the same page + ratio at the top of the viewport.
- Reports `{ pageIndex, offsetRatio, zoom, updatedAt }` to main through a 500 ms throttle on scroll and on zoom change. Flushes the throttle on window `blur` and `beforeunload`.
- Toolbar: zoom out, zoom %, zoom in, fit width, fit page, page indicator. Keys: Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0 fit width.

- [ ] **Step 1: Create `src/renderer/src/reader/pdf.ts`**

```ts
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageSize } from './layout'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface LoadedPdf {
  doc: PDFDocumentProxy
  pageSizes: PageSize[]
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  const pageSizes: PageSize[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const viewport = (await doc.getPage(pageNumber)).getViewport({ scale: 1 })
    pageSizes.push({ width: viewport.width, height: viewport.height })
  }
  return { doc, pageSizes }
}
```

- [ ] **Step 2: Create `src/renderer/src/reader/PdfPage.tsx`**

```tsx
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { useEffect, useRef } from 'react'
import type { PageBox } from './layout'

interface PdfPageProps {
  doc: PDFDocumentProxy
  pageIndex: number
  box: PageBox
  scale: number
  visible: boolean
}

export function PdfPage({ doc, pageIndex, box, scale, visible }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: ReturnType<PDFPageProxy["render"]> | null = null
    void (async () => {
      const page = await doc.getPage(pageIndex + 1)
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) return
      task = page.render({ canvasContext: context, viewport })
      try {
        await task.promise
      } catch (err) {
        if (!cancelled) console.error(`Failed to render page ${pageIndex + 1}`, err)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageIndex, scale, visible])

  return (
    <div className="page" style={{ top: box.top, width: box.width, height: box.height }}>
      {visible && <canvas ref={canvasRef} style={{ width: box.width, height: box.height }} />}
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/src/reader/ReaderView.tsx`**

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReadingPosition, ZoomSetting } from '../../../shared/documentData'
import { t } from '../../../shared/strings'
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
  | { status: 'ready'; pdf: LoadedPdf; initial: ReadingPosition | null }

export function ReaderView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [bytes, data] = await Promise.all([window.api.readDocumentBytes(), window.api.loadDocumentData()])
        const pdf = await loadPdf(bytes)
        if (!cancelled) setState({ status: 'ready', pdf, initial: data.reading })
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
  return <ReaderSurface pdf={state.pdf} initial={state.initial} />
}

function ReaderSurface({ pdf, initial }: { pdf: LoadedPdf; initial: ReadingPosition | null }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [zoom, setZoom] = useState<ZoomSetting>(initial?.zoom ?? { mode: 'fit-width' })
  // The page + ratio at the top of the viewport; kept across zoom and resize.
  const anchorRef = useRef<PagePosition>(initial ?? { pageIndex: 0, offsetRatio: 0 })
  const restoredRef = useRef(false)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

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
    setScrollTop(element.scrollTop)
    restoredRef.current = true
  }, [boxes, measured])

  useEffect(() => {
    if (restoredRef.current) report.call({ ...anchorRef.current, zoom, updatedAt: Date.now() })
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.key === '=' || event.key === '+') setZoom(stepZoom(scale, 1))
      else if (event.key === '-') setZoom(stepZoom(scale, -1))
      else if (event.key === '0') setZoom({ mode: 'fit-width' })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scale])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    setScrollTop(element.scrollTop)
    if (!restoredRef.current) return
    const position = positionFromScroll(element.scrollTop, boxes)
    anchorRef.current = position
    report.call({ ...position, zoom: zoomRef.current, updatedAt: Date.now() })
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
      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="pages" style={{ height: totalHeight(boxes), width: Math.max(viewport.width, contentWidth(boxes)) }}>
          {boxes.map((box, pageIndex) => (
            <PdfPage
              key={pageIndex}
              doc={pdf.doc}
              pageIndex={pageIndex}
              box={box}
              scale={scale}
              visible={pageIndex >= range.first && pageIndex <= range.last}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Append reader styles to `src/renderer/src/styles.css`**

```css
.status {
  padding: 32px;
  color: #666;
}
.reader {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #fff;
  border-bottom: 1px solid #ddd;
}
.toolbar button {
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 4px;
  padding: 3px 10px;
  font: inherit;
  cursor: pointer;
}
.toolbar button.active {
  background: #e3edff;
  border-color: #7aa7ff;
}
.zoom-value {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.page-indicator {
  margin-left: auto;
  color: #555;
  font-variant-numeric: tabular-nums;
}
.scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: scroll; /* always reserve the scrollbar so fit-width does not oscillate */
  background: #e6e6e6;
}
.pages {
  position: relative;
}
.page {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.page canvas {
  display: block;
}
```

- [ ] **Step 5: Replace `src/renderer/src/App.tsx`**

The home branch stays a probe until Task 10.

```tsx
import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'
import { ReaderView } from './reader/ReaderView'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])
  if (!context) return null
  if (context.kind === 'document') return <ReaderView />
  return <pre>{JSON.stringify(context, null, 2)}</pre>
}
```

- [ ] **Step 6: Typecheck and tests**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Manual verification**

```powershell
$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run dev
```

Use a PDF with at least 20 pages. Check each item:
1. Ctrl+O and open the PDF. Pages render sharply in one continuous vertical scroll. The indicator shows "Trang 1 / N".
2. Scroll to the middle of page 7. The indicator updates. After about 3 s, `%TEMP%\pdfreader-dev\documents\<fingerprint>.json` exists, with `reading.pageIndex` 6 (or 7 if page 8 is at the top) and `pageCount` N.
3. Press Ctrl+= twice. The zoom goes up through the steps, the same text stays near the top of the window, and `reading.zoom` in the JSON becomes `{ "mode": "percent", "value": ... }`.
4. Click "Vừa trang". A whole page fits in the window.
5. Close the window right after scrolling (within 1 s). Reopen the same file with Ctrl+O. It opens at the exact same place and zoom.
6. Resize the window in fit-width mode. The pages rescale and the top line stays in place.
7. Open a 300+ page PDF. Scrolling stays smooth (only nearby pages have canvases; check with DevTools Elements, Ctrl+Shift+I).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/reader/pdf.ts src/renderer/src/reader/PdfPage.tsx src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css src/renderer/src/App.tsx
git commit -m "feat: render PDFs with continuous scroll and restore Reading Position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Home view with Recent Documents

**Files:**
- Create: `src/renderer/src/home/HomeView.tsx`
- Modify: `src/renderer/src/styles.css` (append home styles)
- Replace: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.api.listRecent`, `window.api.openPath`, `window.api.openFileDialog`, `RecentView`, `t`, `ReaderView`.
- Produces: `HomeView` React component (no props). Final `App`.

Behavior:
- Lists Recent Documents, newest first: file name, full path, Reading Progress as a bar and a percentage (or "Chưa đọc").
- A missing file shows "Không tìm thấy file" and is greyed out.
- Click an entry: open it. On failure, show `t.openError` in an alert and refresh the list.
- "Mở PDF…" button opens the file dialog.
- The list refreshes whenever the home window gains focus, so progress made in a Document window shows up.

- [ ] **Step 1: Create `src/renderer/src/home/HomeView.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { RecentView } from '../../../shared/ipc'
import { t } from '../../../shared/strings'

export function HomeView() {
  const [items, setItems] = useState<RecentView[] | null>(null)

  const refresh = useCallback(() => {
    void window.api.listRecent().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const open = async (item: RecentView) => {
    const result = await window.api.openPath(item.path)
    if (!result.ok) {
      alert(t.openError(item.path, result))
      refresh()
    }
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1>{t.home.title}</h1>
        <button onClick={() => void window.api.openFileDialog()}>{t.home.open}</button>
      </header>
      {items !== null && items.length === 0 && <p className="home-empty">{t.home.empty}</p>}
      <ul className="recent-list">
        {items?.map((item) => (
          <li key={item.fingerprint}>
            <button className={item.exists ? 'recent-item' : 'recent-item missing'} onClick={() => void open(item)}>
              <span className="recent-name">{item.fileName}</span>
              <span className="recent-path">{item.exists ? item.path : `${t.home.missing}: ${item.path}`}</span>
              <span className="recent-progress">
                <span className="progress-bar">
                  <span className="progress-fill" style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }} />
                </span>
                <span className="progress-label">
                  {item.progress === null ? t.home.notStarted : `${Math.round(item.progress * 100)}%`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Append home styles to `src/renderer/src/styles.css`**

```css
.home {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}
.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.home-header h1 {
  font-size: 20px;
  font-weight: 600;
}
.home-header button {
  border: 1px solid #7aa7ff;
  background: #e3edff;
  border-radius: 4px;
  padding: 6px 14px;
  font: inherit;
  cursor: pointer;
}
.home-empty {
  color: #666;
}
.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.recent-item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'name progress'
    'path progress';
  gap: 2px 16px;
  width: 100%;
  margin-bottom: 8px;
  padding: 10px 14px;
  text-align: left;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}
.recent-item:hover {
  border-color: #7aa7ff;
}
.recent-item.missing {
  opacity: 0.55;
}
.recent-name {
  grid-area: name;
  font-weight: 600;
}
.recent-path {
  grid-area: path;
  color: #666;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-progress {
  grid-area: progress;
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-bar {
  width: 120px;
  height: 6px;
  background: #e6e6e6;
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  display: block;
  height: 100%;
  background: #4a7fe0;
}
.progress-label {
  min-width: 56px;
  text-align: right;
  color: #555;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Replace `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'
import { HomeView } from './home/HomeView'
import { ReaderView } from './reader/ReaderView'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])
  if (!context) return null
  return context.kind === 'document' ? <ReaderView /> : <HomeView />
}
```

- [ ] **Step 4: Typecheck and tests**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Manual verification**

```powershell
$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run dev
```

Check each item:
1. The home window lists the PDFs opened in earlier tasks, newest first, with a progress bar and percentage.
2. Click an entry. Its Document window opens at the saved position.
3. Scroll to about the middle of that Document, wait 3 s, then focus the home window. Its percentage updates to about 50%.
4. Close the app. Rename one of the listed PDFs in Explorer. Start the app: that entry shows "Không tìm thấy file" and is greyed out. Clicking it shows the "Không tìm thấy file" alert.
5. Open the renamed file with "Mở PDF…". It opens at the old Reading Position (same Fingerprint), and the list now shows the new path once.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/home/HomeView.tsx src/renderer/src/styles.css src/renderer/src/App.tsx
git commit -m "feat: add home view listing Recent Documents with Reading Progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end verification of sync and production build

**Files:**
- No code changes expected. If a check fails, fix the cause in the file that owns the behavior, add a unit test when the cause is in pure logic, and commit the fix separately.

**Interfaces:**
- Consumes: the whole app.
- Produces: verified behavior, notes in the commit message if any fix was needed.

- [ ] **Step 1: Full automated checks**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Simulate a OneDrive Conflict Copy**

1. With the dev Data Folder (`$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"`), open a PDF, scroll to page 3, wait 3 s, close the app.
2. In `%TEMP%\pdfreader-dev\documents`, copy `<fingerprint>.json` to `<fingerprint>-LAPTOP.json`.
3. Edit `<fingerprint>-LAPTOP.json`: set `reading.pageIndex` to `9` and `reading.updatedAt` to a number larger than the one in `<fingerprint>.json`.
4. Start the app and open the PDF.

Expected: it opens at page 10. `<fingerprint>-LAPTOP.json` is gone. `<fingerprint>.json` has `pageIndex` 9.

- [ ] **Step 3: Simulate a corrupt data file**

1. Close the app. Replace the content of `<fingerprint>.json` with `{ broken`.
2. Start the app and open the PDF.

Expected: it opens at page 1 without an error. The folder contains `<fingerprint>.corrupt-<number>.bak` with the broken content.

- [ ] **Step 4: Verify the real OneDrive default**

Close the app. Start it without the override: in a new PowerShell window, run `npm run dev`.

Expected: opening a PDF and scrolling creates `%OneDrive%\PdfReaderData\documents\<fingerprint>.json`. Delete that test file afterwards if you do not want it synced.

- [ ] **Step 5: Verify the production build**

Run: `npm run build`
Expected: completes without errors and creates `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`.

```powershell
$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run preview
```

Expected: the home window appears. Opening a PDF renders pages (this confirms the pdf.js worker loads from `file://` in the built app). The position restores after reopening.

- [ ] **Step 6: Verify launch with a file argument**

```powershell
$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npx electron . "C:\path\to\some.pdf"
```

Expected: the Document window opens directly, with no home window. While it runs, the same command in a second terminal with another PDF opens that PDF in the first app instance (single instance) as a new window.

- [ ] **Step 7: Commit any fixes**

If Steps 1–6 needed fixes, they were committed with their own tests. If nothing changed, skip this step.
