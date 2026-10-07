import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  HIGHLIGHT_COLORS,
  type Highlight,
  type HighlightColor,
  type ReadingPosition,
  type ZoomSetting
} from '../../../shared/documentData'
import { t } from '../../../shared/strings'
import { highlightScrollTop, highlightsByPage } from './highlights/geometry'
import { HighlightLayer } from './highlights/HighlightLayer'
import { HighlightMenu } from './highlights/HighlightMenu'
import { HighlightPanel } from './highlights/HighlightPanel'
import { reanchorCarried } from './highlights/reanchor'
import { hitTestHighlight, isEditableTarget, readSelection, type PendingSelection } from './highlights/selection'
import { SelectionToolbar } from './highlights/SelectionToolbar'
import { useHighlights } from './highlights/useHighlights'
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
import { getDocumentTextIndex, loadPdf, type LoadedPdf } from './pdf'
import { PdfPage } from './PdfPage'
import { createThrottle } from './throttle'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; pdf: LoadedPdf; initial: ReadingPosition | null; highlights: Highlight[] }

const NO_HIGHLIGHTS: Highlight[] = []

export function ReaderView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const dataPromise = window.api.loadDocumentData().then(
        (data) => data,
        (err) => {
          console.error('Failed to load document data', err)
          return null
        }
      )
      try {
        const bytes = await window.api.readDocumentBytes()
        const pdf = await loadPdf(bytes)
        const data = await dataPromise
        if (!cancelled) {
          setState({ status: 'ready', pdf, initial: data?.reading ?? null, highlights: data?.highlights ?? NO_HIGHLIGHTS })
        }
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
  return <ReaderSurface pdf={state.pdf} initial={state.initial} initialHighlights={state.highlights} />
}

interface ReaderSurfaceProps {
  pdf: LoadedPdf
  initial: ReadingPosition | null
  initialHighlights: Highlight[]
}

