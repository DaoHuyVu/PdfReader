import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RefProxy } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { buildTextIndex, type TextIndex, type TextRun } from './highlights/textIndex'
import type { PageSize } from './layout'
import type { OutlineNode, OutlineTarget } from './outline/outline'

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
    cached = Promise.all(Array.from({ length: doc.numPages }, (_, i) => loadPageTextRuns(doc, i)))
      .then((pages) => buildTextIndex(pages.flat()))
      .catch((err) => {
        textIndexCache.delete(doc)
        throw err
      })
    textIndexCache.set(doc, cached)
  }
  return cached
}

type RawOutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

async function resolveOutlineTarget(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<OutlineTarget | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const [ref, mode, ...args] = explicit as unknown[]
  let pageIndex: number
  if (Number.isInteger(ref)) pageIndex = ref as number
  else if (typeof ref === 'object' && ref !== null) pageIndex = await doc.getPageIndex(ref as RefProxy)
  else return null
  const name = typeof mode === 'object' && mode !== null ? (mode as { name?: unknown }).name : undefined
  const pdfTop = name === 'XYZ' ? args[1] : name === 'FitH' || name === 'FitBH' ? args[0] : null
  if (typeof pdfTop !== 'number') return { pageIndex, top: null }
  const page = await doc.getPage(pageIndex + 1)
  const [, top] = page.getViewport({ scale: 1 }).convertToViewportPoint(0, pdfTop)
  return { pageIndex, top }
}

async function toOutlineNode(doc: PDFDocumentProxy, item: RawOutlineItem): Promise<OutlineNode> {
  const [target, children] = await Promise.all([
    resolveOutlineTarget(doc, item.dest).catch(() => null),
    Promise.all((item.items as RawOutlineItem[]).map((child) => toOutlineNode(doc, child)))
  ])
  return { title: item.title, target, children }
}

/** The Document's outline (bookmarks) with each entry resolved to a page and position. */
export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const items = await doc.getOutline()
  if (!items) return []
  return Promise.all(items.map((item) => toOutlineNode(doc, item)))
}
