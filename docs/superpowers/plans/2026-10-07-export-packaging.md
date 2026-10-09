# Export & Packaging Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a Document as a NEW PDF that contains its Highlights and Notes as standard PDF annotations, and finish the Windows installer: app icon, "Open with" registration for `.pdf`, a production Content-Security-Policy, and no DevTools in the installed app.

**Architecture:** The renderer converts Highlights to PDF-space quadrilaterals with pdf.js (`viewport.convertToPdfPoint`, which handles page rotation and crop boxes) and sends them to main. Main asks for a destination with a Save dialog, reads the original bytes, adds `/Highlight` annotations (with an appearance stream) plus `/Popup` annotations for Notes using pdf-lib, and writes the result atomically to the chosen path. The original file is never written. Packaging changes live in `electron-builder.yml`, an NSIS include script, and a build-only Vite plugin.

**Tech Stack:** Electron 38, electron-vite 4, electron-builder 26, React 19, TypeScript 5.9 strict, pdfjs-dist 4.10.38, pdf-lib 1.17, Vitest 3.

**Prerequisite:** Plans 2 and 3 are complete. In particular these exist: `HIGHLIGHT_RGB` (`src/shared/highlightColors.ts`), the reader toolbar with the `◐` button, `electron-builder.yml` and the `npm run dist` script. Read `CONTEXT.md` (term **Export**) first.

## Global Constraints

- Platform: Windows 10/11 x64. Paths are Windows paths; compare paths case-insensitively.
- The app NEVER writes to, renames, or deletes the user's PDF files. Export writes only to the path the user chooses in a Save dialog, and refuses the source file's own path.
- Default export file name: `<source name without .pdf> (highlighted).pdf`, in the source file's folder.
- Each Highlight part becomes one `/Highlight` annotation with `/QuadPoints` in PDF user space, color from `HIGHLIGHT_RGB`, an appearance stream (multiply blend), `/T` = `PdfReader`; a Note becomes `/Contents` on the first part plus a linked `/Popup`. Unanchored Highlights are not exported.
- `pdf-lib` is a devDependency: electron-vite bundles it into `out/main`, and the installer ships only `out/**` + `package.json`.
- Installer: per-user one-click NSIS, desktop + Start menu shortcut, app icon, and "Open with" registration for `.pdf` that does NOT make PdfReader the default app.
- Content-Security-Policy applies to production builds only (the dev server needs inline scripts). DevTools are available only when `!app.isPackaged`.
- All user-visible text lives in `src/shared/strings.ts`, in Vietnamese.
- `pdfjs-dist` is pinned to exactly `4.10.38`.
- `npm run typecheck` and `npm test` must pass at the end of every task.
- Every commit message ends with a `Co-Authored-By:` line naming the model that made the commit.

## Verification environment (for app checks)

Same as Plans 2–3: clear `ELECTRON_RUN_AS_NODE` for Electron children; isolated `PDFREADER_DATA_DIR`; back up/restore `%APPDATA%\pdf-reader\recent.json` and `settings.json`; `npm run build`, then `npx electron . "<pdf>" --remote-debugging-port=9222` driven through CDP; kill every `electron.exe` before and after. Scratch files in `.superpowers/sdd/tmp/`. Native Save dialogs cannot be clicked through CDP: drive them with `[System.Windows.Forms.SendKeys]` (type a path, press Enter) or report that step as pending human.

## File Structure

```
src/shared/ipc.ts                              + ExportAnnotation, ExportResult, exportPdf
src/shared/strings.ts                          + export strings
src/renderer/src/reader/export/buildAnnotations.ts      NEW pure: Highlights -> ExportAnnotation[]
src/renderer/src/reader/export/collectAnnotations.ts    NEW pdf.js viewports -> buildAnnotations
src/main/exportPdf.ts                          NEW pdf-lib writer, validation, file name, atomic write
src/main/index.ts                              + export IPC, DevTools gating
src/preload/index.ts                           + exportPdf
src/renderer/src/reader/ReaderView.tsx         + export button
scripts/make-icon.mjs                          NEW generates build/icon.png (no dependencies)
build/icon.png                                 NEW generated app icon (committed)
build/installer.nsh                            NEW "Open with" registry entries
src/main/windows.ts                            + window icon in development
electron-builder.yml                           + icon, buildResources, NSIS include
electron.vite.config.ts                        + production-only CSP plugin
README.md                                      updated for Plans 2–4
```

---

### Task 1: Highlight → PDF annotation geometry

