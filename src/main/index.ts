import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { access, readFile } from 'fs/promises'
import { basename, join } from 'path'
import {
  carryOver,
  hasCarryableContent,
  isHighlight,
  isReadingPosition,
  newerReading,
  readingProgress,
  removeHighlight,
  upsertHighlight
} from '../shared/documentData'
import { IPC, type DocumentContext, type OpenResult, type RecentView } from '../shared/ipc'
import { t } from '../shared/strings'
import { findPdfArg } from './argv'
import { documentsDir, resolveDataFolder } from './dataFolder'
import { DocumentStore } from './documentStore'
import { computeFingerprint } from './fingerprint'
import { PositionSaver } from './positionSaver'
import { findCarryOverSource, RecentStore } from './recent'
import { AppWindows } from './windows'

const windows = new AppWindows()
const store = new DocumentStore(documentsDir(resolveDataFolder(process.env)))
const recent = new RecentStore(join(app.getPath('userData'), 'recent.json'))
const saver = new PositionSaver(async (fingerprint, { reading, pageCount }) => {
  await store.update(fingerprint, (data) => ({ ...data, pageCount, reading: newerReading(data.reading, reading) }))
})

function logSaveError(err: unknown): void {
  console.error('Failed to save reading position', err)
}

// Opens in progress, by Fingerprint, so two quick opens of the same file share one window and one Carry Over prompt.
const pendingOpens = new Map<string, Promise<OpenResult>>()

