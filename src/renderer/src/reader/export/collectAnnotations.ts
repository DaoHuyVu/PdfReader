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