**Files:**
- Create: `src/renderer/src/reader/export/buildAnnotations.ts`, `src/renderer/src/reader/export/buildAnnotations.test.ts`, `src/renderer/src/reader/export/collectAnnotations.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Consumes: `Highlight` (`documentData.ts`), `HIGHLIGHT_RGB` (`highlightColors.ts`).
- Produces:
  - In `src/shared/ipc.ts`:

    ```ts
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
    ```

  - `type ToPdfPoint = (pageIndex: number, x: number, y: number) => [number, number]`
  - `buildExportAnnotations(highlights: Highlight[], toPdfPoint: ToPdfPoint): ExportAnnotation[]`
  - `collectExportAnnotations(doc: PDFDocumentProxy, highlights: Highlight[]): Promise<ExportAnnotation[]>`

Rules: skip Unanchored Highlights, skip parts with no rectangles or on pages the document does not have; one annotation per part; the Note goes on the first exported part of its Highlight only.

- [ ] **Step 1: Add the types to `src/shared/ipc.ts`**

Append the `ExportAnnotation` interface and `ExportResult` type exactly as shown in Interfaces above.

- [ ] **Step 2: Write the failing test**

`src/renderer/src/reader/export/buildAnnotations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { buildExportAnnotations, type ToPdfPoint } from './buildAnnotations'

// Page-unit point (origin top-left) -> PDF point (origin bottom-left) on an 800-unit-high page shifted 10 right.
const toPdf: ToPdfPoint = (_pageIndex, x, y) => [x + 10, 800 - y]

function hl(id: string, parts: Highlight['parts'], extra: Partial<Highlight> = {}): Highlight {
  return { id, color: 'yellow', note: null, text: id, parts, createdAt: 1, updatedAt: 1, ...extra }
}

describe('buildExportAnnotations', () => {
  it('turns each part into quad points and a bounding rect in PDF space', () => {
    const highlight = hl(
      'a',
      [
        { pageIndex: 0, rects: [{ x: 0, y: 100, width: 50, height: 10 }] },
        {
          pageIndex: 1,
          rects: [
            { x: 5, y: 0, width: 20, height: 10 },
            { x: 5, y: 20, width: 30, height: 10 }
          ]
        }
      ],
      { note: 'remember' }
    )
    expect(buildExportAnnotations([highlight], toPdf)).toEqual([
      {
        pageIndex: 0,
        quadPoints: [10, 700, 60, 700, 10, 690, 60, 690],
        rect: [10, 690, 60, 700],
        color: [1, 0.89, 0.2],
        note: 'remember'
      },
      {
        pageIndex: 1,
        quadPoints: [15, 800, 35, 800, 15, 790, 35, 790, 15, 780, 45, 780, 15, 770, 45, 770],
        rect: [15, 770, 45, 800],
        color: [1, 0.89, 0.2],
        note: null
      }
    ])
  })

  it('skips Unanchored Highlights and empty parts', () => {
    const lost = hl('lost', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }], { status: 'unanchored' })
    const empty = hl('empty', [{ pageIndex: 0, rects: [] }])
    expect(buildExportAnnotations([lost, empty], toPdf)).toEqual([])
  })

  it('puts the Note on the first exported part when an earlier part is empty', () => {
    const highlight = hl(
      'b',
      [
        { pageIndex: 0, rects: [] },
        { pageIndex: 1, rects: [{ x: 0, y: 0, width: 10, height: 10 }] }
      ],
      { note: 'n' }
    )
    expect(buildExportAnnotations([highlight], toPdf).map((a) => a.note)).toEqual(['n'])
  })
})
```

Run: `npx vitest run src/renderer/src/reader/export` → FAIL (module not found).

- [ ] **Step 3: Create `src/renderer/src/reader/export/buildAnnotations.ts`**

```ts
import type { Highlight } from '../../../../shared/documentData'
import { HIGHLIGHT_RGB } from '../../../../shared/highlightColors'
import type { ExportAnnotation } from '../../../../shared/ipc'

/** Converts a point in page units (scale 1, origin top-left) to PDF user space. */
export type ToPdfPoint = (pageIndex: number, x: number, y: number) => [number, number]

