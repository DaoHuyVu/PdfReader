import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { DocumentContext, WindowContext } from '../shared/ipc'
import { t } from '../shared/strings'

export interface DocumentWindowHooks {
  onBlur(): void
  onClosed(): void
}

/** The home window plus one window per Document. */
export class AppWindows {
  private readonly contexts = new Map<number, WindowContext>()
  private readonly documentWindows = new Map<string, BrowserWindow>()
  private home: BrowserWindow | null = null

  contextFor(webContentsId: number): WindowContext | undefined {
    return this.contexts.get(webContentsId)
  }

  showHome(): void {
    if (this.home && !this.home.isDestroyed()) {
      focus(this.home)
      return
    }
    this.home = this.create({ kind: 'home' }, t.appName)
    this.home.on('closed', () => {
      this.home = null
    })
  }

  /** Focuses the window already showing this Document. Returns false if there is none. */
  focusDocument(fingerprint: string): boolean {
    const win = this.documentWindows.get(fingerprint)
    if (!win || win.isDestroyed()) return false
    focus(win)
    return true
  }

  openDocument(context: DocumentContext, hooks: DocumentWindowHooks): void {
    const win = this.create(context, `${context.fileName} - ${t.appName}`)
    this.documentWindows.set(context.fingerprint, win)
    win.on('blur', hooks.onBlur)
    win.on('closed', () => {
      this.documentWindows.delete(context.fingerprint)
      hooks.onClosed()
    })
  }

  private create(context: WindowContext, title: string): BrowserWindow {
    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      title,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true
      }
    })
    const id = win.webContents.id
    this.contexts.set(id, context)
    win.on('closed', () => this.contexts.delete(id))
    win.on('page-title-updated', (event) => event.preventDefault())
    win.once('ready-to-show', () => win.show())
    if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
    return win
  }
}

function focus(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.focus()
}