async function openPath(path: string): Promise<OpenResult> {
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.pdf')) return { ok: false, reason: 'not-pdf' }
  try {
    await access(path)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  let fingerprint: string
  try {
    fingerprint = await computeFingerprint(path)
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  if (windows.focusDocument(fingerprint)) {
    await recordRecent(fingerprint, path)
    return { ok: true }
  }
  const pending = pendingOpens.get(fingerprint)
  if (pending) return pending
  const opening = openNewDocument(path, fingerprint).finally(() => pendingOpens.delete(fingerprint))
  pendingOpens.set(fingerprint, opening)
  return opening
}

async function openNewDocument(path: string, fingerprint: string): Promise<OpenResult> {
  await offerCarryOver(path, fingerprint)
  if (!windows.focusDocument(fingerprint)) {
    windows.openDocument(
      { kind: 'document', path, fileName: basename(path), fingerprint },
      {
        onBlur: () => void saver.flush(fingerprint).catch(logSaveError),
        onClosed: () => void saver.flush(fingerprint).catch(logSaveError)
      }
    )
  }
  await recordRecent(fingerprint, path)
  return { ok: true }
}

async function recordRecent(fingerprint: string, path: string): Promise<void> {
  try {
    await recent.add({ fingerprint, path, openedAt: Date.now() })
  } catch (err) {
    console.error('Failed to update recent documents', err)
  }
}

/**
 * Carry Over: when this path was last opened with a different Fingerprint (the file changed),
 * and the old data has a position or Highlights while the new data has neither, ask the user
 * whether to copy them over. Never throws; a failure only skips the offer.
 */
async function offerCarryOver(path: string, fingerprint: string): Promise<void> {
  try {
    const source = findCarryOverSource(await recent.list(), path, fingerprint)
    if (!source) return
    const [previous, current] = await Promise.all([store.load(source.fingerprint), store.load(fingerprint)])
    if (!hasCarryableContent(previous) || hasCarryableContent(current)) return
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: t.carryOver.title,
      message: t.carryOver.message(basename(path)),
      detail: t.carryOver.detail(previous.highlights.length),
      buttons: [t.carryOver.yes, t.carryOver.no],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return
    await store.update(fingerprint, (data) => carryOver(previous, data, Date.now()))
  } catch (err) {
    console.error('Failed to carry over document data', err)
  }
}

async function openAndReport(path: string): Promise<boolean> {
  const result = await openPath(path)
  if (!result.ok) dialog.showErrorBox(t.dialog.openFailedTitle, t.openError(path, result))
  return result.ok
}

async function showOpenDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: t.dialog.openTitle,
    filters: [{ name: t.dialog.pdfFilter, extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })
  for (const path of result.filePaths) await openAndReport(path)
}

async function listRecentViews(): Promise<RecentView[]> {
  const entries = await recent.list()
  return Promise.all(
    entries.map(async (entry) => {
      const exists = await access(entry.path).then(
        () => true,
        () => false
      )
      const data = await store.load(entry.fingerprint).catch((err) => {
        console.error('Failed to load document data', entry.fingerprint, err)
        return null
      })
      return {
        ...entry,
        fileName: basename(entry.path),
        exists,
        progress: data ? readingProgress(data.reading, data.pageCount) : null
      }
    })
  )
}

function documentOf(event: IpcMainEvent | IpcMainInvokeEvent): DocumentContext | null {
  const context = windows.contextFor(event.sender.id)
  return context?.kind === 'document' ? context : null
}

function requireDocument(event: IpcMainInvokeEvent): DocumentContext {
  const context = documentOf(event)
  if (!context) throw new Error('This window has no document')
  return context
}

function registerIpc(): void {
  ipcMain.handle(IPC.getContext, (event) => windows.contextFor(event.sender.id) ?? { kind: 'home' })
  ipcMain.handle(IPC.readDocumentBytes, (event) => readFile(requireDocument(event).path))
  ipcMain.handle(IPC.loadDocumentData, (event) => store.load(requireDocument(event).fingerprint))
  ipcMain.on(IPC.reportReadingPosition, (event, reading: unknown, pageCount: unknown) => {
    const context = documentOf(event)
    if (!context || !isReadingPosition(reading) || !Number.isInteger(pageCount) || (pageCount as number) < 0) return
    saver.report(context.fingerprint, { reading, pageCount: pageCount as number })
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || !win.isFocused()) {
      void saver.flush(context.fingerprint).catch(logSaveError)
    }
  })
  ipcMain.handle(IPC.saveHighlight, async (event, highlight: unknown) => {
    const { fingerprint } = requireDocument(event)
    if (!isHighlight(highlight)) throw new Error('Invalid highlight')
    await store.update(fingerprint, (data) => upsertHighlight(data, highlight))
  })
  ipcMain.handle(IPC.deleteHighlight, async (event, id: unknown) => {
    const { fingerprint } = requireDocument(event)
    if (typeof id !== 'string' || id === '') throw new Error('Invalid highlight id')
    await store.update(fingerprint, (data) => removeHighlight(data, id, Date.now()))
  })
  ipcMain.handle(IPC.openFileDialog, () => showOpenDialog())
  ipcMain.handle(IPC.openPath, (_event, path: string) => openPath(path))
  ipcMain.handle(IPC.listRecent, () => listRecentViews())
}

function setMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: t.menu.file,
        submenu: [
          { label: t.menu.open, accelerator: 'CmdOrCtrl+O', click: () => void showOpenDialog() },
          { label: t.menu.recent, accelerator: 'CmdOrCtrl+H', click: () => windows.showHome() },
          { type: 'separator' },
          { label: t.menu.quit, role: 'quit' }
        ]
      },
      {
        label: t.menu.view,
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }]
      }
    ])
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const path = findPdfArg(argv)
    if (path) void openAndReport(path)
    else windows.showHome()
  })

  app.whenReady().then(async () => {
    registerIpc()
    setMenu()
    const path = findPdfArg(process.argv)
    if (!path || !(await openAndReport(path))) windows.showHome()
  })

  app.on('window-all-closed', () => app.quit())

  let quitFlushRounds = 0
  app.on('will-quit', (event) => {
    if (!saver.hasPending()) return
    quitFlushRounds++
    if (quitFlushRounds > 3) {
      console.error('Quitting with unsaved reading positions')
      return
    }
    event.preventDefault()
    void saver
      .flushAll()
      .catch(logSaveError)
      .finally(() => app.quit())
  })
}