export function buildExportAnnotations(highlights: Highlight[], toPdfPoint: ToPdfPoint): ExportAnnotation[] {
  const annotations: ExportAnnotation[] = []
  for (const highlight of highlights) {
    if (highlight.status === 'unanchored') continue
    let noteUsed = false
    for (const part of highlight.parts) {
      if (part.rects.length === 0) continue
      const quadPoints: number[] = []
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const r of part.rects) {
        const corners = [
          toPdfPoint(part.pageIndex, r.x, r.y),
          toPdfPoint(part.pageIndex, r.x + r.width, r.y),
          toPdfPoint(part.pageIndex, r.x, r.y + r.height),
          toPdfPoint(part.pageIndex, r.x + r.width, r.y + r.height)
        ]
        for (const [x, y] of corners) {
          quadPoints.push(x, y)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      const [r, g, b] = HIGHLIGHT_RGB[highlight.color]
      annotations.push({
        pageIndex: part.pageIndex,
        quadPoints,
        rect: [minX, minY, maxX, maxY],
        color: [r, g, b],
        note: noteUsed ? null : highlight.note
      })
      noteUsed = true
    }
  }
  return annotations
}
```

Run the test → PASS.

- [ ] **Step 4: Create `src/renderer/src/reader/export/collectAnnotations.ts`**

```ts
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { Highlight } from '../../../../shared/documentData'
import type { ExportAnnotation } from '../../../../shared/ipc'
import { buildExportAnnotations } from './buildAnnotations'

type Viewport = ReturnType<PDFPageProxy['getViewport']>

/** Export annotations for the Document's Highlights, using pdf.js to map page units to PDF space. */
export async function collectExportAnnotations(
  doc: PDFDocumentProxy,
  highlights: Highlight[]
): Promise<ExportAnnotation[]> {
  const pageIndexes = new Set(highlights.flatMap((h) => h.parts.map((p) => p.pageIndex)))
  const viewports = new Map<number, Viewport>()
  await Promise.all(
    [...pageIndexes]
      .filter((pageIndex) => pageIndex < doc.numPages)
      .map(async (pageIndex) => {
        const page = await doc.getPage(pageIndex + 1)
        viewports.set(pageIndex, page.getViewport({ scale: 1 }))
      })
  )
  const onKnownPages = highlights.map((h) => ({ ...h, parts: h.parts.filter((p) => viewports.has(p.pageIndex)) }))
  return buildExportAnnotations(onKnownPages, (pageIndex, x, y) => {
    const [pdfX, pdfY] = viewports.get(pageIndex)!.convertToPdfPoint(x, y) as [number, number]
    return [pdfX, pdfY]
  })
}
```

- [ ] **Step 5: Typecheck and tests**

`npm run typecheck` → 0. `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/renderer/src/reader/export/buildAnnotations.ts src/renderer/src/reader/export/buildAnnotations.test.ts src/renderer/src/reader/export/collectAnnotations.ts
git commit -m "feat: convert Highlights to PDF annotation geometry

Co-Authored-By: <your model>"
```

---

### Task 2: Write annotated PDFs with pdf-lib

**Files:**
- Create: `src/main/exportPdf.ts`, `src/main/exportPdf.test.ts`
- Modify: `package.json` / `package-lock.json` (devDependency `pdf-lib`)

**Interfaces:**
- Consumes: `ExportAnnotation` (`src/shared/ipc.ts`).
- Produces from `src/main/exportPdf.ts`:
  - `class EncryptedPdfError extends Error`
  - `isExportAnnotation(value: unknown): value is ExportAnnotation`
  - `exportFileName(sourceFileName: string): string`
  - `sameFilePath(a: string, b: string): boolean`
  - `writeAnnotatedPdf(source: Uint8Array, annotations: ExportAnnotation[], now: Date): Promise<Uint8Array>`
  - `writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>`

- [ ] **Step 1: Install pdf-lib**

```bash
npm install -D pdf-lib@^1.17.1
```

- [ ] **Step 2: Write the failing tests**

`src/main/exportPdf.test.ts`:

```ts
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExportAnnotation } from '../shared/ipc'
import { exportFileName, isExportAnnotation, sameFilePath, writeAnnotatedPdf, writeFileAtomic } from './exportPdf'

const ANNOTATION: ExportAnnotation = {
  pageIndex: 0,
  quadPoints: [10, 700, 60, 700, 10, 690, 60, 690],
  rect: [10, 690, 60, 700],
  color: [1, 0.89, 0.2],
  note: 'Ghi chú quan trọng'
}

async function samplePdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([600, 800])
  return doc.save()
}

async function annotsOf(bytes: Uint8Array, pageIndex = 0): Promise<{ doc: PDFDocument; annots: PDFDict[] }> {
  const doc = await PDFDocument.load(bytes)
  const array = doc.getPage(pageIndex).node.Annots()
  const annots = (array?.asArray() ?? []).map((ref) => doc.context.lookup(ref, PDFDict))
  return { doc, annots }
}

