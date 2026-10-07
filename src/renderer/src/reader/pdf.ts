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