function ReaderSurface({ pdf, initial, initialHighlights }: ReaderSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [zoom, setZoom] = useState<ZoomSetting>(initial?.zoom ?? { mode: 'fit-width' })
  // The page + ratio at the top of the viewport; kept across zoom and resize.
  const anchorRef = useRef<PagePosition>(initial ?? { pageIndex: 0, offsetRatio: 0 })
  const restoredRef = useRef(false)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // The scrollTop the app itself just set (restore after first measure, zoom change, or
  // resize); the next 'scroll' event caused by that assignment must not be treated as a
  // user scroll and must not report a Reading Position.
  const suppressedScrollTopRef = useRef<number | null>(null)
  // The zoom value in effect at mount, so the zoom-sync effect below does not report a
  // position just because it ran once after mount.
  const initialZoomRef = useRef(zoom)

  const onHighlightError = useCallback(() => alert(t.highlight.saveFailed), [])
  const { highlights, save, remove } = useHighlights(initialHighlights, onHighlightError)
  const [menu, setMenu] = useState<{ id: string; anchor: { x: number; y: number } } | null>(null)
  const menuHighlight = menu ? (highlights.find((h) => h.id === menu.id) ?? null) : null
  const closeMenu = useCallback(() => setMenu(null), [])

  // Kept up to date every render so the re-anchor effect below reads the CURRENT Highlights
  // (not a stale mount-time copy) once the text index has finished building.
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights

  // Carried Highlights came from an earlier version of this file; find their text again. Building
  // the text index can take a while, during which the user may edit or delete a carried Highlight;
  // reanchorCarried re-checks each one against the current state so that edit/delete is not lost.
  useEffect(() => {
    const carriedIds = new Set(initialHighlights.filter((h) => h.status === 'carried').map((h) => h.id))
    if (carriedIds.size === 0) return
    let cancelled = false
    getDocumentTextIndex(pdf.doc)
      .then((index) => {
        if (cancelled) return
        const now = Date.now()
        for (const highlight of reanchorCarried(index, highlightsRef.current, carriedIds, now)) save(highlight)
      })
      .catch((err) => console.error('Failed to re-anchor highlights', err))
    return () => {
      cancelled = true
    }
  }, [pdf.doc, initialHighlights, save])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  useEffect(() => {
    if (focusedId === null) return
    const timer = setTimeout(() => setFocusedId(null), 1500)
    return () => clearTimeout(timer)
  }, [focusedId])

  const goToHighlight = (highlight: Highlight) => {
    const element = scrollRef.current
    const top = highlightScrollTop(highlight, boxes, scale)
    if (!element || top === null) return
    element.scrollTop = top
    setFocusedId(highlight.id)
  }

  const byPage = useMemo(() => highlightsByPage(highlights), [highlights])
  const [selection, setSelection] = useState<PendingSelection | null>(null)

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
    suppressedScrollTopRef.current = element.scrollTop
    setScrollTop(element.scrollTop)
    restoredRef.current = true
  }, [boxes, measured])

  useEffect(() => {
    if (restoredRef.current && zoom !== initialZoomRef.current) {
      report.call({ ...anchorRef.current, zoom, updatedAt: Date.now() })
    }
  }, [zoom, report])

  // A scale change (zoom or a resize in a fit mode) rebuilds the text layer's DOM, destroying
  // the window selection and leaving any open toolbar anchored to a stale position.
  useEffect(() => {
    setSelection(null)
  }, [scale])

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

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  const createHighlight = useCallback(
    (color: HighlightColor) => {
      if (!selection) return
      const now = Date.now()
      save({
        id: crypto.randomUUID(),
        color,
        note: null,
        text: selection.text,
        parts: selection.parts,
        createdAt: now,
        updatedAt: now
      })
      clearSelection()
    },
    [selection, save, clearSelection]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey) {
        if (event.key === '=' || event.key === '+') setZoom(stepZoom(scale, 1))
        else if (event.key === '-') setZoom(stepZoom(scale, -1))
        else if (event.key === '0') setZoom({ mode: 'fit-width' })
        else if (event.key === 'b' || event.key === 'B') setSidebarOpen((open) => !open)
        else return
        event.preventDefault()
        return
      }
      if (event.altKey || event.metaKey || isEditableTarget(event.target) || !selection) return
      const key = Number(event.key)
      if (Number.isInteger(key) && key >= 1 && key <= HIGHLIGHT_COLORS.length) {
        event.preventDefault()
        createHighlight(HIGHLIGHT_COLORS[key - 1])
      } else if (event.key === 'Escape') {
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scale, selection, createHighlight, clearSelection])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    setSelection(null)
    const suppressed = suppressedScrollTopRef.current
    suppressedScrollTopRef.current = null
    if (suppressed !== null && suppressed === element.scrollTop) {
      setScrollTop(element.scrollTop)
      return
    }
    setScrollTop(element.scrollTop)
    if (!restoredRef.current) return
    const position = positionFromScroll(element.scrollTop, boxes)
    anchorRef.current = position
    report.call({ ...position, zoom: zoomRef.current, updatedAt: Date.now() })
  }

  const onMouseUp = (event: ReactMouseEvent) => {
    const element = scrollRef.current
    if (!element) return
    const pending = readSelection(element, scale)
    setSelection(pending)
    if (pending) {
      setMenu(null)
      return
    }
    const hit = hitTestHighlight(event.target, event.clientX, event.clientY, highlights, scale)
    setMenu(hit ? { id: hit.id, anchor: { x: event.clientX, y: event.clientY } } : null)
  }

  const range = visiblePageRange(scrollTop, viewport.height, boxes)
  const current = currentPageIndex(scrollTop, viewport.height, boxes)
  const activeId = menu?.id ?? focusedId

  return (
    <div className="reader">
      <div className="toolbar">
        <button
          className={sidebarOpen ? 'active' : ''}
          title={t.highlight.togglePanel}
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>
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
      <div className="reader-body">
        {sidebarOpen && (
          <aside className="sidebar">
            <HighlightPanel highlights={highlights} activeId={activeId} onSelect={goToHighlight} />
          </aside>
        )}
        <div className="scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp}>
          <div className="pages" style={{ height: totalHeight(boxes), width: Math.max(viewport.width, contentWidth(boxes)) }}>
            {boxes.map((box, pageIndex) => (
              <PdfPage
                key={pageIndex}
                doc={pdf.doc}
                pageIndex={pageIndex}
                box={box}
                scale={scale}
                visible={pageIndex >= range.first && pageIndex <= range.last}
              >
                <HighlightLayer
                  highlights={byPage.get(pageIndex) ?? NO_HIGHLIGHTS}
                  pageIndex={pageIndex}
                  scale={scale}
                  activeId={activeId}
                />
              </PdfPage>
            ))}
          </div>
        </div>
      </div>
      {selection && <SelectionToolbar anchor={selection.anchor} onPick={createHighlight} />}
      {menu && menuHighlight && (
        <HighlightMenu
          key={menuHighlight.id}
          highlight={menuHighlight}
          anchor={menu.anchor}
          onChange={save}
          onDelete={() => {
            remove(menuHighlight.id)
            closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