describe('writeAnnotatedPdf', () => {
  it('adds a Highlight annotation with quad points, color, author and Note popup', async () => {
    const output = await writeAnnotatedPdf(await samplePdf(), [ANNOTATION], new Date('2026-10-07T10:00:00Z'))
    const { annots } = await annotsOf(output)
    expect(annots).toHaveLength(2)
    const [highlight, popup] = annots
    expect(highlight.get(PDFName.of('Subtype'))?.toString()).toBe('/Highlight')
    const quads = highlight.lookup(PDFName.of('QuadPoints'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())
    expect(quads).toEqual(ANNOTATION.quadPoints)
    const color = highlight.lookup(PDFName.of('C'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())
    expect(color).toEqual([1, 0.89, 0.2])
    expect(highlight.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe('Ghi chú quan trọng')
    expect(highlight.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('PdfReader')
    expect(highlight.get(PDFName.of('AP'))).toBeInstanceOf(PDFDict)
    expect(popup.get(PDFName.of('Subtype'))?.toString()).toBe('/Popup')
    expect(popup.get(PDFName.of('Parent'))).toBeInstanceOf(PDFRef)
  })

  it('adds no Contents or Popup without a Note, and targets the right page', async () => {
    const output = await writeAnnotatedPdf(await samplePdf(2), [{ ...ANNOTATION, pageIndex: 1, note: null }], new Date())
    expect((await annotsOf(output, 0)).annots).toHaveLength(0)
    const { annots } = await annotsOf(output, 1)
    expect(annots).toHaveLength(1)
    expect(annots[0].get(PDFName.of('Contents'))).toBeUndefined()
    expect(annots[0].get(PDFName.of('Popup'))).toBeUndefined()
  })

  it('ignores annotations for pages that do not exist and leaves the input untouched', async () => {
    const source = await samplePdf()
    const copy = Uint8Array.from(source)
    const output = await writeAnnotatedPdf(source, [{ ...ANNOTATION, pageIndex: 5 }], new Date())
    expect((await annotsOf(output)).annots).toHaveLength(0)
    expect(source).toEqual(copy)
  })
})

describe('isExportAnnotation', () => {
  it('accepts a valid annotation and rejects malformed ones', () => {
    expect(isExportAnnotation(ANNOTATION)).toBe(true)
    expect(isExportAnnotation({ ...ANNOTATION, quadPoints: [1, 2, 3] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, quadPoints: [] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, color: [2, 0, 0] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, rect: [0, 0, 1] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, pageIndex: -1 })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, note: 5 })).toBe(false)
  })
})

describe('exportFileName', () => {
  it('adds " (highlighted)" before the extension', () => {
    expect(exportFileName('Hợp đồng.PDF')).toBe('Hợp đồng (highlighted).pdf')
    expect(exportFileName('a.b.pdf')).toBe('a.b (highlighted).pdf')
    expect(exportFileName('noext')).toBe('noext (highlighted).pdf')
  })
})

describe('sameFilePath', () => {
  it('compares resolved paths case-insensitively', () => {
    expect(sameFilePath('D:\\Books\\A.pdf', 'd:\\books\\x\\..\\a.PDF')).toBe(true)
    expect(sameFilePath('D:\\Books\\A.pdf', 'D:\\Books\\A (highlighted).pdf')).toBe(false)
  })
})

describe('writeFileAtomic', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfreader-export-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the bytes and leaves no temp file', async () => {
    await writeFileAtomic(join(dir, 'out.pdf'), Uint8Array.from([1, 2, 3]))
    expect([...(await readFile(join(dir, 'out.pdf')))]).toEqual([1, 2, 3])
    expect(await readdir(dir)).toEqual(['out.pdf'])
  })
})
```

Run: `npx vitest run src/main/exportPdf.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `src/main/exportPdf.ts`**

