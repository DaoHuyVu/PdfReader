import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { useEffect, useRef } from 'react'
import { canvasPixelRatio, type PageBox } from './layout'

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

  return (
    <div className="page" style={{ top: box.top, width: box.width, height: box.height }}>
      {visible && <canvas ref={canvasRef} style={{ width: box.width, height: box.height }} />}
    </div>
  )
}
