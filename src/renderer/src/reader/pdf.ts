import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { buildTextIndex, type TextIndex, type TextRun } from './highlights/textIndex'
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