```ts
import { randomUUID } from 'crypto'
import { rename, unlink, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { EncryptedPDFError, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import type { ExportAnnotation } from '../shared/ipc'

/** The source PDF is encrypted; pdf-lib cannot add annotations to it safely. */
export class EncryptedPdfError extends Error {
  constructor() {
    super('The PDF is encrypted')
    this.name = 'EncryptedPdfError'
  }
}

const AUTHOR = 'PdfReader'
const POPUP_WIDTH = 220
const POPUP_HEIGHT = 120

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function isExportAnnotation(value: unknown): value is ExportAnnotation {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Number.isInteger(v.pageIndex) &&
    (v.pageIndex as number) >= 0 &&
    Array.isArray(v.rect) &&
    v.rect.length === 4 &&
    v.rect.every(isFiniteNumber) &&
    Array.isArray(v.quadPoints) &&
    v.quadPoints.length > 0 &&
    v.quadPoints.length % 8 === 0 &&
    v.quadPoints.every(isFiniteNumber) &&
    Array.isArray(v.color) &&
    v.color.length === 3 &&
    v.color.every((c) => isFiniteNumber(c) && c >= 0 && c <= 1) &&
    (v.note === null || typeof v.note === 'string')
  )
}

export function exportFileName(sourceFileName: string): string {
  const base = sourceFileName.replace(/\.pdf$/i, '')
  return `${base} (highlighted).pdf`
}

export function sameFilePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}

/** Number formatting for content streams: no exponent notation, at most 3 decimals. */
const fmt = (n: number) => String(Number(n.toFixed(3)))

/** Bounding boxes [x, y, width, height] of each quadrilateral (8 numbers each). */
function quadBoxes(quadPoints: number[]): [number, number, number, number][] {
  const boxes: [number, number, number, number][] = []
  for (let i = 0; i < quadPoints.length; i += 8) {
    const xs = [quadPoints[i], quadPoints[i + 2], quadPoints[i + 4], quadPoints[i + 6]]
    const ys = [quadPoints[i + 1], quadPoints[i + 3], quadPoints[i + 5], quadPoints[i + 7]]
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    boxes.push([x, y, Math.max(...xs) - x, Math.max(...ys) - y])
  }
  return boxes
}

/**
 * Returns a copy of `source` with one /Highlight annotation per entry (plus a /Popup for Notes).
 * The input bytes are not modified.
 */
export async function writeAnnotatedPdf(
  source: Uint8Array,
  annotations: ExportAnnotation[],
  now: Date
): Promise<Uint8Array> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(Uint8Array.from(source), { updateMetadata: false })
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new EncryptedPdfError()
    throw err
  }
  const pages = doc.getPages()
  for (const annotation of annotations) {
    const page = pages[annotation.pageIndex]
    if (!page) continue
    const [x1, y1, x2, y2] = annotation.rect
    const [r, g, b] = annotation.color
    const fills = quadBoxes(annotation.quadPoints)
      .map(([x, y, w, h]) => `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`)
      .join('\n')
    const appearance = doc.context.stream(`/GS0 gs\n${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n${fills}\nf`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [x1, y1, x2, y2],
      Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply' } } }
    })
    const highlight = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [x1, y1, x2, y2],
      QuadPoints: annotation.quadPoints,
      C: [r, g, b],
      F: 4,
      T: PDFHexString.fromText(AUTHOR),
      M: PDFString.fromDate(now),
      AP: { N: doc.context.register(appearance) }
    })
    const highlightRef = doc.context.register(highlight)
    page.node.addAnnot(highlightRef)
    if (annotation.note) {
      highlight.set(PDFName.of('Contents'), PDFHexString.fromText(annotation.note))
      const popup = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Popup',
        Rect: [x2, y2 - POPUP_HEIGHT, x2 + POPUP_WIDTH, y2],
        Parent: highlightRef,
        Open: false,
        F: 4
      })
      const popupRef = doc.context.register(popup)
      highlight.set(PDFName.of('Popup'), popupRef)
      page.node.addAnnot(popupRef)
    }
  }
  return doc.save()
}

export async function writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`
  await writeFile(tempPath, bytes)
  try {
    await rename(tempPath, path)
  } catch (err) {
    await unlink(tempPath).catch(() => undefined)
    throw err
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/exportPdf.test.ts` → PASS.
If a pdf-lib accessor differs in the installed version (e.g. `Annots()`), check `node_modules/pdf-lib/cjs/core/structures/PDFPageLeaf.d.ts` and adapt the TEST helper only; the writer API used (`context.obj`, `context.stream`, `context.register`, `node.addAnnot`) is stable across 1.17.x.

- [ ] **Step 5: Typecheck and full suite**

`npm run typecheck` → 0. `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/exportPdf.ts src/main/exportPdf.test.ts
git commit -m "feat: write Highlights and Notes into a new PDF with pdf-lib

Co-Authored-By: <your model>"
```

---

### Task 3: Export command

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/strings.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/reader/ReaderView.tsx`

**Interfaces:**
- Consumes: Task 1 (`collectExportAnnotations`, `ExportAnnotation`, `ExportResult`), Task 2 (`writeAnnotatedPdf`, `isExportAnnotation`, `exportFileName`, `sameFilePath`, `writeFileAtomic`, `EncryptedPdfError`).
- Produces: `IPC.exportPdf = 'document:export-pdf'`; `PdfReaderApi.exportPdf(annotations: ExportAnnotation[]): Promise<ExportResult>`; `t.export` strings; a toolbar button.

Behavior:
- A toolbar button "⤓" (title "Xuất PDF có highlight") is disabled when the Document has no exportable Highlights.
- Clicking it builds the annotations, then main shows a Save dialog with the default name in the source folder. Cancel does nothing. Choosing the source file itself is refused (`same-file`). An encrypted source gives `encrypted`.
- On success an alert shows the saved path. On failure an alert explains why.

- [ ] **Step 1: IPC, preload and strings**

`src/shared/ipc.ts`: add `exportPdf: 'document:export-pdf',` to `IPC` and `exportPdf(annotations: ExportAnnotation[]): Promise<ExportResult>` to `PdfReaderApi`.

`src/preload/index.ts`: add `exportPdf: (annotations) => ipcRenderer.invoke(IPC.exportPdf, annotations),` to `api`.

`src/shared/strings.ts`: change the first line to `import type { ExportResult, OpenResult } from './ipc'` and add after `settings: { … }`:

```ts
  export: {
    button: 'Xuất PDF có highlight',
    dialogTitle: 'Xuất PDF có highlight',
    nothing: 'Chưa có highlight để xuất.',
    done: (path: string) => `Đã xuất file:\n${path}`,
    failed(result: Extract<ExportResult, { ok: false }>): string {
      if (result.reason === 'same-file') return 'Không thể ghi đè lên file gốc. Hãy chọn tên khác.'
      if (result.reason === 'encrypted') return 'File có mật khẩu nên chưa xuất được.'
      return `Xuất PDF thất bại.\n\n${result.message ?? ''}`
    }
  }
```

- [ ] **Step 2: Main handler — `src/main/index.ts`**

Add imports: `dirname` to the `path` import; `type SaveDialogOptions` to the `electron` import; `type ExportResult` to the `../shared/ipc` import; and

```ts
import {
  EncryptedPdfError,
  exportFileName,
  isExportAnnotation,
  sameFilePath,
  writeAnnotatedPdf,
  writeFileAtomic
} from './exportPdf'
```

In `registerIpc`, add:

```ts
  ipcMain.handle(IPC.exportPdf, async (event, annotations: unknown): Promise<ExportResult> => {
    const context = requireDocument(event)
    if (!Array.isArray(annotations) || !annotations.every(isExportAnnotation)) throw new Error('Invalid export payload')
    const options: SaveDialogOptions = {
      title: t.export.dialogTitle,
      defaultPath: join(dirname(context.path), exportFileName(context.fileName)),
      filters: [{ name: t.dialog.pdfFilter, extensions: ['pdf'] }]
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) return { ok: false, reason: 'cancelled' }
    if (sameFilePath(choice.filePath, context.path)) return { ok: false, reason: 'same-file' }
    try {
      const bytes = await writeAnnotatedPdf(await readFile(context.path), annotations, new Date())
      await writeFileAtomic(choice.filePath, bytes)
      return { ok: true, path: choice.filePath }
    } catch (err) {
      if (err instanceof EncryptedPdfError) return { ok: false, reason: 'encrypted' }
      console.error('Export failed', err)
      return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  })
```

- [ ] **Step 3: Toolbar button — `src/renderer/src/reader/ReaderView.tsx`**

Add `import { collectExportAnnotations } from './export/collectAnnotations'`. In `ReaderSurface`, add:

```ts
  const [exporting, setExporting] = useState(false)
  const canExport = highlights.some((h) => h.status !== 'unanchored' && h.parts.some((p) => p.rects.length > 0))

  const exportPdf = async () => {
    setExporting(true)
    try {
      const annotations = await collectExportAnnotations(pdf.doc, highlights)
      const result = await window.api.exportPdf(annotations)
      if (result.ok) alert(t.export.done(result.path))
      else if (result.reason !== 'cancelled') alert(t.export.failed(result))
    } catch (err) {
      console.error('Export failed', err)
      alert(t.export.failed({ ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setExporting(false)
    }
  }
```

In the toolbar, directly after the `◐` button, add:

```tsx
        <button
          title={canExport ? t.export.button : t.export.nothing}
          disabled={!canExport || exporting}
          onClick={() => void exportPdf()}
        >
          ⤓
        </button>
```

- [ ] **Step 4: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 5: App check — export**

1. Open a text PDF with 2 Highlights (one with a Note, one spanning two pages). Click "⤓". In the Save dialog (drive with SendKeys or report as pending human) accept the default name. Expected: `<name> (highlighted).pdf` next to the source; the source file's bytes and modification time are unchanged (compare a SHA-256 before/after).
2. Open the exported file in PdfReader itself (a different Fingerprint, so no app Highlights): pdf.js draws the annotation appearances on the canvas — the highlighted text is colored on the right pages (screenshot).
3. Load the exported file with pdf-lib in a Node one-off and confirm 3 `/Highlight` annotations (one per part) and 1 `/Popup`.
4. In the Save dialog choose the source file itself: the alert says it cannot overwrite the original; nothing is written.
5. Pending human: open the exported file in Microsoft Edge or Adobe Reader and confirm the highlights and the Note are visible.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/strings.ts src/preload/index.ts src/main/index.ts src/renderer/src/reader/ReaderView.tsx
git commit -m "feat: export a Document with its Highlights to a new PDF

Co-Authored-By: <your model>"
```

---

### Task 4: App icon

**Files:**
- Create: `scripts/make-icon.mjs`, `build/icon.png` (generated)
- Modify: `electron-builder.yml`, `src/main/windows.ts`, `package.json` (script)

**Interfaces:**
- Produces: `npm run icon` → writes `build/icon.png` (256×256 RGBA PNG); the installer, the exe and development windows use it.

The icon is drawn by a dependency-free script so it can be regenerated: a white page with a blue border, grey text lines, and a yellow highlight bar.

- [ ] **Step 1: Create `scripts/make-icon.mjs`**

```js
// Generates build/icon.png (256x256 RGBA) with no dependencies: a page, text lines and a highlight.
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const pixels = new Uint8Array(SIZE * SIZE * 4)

function blend(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const alpha = a / 255
  const baseAlpha = pixels[i + 3] / 255
  const outAlpha = alpha + baseAlpha * (1 - alpha)
  if (outAlpha === 0) return
  for (const [channel, value] of [
    [0, r],
    [1, g],
    [2, b]
  ]) {
    pixels[i + channel] = Math.round((value * alpha + pixels[i + channel] * baseAlpha * (1 - alpha)) / outAlpha)
  }
  pixels[i + 3] = Math.round(outAlpha * 255)
}

function roundedRect(x0, y0, x1, y1, radius, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = Math.max(x0 + radius, Math.min(x, x1 - 1 - radius))
      const cy = Math.max(y0 + radius, Math.min(y, y1 - 1 - radius))
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) blend(x, y, color)
    }
  }
}

