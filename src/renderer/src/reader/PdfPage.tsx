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
