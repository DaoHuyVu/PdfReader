import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { access, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { newerReading, readingProgress, type ReadingPosition } from '../shared/documentData'
import { IPC, type DocumentContext, type OpenResult, type RecentView } from '../shared/ipc'
import { t } from '../shared/strings'
import { findPdfArg } from './argv'
import { documentsDir, resolveDataFolder } from './dataFolder'
import { DocumentStore } from './documentStore'
import { computeFingerprint } from './fingerprint'
import { PositionSaver } from './positionSaver'
import { RecentStore } from './recent'
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

async function openPath(path: string): Promise<OpenResult> {
  if (!path.toLowerCase().endsWith('.pdf')) return { ok: false, reason: 'not-pdf' }
  try {
    await access(path)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    const fingerprint = await computeFingerprint(path)
    if (!windows.focusDocument(fingerprint)) {
      windows.openDocument(
        { kind: 'document', path, fileName: basename(path), fingerprint },
        {
          onBlur: () => void saver.flush(fingerprint).catch(logSaveError),
          onClosed: () => void saver.flush(fingerprint).catch(logSaveError)
        }
      )
    }
    try {
      await recent.add({ fingerprint, path, openedAt: Date.now() })
    } catch (err) {
      console.error('Failed to update recent documents', err)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
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
  ipcMain.on(IPC.reportReadingPosition, (event, reading: ReadingPosition, pageCount: number) => {
    const context = documentOf(event)
    if (!context) return
    saver.report(context.fingerprint, { reading, pageCount })
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || !win.isFocused()) {
      void saver.flush(context.fingerprint).catch(logSaveError)
    }
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