roundedRect(50, 26, 214, 240, 18, [0, 0, 0, 45]) // shadow
roundedRect(42, 18, 206, 232, 18, [47, 98, 200, 255]) // border
roundedRect(48, 24, 200, 226, 14, [255, 255, 255, 255]) // page
for (const [y, right] of [
  [62, 176],
  [92, 168],
  [122, 180],
  [152, 160],
  [182, 172]
]) {
  roundedRect(72, y, right, y + 10, 5, [176, 184, 198, 255]) // text lines
}
roundedRect(64, 114, 188, 140, 6, [255, 214, 0, 150]) // highlight over the third line

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`wrote build/icon.png (${png.length} bytes)`)
```

- [ ] **Step 2: Add the script and generate the icon**

In `package.json` `scripts`, add `"icon": "node scripts/make-icon.mjs",`. Run:

```bash
npm run icon
```

Expected: `wrote build/icon.png (… bytes)`. View `build/icon.png` (e.g. with the Read tool): a white page with blue border, grey lines, yellow bar, transparent corners.

- [ ] **Step 3: Use the icon — `electron-builder.yml`**

Change `directories` and `win` to:

```yaml
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
win:
  target: nsis
  icon: build/icon.png
```

(keep the existing `appId`, `productName` and `nsis` section).

- [ ] **Step 4: Development window icon — `src/main/windows.ts`**

Change the electron import to `import { app, BrowserWindow } from 'electron'` and add to the `BrowserWindow` options in `create()`:

```ts
      // Packaged builds take the icon from the exe; in development point at the generated PNG.
      icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
