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
