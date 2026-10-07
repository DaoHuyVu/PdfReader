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