```

- [ ] **Step 5: Typecheck, tests, build the installer**

`npm run typecheck` → 0. `npm test` → all pass. `npm run dist` → succeeds and no longer prints `default Electron icon is used`.

- [ ] **Step 6: Commit**

```bash
git add scripts/make-icon.mjs build/icon.png electron-builder.yml src/main/windows.ts package.json
git commit -m "feat: add the PdfReader app icon

Co-Authored-By: <your model>"
```

---

### Task 5: "Open with", Content-Security-Policy, DevTools gating, README

**Files:**
- Create: `build/installer.nsh`
- Modify: `electron-builder.yml`, `electron.vite.config.ts`, `src/main/index.ts`, `README.md`

**Interfaces:**
- Produces: the installer registers PdfReader under "Open with" for `.pdf` (per user, removed on uninstall) without becoming the default app; production pages carry a CSP meta tag; the View menu has no DevTools when packaged.

- [ ] **Step 1: Create `build/installer.nsh`**

```nsis
; "Open with" registration for .pdf, per user. Does NOT change the default app for .pdf:
; it only adds a ProgID and lists it under OpenWithProgids.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\PdfReader.pdf" "" "PDF Document"
  WriteRegStr HKCU "Software\Classes\PdfReader.pdf\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\PdfReader.pdf\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "PdfReader.pdf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\PdfReader.pdf"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "PdfReader.pdf"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
```

- [ ] **Step 2: Include it — `electron-builder.yml`**

Add to the `nsis` section:

```yaml
  include: build/installer.nsh
```

- [ ] **Step 3: Production-only CSP — replace `electron.vite.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/** Adds the CSP meta tag to production builds only; the dev server needs inline scripts for React refresh. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'pdfreader-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      )
    }
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react(), contentSecurityPolicy()] }
})
```

(`style-src 'unsafe-inline'` is required by React `style` attributes; pdf.js sets text-layer styles through the CSSOM, which CSP does not block.)

- [ ] **Step 4: DevTools only in development — `src/main/index.ts`**

In `setMenu`, replace the View submenu with:

```ts
      {
        label: t.menu.view,
        submenu: app.isPackaged ? [{ role: 'reload' }] : [{ role: 'reload' }, { role: 'toggleDevTools' }]
      }
```

- [ ] **Step 5: Replace `README.md`**

````markdown
# PdfReader

A personal desktop PDF reader for Windows. It remembers where you stopped reading, lets you highlight text and add notes, and never modifies your PDF files.

## Features

- Continuous scrolling; only pages near the viewport are rendered, so large PDFs stay smooth.
- Zoom: fit width, fit page, and steps from 25% to 400%.
- **Reading Position** saved automatically (page, position in the page, zoom). It is saved only after you scroll or zoom; opening a file alone writes nothing.
- **Highlights** in 5 colors (select text, then click a color or press `1`–`5`), with optional **Notes**. A highlight can cross a page break.
- Sidebar (`Ctrl+B`): **Outline** (bookmarks) and **Highlights** (sorted by position, filter by color, search ignoring case and Vietnamese diacritics).
- **Search** in the document (`Ctrl+F`).
- **Export** a new PDF that contains your highlights and notes as standard annotations; the original file is never changed.
- Files are identified by content, so renamed or moved files keep their data. When a file's content changes, the app offers to **Carry Over** the old position and highlights and re-anchors them by their text ([ADR 0001](docs/adr/0001-identify-documents-by-content.md)).
- Password-protected PDFs (the password is never stored), dark mode, and page inversion for night reading.
- Recent Documents with reading progress; one window per document; Vietnamese interface.

## Install

```bash
npm install
npm run dist
```

This builds `dist\PdfReader Setup <version>.exe`. Run it once:
- It installs PdfReader for the current user (`%LOCALAPPDATA%\Programs\PdfReader`), with no admin prompt.
- It creates a desktop shortcut and a Start menu entry, and starts the app.
- It adds PdfReader to **Open with** for `.pdf` files. It does not change your default PDF app; choose it yourself in Windows if you want.

Uninstall from Windows Settings > Apps. The installer is not code-signed, so SmartScreen may warn: click **More info**, then **Run anyway**.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+O` | Open a PDF |
| `Ctrl+H` | Recent Documents |
| `Ctrl+B` | Toggle the sidebar |
| `Ctrl+F` | Search; `Enter` / `Shift+Enter` or `F3` / `Shift+F3` for next / previous |
| `1`–`5` | Highlight the selected text (yellow, green, blue, pink, orange) |
| `Esc` | Cancel the selection, close search or menus |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / fit width |

## Where data is stored

One JSON file per document in the **Data Folder**, under `documents\<fingerprint>.json`. The Data Folder is chosen in this order:

1. `PDFREADER_DATA_DIR` (environment variable, for development)
2. The folder chosen in **Settings** (applies after restart; existing data is not moved)
3. `%OneDriveConsumer%\PdfReaderData` — your personal OneDrive, so every machine sees the same data
4. `%APPDATA%\PdfReader` — local only

Work/school OneDrive is never used, so personal reading data does not sync into an employer's tenant. OneDrive conflict copies are merged automatically (newest Reading Position wins; highlights are combined; deleted highlights stay deleted). See [ADR 0002](docs/adr/0002-per-document-json-in-onedrive.md).

Per-machine files in the app's user-data folder (`%APPDATA%\PdfReader` for the installed app, `%APPDATA%\pdf-reader` for `npm run dev`): `recent.json` (Recent Documents) and `settings.json` (Settings).

## Development

| Script | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` | Build into `out/` |
| `npm run preview` | Run the built app |
| `npm run dist` | Build the Windows installer into `dist\` |
| `npm run icon` | Regenerate `build/icon.png` |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |

- Keep test data out of your real Data Folder: `$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run dev`.
- If Electron starts as plain Node (`electron.app` is undefined), your shell has `ELECTRON_RUN_AS_NODE=1`; run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first.
- If `node_modules/electron/dist` has no `electron.exe` after `npm install`, run `node node_modules/electron/install.js`.
- `pdfjs-dist` is pinned to exactly `4.10.38`.
- Domain terms are defined in [CONTEXT.md](CONTEXT.md); decisions in [docs/adr](docs/adr/); plans in [docs/superpowers/plans](docs/superpowers/plans/).

## Project structure

```
src/
  shared/     Document data and merge rules, Settings types, IPC contract, UI strings, highlight colors
  main/       Electron main: Fingerprint, Data Folder, Document store, saver, Recent, Settings, export, windows
  preload/    Typed window.api (contextIsolation + sandbox)
  renderer/   React UI: reader (pdf.js), highlights, outline, search, export, home, settings
scripts/      make-icon.mjs
build/        icon.png, installer.nsh
docs/         ADRs and implementation plans
```
````

- [ ] **Step 6: Typecheck, tests, installer**

`npm run typecheck` → 0. `npm test` → all pass. `npm run dist` → succeeds.

- [ ] **Step 7: App check — CSP and DevTools**

Run the built app (`npx electron . "<pdf>" --remote-debugging-port=9222` after `npm run build`):
1. `document.querySelector('meta[http-equiv="Content-Security-Policy"]')` exists in the built page.
2. The PDF renders, text is selectable, search and export work — no "Content Security Policy" violations in the console (subscribe to `Runtime.consoleAPICalled` / `Log.entryAdded`).
3. `npm run dev` still works (no CSP in dev; React refresh works).
4. In `dist\win-unpacked\PdfReader.exe`, the View menu has no DevTools entry.
5. Pending human (requires installing): after running the installer, right-click a PDF > Open with > PdfReader is listed; the default PDF app is unchanged; uninstall removes the entry.

- [ ] **Step 8: Commit**

```bash
git add build/installer.nsh electron-builder.yml electron.vite.config.ts src/main/index.ts README.md
git commit -m "feat: register Open with, add production CSP, hide DevTools when installed

Co-Authored-By: <your model>"
```

---

### Task 6: End-to-end verification

**Files:** none expected. Fix failures in the owning file with a test where the cause is pure logic; commit fixes separately.

- [ ] **Step 1:** `npm run typecheck` → 0; `npm test` → all pass; `npm run dist` → installer builds with the custom icon.
- [ ] **Step 2:** In `dist\win-unpacked\PdfReader.exe` (isolated Data Folder): open a PDF, create Highlights with Notes, export, open the export: highlights visible; source file hash unchanged.
- [ ] **Step 3:** Export an encrypted PDF (if one can be produced): the alert says it cannot be exported; nothing is written.
- [ ] **Step 4:** List pending human checks: install/uninstall, "Open with" entry, desktop icon look, exported file in Edge/Adobe with the Note popup, SmartScreen prompt wording.
