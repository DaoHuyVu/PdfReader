# Reader Features Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings screen (Data Folder, theme, page inversion), dark mode, an outline sidebar tab, Ctrl+F search, password-protected PDFs, a notice for PDFs without text, and the reader polish items deferred from Plan 1.

**Architecture:** Settings live per machine in `<userData>\settings.json`, owned by main (validated, atomic writes) and pushed to every window over IPC when they change. The Data Folder chosen in Settings takes effect after a restart (main builds its `DocumentStore` once at startup). The renderer applies the theme by toggling a `dark` class on `<html>`. Search and outline reuse Plan 2's text index and sidebar.

**Tech Stack:** Electron 38, electron-vite 4, React 19, TypeScript 5.9 strict, pdfjs-dist 4.10.38, Vitest 3.

**Prerequisite:** Plan 2 (`docs/superpowers/plans/2026-10-07-highlights-notes.md`) is complete. In particular these exist: `getDocumentTextIndex`, `findAllText`, `matchToParts`, `SCROLL_MARGIN`, the sidebar (`aside.sidebar` with `HighlightPanel`) and `PdfPage` `children`. Read `CONTEXT.md` first.

## Global Constraints

- Platform: Windows 10/11 x64. Paths are Windows paths; compare paths case-insensitively.
- The app NEVER writes to, renames, or deletes the user's PDF files.
- Data Folder resolution, in this order: env var `PDFREADER_DATA_DIR`; the folder chosen in Settings; `%OneDriveConsumer%\PdfReaderData`; `%APPDATA%\PdfReader`. Work/school OneDrive is never used. A changed Data Folder applies after restart; existing data is not moved automatically.
- Settings are per machine at `<userData>\settings.json`: `{ dataFolder: string | null, theme: 'system' | 'light' | 'dark', invertPages: boolean }`, written atomically.
- Passwords are never stored or logged.
- Search ignores case and Vietnamese diacritics (same folding as Plan 2's `foldText`).
- Opening a Document writes nothing by itself.
- All user-visible text lives in `src/shared/strings.ts`, in Vietnamese.
- `pdfjs-dist` is pinned to exactly `4.10.38`.
- `npm run typecheck` and `npm test` must pass at the end of every task.
- Every commit message ends with a `Co-Authored-By:` line naming the model that made the commit.

## Verification environment (for app checks)

Same as Plan 2: clear `ELECTRON_RUN_AS_NODE` for Electron children; isolated `PDFREADER_DATA_DIR` (except in Task 2's Data Folder check, which needs it unset — use a scratch `settings.json` instead); back up and restore `%APPDATA%\pdf-reader\recent.json` and `%APPDATA%\pdf-reader\settings.json`; `npm run build`, then `npx electron . ["<pdf>"] --remote-debugging-port=9222`, driven through the Chrome DevTools Protocol; kill every `electron.exe` before and after. Scratch files go in `.superpowers/sdd/tmp/`.

## File Structure

```
src/shared/settings.ts                 NEW Settings types, defaults, Data Folder info types
src/shared/ipc.ts                      + settings, data folder, relaunch, flush channels
src/shared/strings.ts                  + settings, outline, search, password, reader strings
src/main/settings.ts                   NEW parse/patch validation + SettingsStore
src/main/dataFolder.ts                 + configured folder, describeDataFolder
src/main/index.ts                      startup from settings, settings IPC, flush signal
src/preload/index.ts                   + settings API, onSettingsChanged, flushReadingPosition
src/renderer/src/App.tsx               settings, theme, Settings screen routing
src/renderer/src/settings/useSettings.ts      NEW settings state + theme class
src/renderer/src/settings/SettingsView.tsx    NEW Settings screen
src/renderer/src/home/HomeView.tsx     + Settings button
src/renderer/src/reader/outline/outline.ts    NEW outline types + scroll target (pure)
src/renderer/src/reader/outline/OutlinePanel.tsx  NEW
src/renderer/src/reader/search/search.ts      NEW search hits (pure)
src/renderer/src/reader/search/SearchBar.tsx  NEW
src/renderer/src/reader/search/SearchLayer.tsx NEW
src/renderer/src/reader/PasswordPrompt.tsx    NEW
src/renderer/src/reader/pdf.ts         + password, outline, text detection, parallel page sizes
src/renderer/src/reader/ReaderView.tsx + invert, sidebar tabs, search, password, notice, polish
src/renderer/src/styles.css            + dark theme, settings, outline, search, modal, banner
```

---

### Task 1: Settings model, store and Data Folder override

**Files:**
- Create: `src/shared/settings.ts`, `src/main/settings.ts`, `src/main/settings.test.ts`
- Modify: `src/main/dataFolder.ts`, `src/main/dataFolder.test.ts`

**Interfaces:**
- Produces from `src/shared/settings.ts`:
  - `THEMES = ['system', 'light', 'dark'] as const`, `type Theme`
  - `interface Settings { dataFolder: string | null; theme: Theme; invertPages: boolean }`
  - `DEFAULT_SETTINGS: Settings` (`{ dataFolder: null, theme: 'system', invertPages: false }`)
  - `type DataFolderSource = 'env' | 'settings' | 'onedrive' | 'appdata'`
  - `interface DataFolderInfo { path: string; source: DataFolderSource; restartNeeded: boolean }`
- Produces from `src/main/settings.ts`:
  - `parseSettings(raw: unknown): Settings` (lenient: invalid fields fall back to defaults)
  - `applySettingsPatch(current: Settings, patch: unknown): Settings` (strict: throws on unknown keys or invalid values)
  - `class SettingsStore { constructor(filePath: string); load(): Promise<Settings>; update(patch: unknown): Promise<Settings> }`
- Produces from `src/main/dataFolder.ts`:
  - `describeDataFolder(env, configured?: string | null): { path: string; source: DataFolderSource }`
  - `resolveDataFolder(env, configured?: string | null): string` (now takes the Settings folder)

- [ ] **Step 1: Write the failing tests**

`src/main/settings.test.ts`:

```ts
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { applySettingsPatch, parseSettings, SettingsStore } from './settings'

describe('parseSettings', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ dataFolder: 'relative\\dir', theme: 'neon', invertPages: 'yes' })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values', () => {
    expect(parseSettings({ dataFolder: 'D:\\Data', theme: 'dark', invertPages: true })).toEqual({
      dataFolder: 'D:\\Data',
      theme: 'dark',
      invertPages: true
    })
  })
})

describe('applySettingsPatch', () => {
  it('applies valid fields only', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { theme: 'light' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' })
    expect(applySettingsPatch({ ...DEFAULT_SETTINGS, dataFolder: 'D:\\x' }, { dataFolder: null }).dataFolder).toBeNull()
  })

  it('rejects unknown keys and invalid values', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { color: 'red' })).toThrow(/Unknown setting/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { dataFolder: 'relative' })).toThrow(/absolute/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { theme: 'neon' })).toThrow(/theme/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { invertPages: 1 })).toThrow(/invertPages/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, 'x')).toThrow(/object/)
  })
})

describe('SettingsStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfreader-settings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads defaults when the file is missing or corrupt', async () => {
    expect(await new SettingsStore(join(dir, 'settings.json')).load()).toEqual(DEFAULT_SETTINGS)
    await writeFile(join(dir, 'settings.json'), '{ broken')
    expect(await new SettingsStore(join(dir, 'settings.json')).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates atomically and serializes them', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    await Promise.all([store.update({ theme: 'dark' }), store.update({ invertPages: true })])
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({
      dataFolder: null,
      theme: 'dark',
      invertPages: true
    })
    expect(await readdir(dir)).toEqual(['settings.json'])
  })

  it('rejects an invalid patch without writing', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    await expect(store.update({ theme: 'neon' })).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})
```

In `src/main/dataFolder.test.ts`, change the import to `import { describeDataFolder, documentsDir, resolveDataFolder } from './dataFolder'` and append:

```ts
describe('resolveDataFolder with a Settings folder', () => {
  it('uses the Settings folder after the env override and before OneDrive', () => {
    const env = { OneDriveConsumer: 'C:\\Users\\me\\OneDrive', APPDATA: 'C:\\AppData' }
    expect(resolveDataFolder(env, 'E:\\Sync\\Reader')).toBe('E:\\Sync\\Reader')
    expect(resolveDataFolder({ ...env, PDFREADER_DATA_DIR: 'X:\\dev' }, 'E:\\Sync\\Reader')).toBe('X:\\dev')
    expect(resolveDataFolder(env, null)).toBe(join('C:\\Users\\me\\OneDrive', 'PdfReaderData'))
  })
})

describe('describeDataFolder', () => {
  it('names where the folder came from', () => {
    expect(describeDataFolder({ PDFREADER_DATA_DIR: 'X:\\dev' }).source).toBe('env')
    expect(describeDataFolder({ APPDATA: 'C:\\AppData' }, 'E:\\R').source).toBe('settings')
    expect(describeDataFolder({ OneDriveConsumer: 'C:\\OD', APPDATA: 'C:\\AppData' }).source).toBe('onedrive')
    expect(describeDataFolder({ APPDATA: 'C:\\AppData' })).toEqual({ path: join('C:\\AppData', 'PdfReader'), source: 'appdata' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/settings.test.ts src/main/dataFolder.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Create `src/shared/settings.ts`**

```ts
export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/** Per-machine preferences, stored by main in <userData>\settings.json. */
export interface Settings {
  /** Data Folder chosen by the user, or null for the default. Applies after restart. */
  dataFolder: string | null
  theme: Theme
  /** Invert page colors for reading at night. */
  invertPages: boolean
}

export const DEFAULT_SETTINGS: Settings = { dataFolder: null, theme: 'system', invertPages: false }

export type DataFolderSource = 'env' | 'settings' | 'onedrive' | 'appdata'

export interface DataFolderInfo {
  /** The Data Folder the current settings point to. */
  path: string
  source: DataFolderSource
  /** True when `path` differs from the folder this running app uses. */
  restartNeeded: boolean
}
```

- [ ] **Step 4: Create `src/main/settings.ts`**

```ts
import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname, isAbsolute } from 'path'
import { DEFAULT_SETTINGS, THEMES, type Settings, type Theme } from '../shared/settings'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isTheme = (value: unknown): value is Theme => (THEMES as readonly unknown[]).includes(value)
const isFolder = (value: unknown): value is string => typeof value === 'string' && isAbsolute(value)

export function parseSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {}
  return {
    dataFolder: isFolder(r.dataFolder) ? r.dataFolder : DEFAULT_SETTINGS.dataFolder,
    theme: isTheme(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    invertPages: r.invertPages === true
  }
}

export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (!isRecord(patch)) throw new Error('Settings patch must be an object')
  const next: Settings = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'dataFolder') {
      if (value !== null && !isFolder(value)) throw new Error('dataFolder must be an absolute path or null')
      next.dataFolder = value
    } else if (key === 'theme') {
      if (!isTheme(value)) throw new Error(`Invalid theme: ${String(value)}`)
      next.theme = value
    } else if (key === 'invertPages') {
      if (typeof value !== 'boolean') throw new Error('invertPages must be a boolean')
      next.invertPages = value
    } else {
      throw new Error(`Unknown setting: ${key}`)
    }
  }
  return next
}

/** Settings for this machine. Updates are serialized and written atomically. */
export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    try {
      return parseSettings(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  update(patch: unknown): Promise<Settings> {
    const run = this.queue.then(() => this.updateUnlocked(patch))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async updateUnlocked(patch: unknown): Promise<Settings> {
    const next = applySettingsPatch(await this.load(), patch)
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8')
    try {
      await rename(tempPath, this.filePath)
    } catch (err) {
      await unlink(tempPath).catch(() => undefined)
      throw err
    }
    return next
  }
}
```

- [ ] **Step 5: Update `src/main/dataFolder.ts`**

Replace the file with:

```ts
import { join } from 'path'
import type { DataFolderSource } from '../shared/settings'

/**
 * The Data Folder holds all Document data. See docs/adr/0002.
 * Order: PDFREADER_DATA_DIR, the folder chosen in Settings, personal OneDrive, local APPDATA.
 * Work/school OneDrive (%OneDrive% / %OneDriveCommercial%) is deliberately ignored so personal
 * reading data never syncs into an employer tenant.
 */
export function describeDataFolder(
  env: Record<string, string | undefined>,
  configured: string | null = null
): { path: string; source: DataFolderSource } {
  if (env.PDFREADER_DATA_DIR) return { path: env.PDFREADER_DATA_DIR, source: 'env' }
  if (configured) return { path: configured, source: 'settings' }
  if (env.OneDriveConsumer) return { path: join(env.OneDriveConsumer, 'PdfReaderData'), source: 'onedrive' }
  if (env.APPDATA) return { path: join(env.APPDATA, 'PdfReader'), source: 'appdata' }
  throw new Error('Cannot resolve the data folder: neither OneDriveConsumer nor APPDATA is set')
}

export function resolveDataFolder(env: Record<string, string | undefined>, configured: string | null = null): string {
  return describeDataFolder(env, configured).path
}

export function documentsDir(dataFolder: string): string {
  return join(dataFolder, 'documents')
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/settings.test.ts src/main/dataFolder.test.ts` → PASS.
Run: `npm run typecheck` → 0. `npm test` → all pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/settings.ts src/main/settings.ts src/main/settings.test.ts src/main/dataFolder.ts src/main/dataFolder.test.ts
git commit -m "feat: add per-machine Settings with a configurable Data Folder

Co-Authored-By: <your model>"
```

---

### Task 2: Settings over IPC and Settings-aware startup

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/strings.ts`, `src/preload/index.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: Task 1 (`SettingsStore`, `describeDataFolder`, `resolveDataFolder`, `Settings`, `DataFolderInfo`).
- Produces:
  - IPC channels: `getSettings: 'settings:get'`, `updateSettings: 'settings:update'`, `settingsChanged: 'settings:changed'` (main → renderer event), `getDataFolderInfo: 'settings:data-folder'`, `chooseDataFolder: 'settings:choose-data-folder'`, `relaunchApp: 'app:relaunch'`, `flushReadingPosition: 'document:flush-reading-position'`
  - `PdfReaderApi` additions:
    - `getSettings(): Promise<Settings>`
    - `updateSettings(patch: Partial<Settings>): Promise<Settings>`
    - `onSettingsChanged(listener: (settings: Settings) => void): () => void` (returns unsubscribe)
    - `getDataFolderInfo(): Promise<DataFolderInfo>`
    - `chooseDataFolder(): Promise<string | null>`
    - `relaunchApp(): void`
    - `flushReadingPosition(): void` (used by Task 8)
  - All Plan 3 strings (`t.settings`, `t.outline`, `t.search`, `t.password`, new `t.reader.*` keys, `t.highlight.tab`).

- [ ] **Step 1: IPC contract — `src/shared/ipc.ts`**

Add `import type { DataFolderInfo, Settings } from './settings'`. Add to `IPC`:

```ts
  flushReadingPosition: 'document:flush-reading-position',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  getDataFolderInfo: 'settings:data-folder',
  chooseDataFolder: 'settings:choose-data-folder',
  relaunchApp: 'app:relaunch',
```

Add to `PdfReaderApi`:

```ts
  flushReadingPosition(): void
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  /** Subscribes to Settings changes made in any window; returns an unsubscribe function. */
  onSettingsChanged(listener: (settings: Settings) => void): () => void
  getDataFolderInfo(): Promise<DataFolderInfo>
  chooseDataFolder(): Promise<string | null>
  relaunchApp(): void
```

- [ ] **Step 2: Preload — `src/preload/index.ts`**

Change the electron import to `import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'`, add `import type { Settings } from '../shared/settings'`, and add to `api`:

```ts
  flushReadingPosition: () => ipcRenderer.send(IPC.flushReadingPosition),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  onSettingsChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, settings: Settings) => listener(settings)
    ipcRenderer.on(IPC.settingsChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.settingsChanged, handler)
    }
  },
  getDataFolderInfo: () => ipcRenderer.invoke(IPC.getDataFolderInfo),
  chooseDataFolder: () => ipcRenderer.invoke(IPC.chooseDataFolder),
  relaunchApp: () => ipcRenderer.send(IPC.relaunchApp),
```

- [ ] **Step 3: Strings — `src/shared/strings.ts`**

3a. In `reader`, add these keys after `fitPage`:

```ts
    toggleSidebar: 'Thanh bên (Ctrl+B)',
    invertPages: 'Đảo màu trang',
    passwordCancelled: 'File có mật khẩu nên chưa mở.',
    noTextLayer: 'File không có lớp text (có thể là bản scan), nên không highlight hay tìm kiếm được.',
    dismiss: 'Đóng',
    emptyDocument: 'File PDF không có trang nào.'
```

3b. In `highlight`, replace the line `togglePanel: 'Danh sách highlight (Ctrl+B)',` with `tab: 'Highlight',`.

3c. After `highlight: { … }`, add:

```ts
  outline: {
    tab: 'Mục lục',
    empty: 'File này không có mục lục.',
    expand: 'Mở rộng',
    collapse: 'Thu gọn'
  },
  search: {
    open: 'Tìm (Ctrl+F)',
    placeholder: 'Tìm trong tài liệu…',
    count: (current: number, total: number) => `${current} / ${total}`,
    none: 'Không thấy',
    searching: 'Đang tìm…',
    previous: 'Kết quả trước (Shift+Enter)',
    next: 'Kết quả tiếp (Enter)',
    close: 'Đóng (Esc)'
  },
  password: {
    title: 'File có mật khẩu',
    need: 'Nhập mật khẩu để mở file này.',
    incorrect: 'Sai mật khẩu. Thử lại.',
    ok: 'Mở',
    cancel: 'Hủy'
  },
  settings: {
    open: 'Cài đặt',
    title: 'Cài đặt',
    back: '← Tài liệu gần đây',
    dataFolder: 'Thư mục dữ liệu',
    dataFolderHelp:
      'Nơi lưu vị trí đọc và highlight. Chọn một thư mục trong OneDrive cá nhân để đồng bộ giữa các máy.',
    source: {
      env: 'Đang dùng biến môi trường PDFREADER_DATA_DIR',
      settings: 'Thư mục bạn đã chọn',
      onedrive: 'OneDrive cá nhân (mặc định)',
      appdata: 'Chỉ trên máy này (mặc định, vì không có OneDrive cá nhân)'
    },
    choose: 'Chọn thư mục…',
    chooseTitle: 'Chọn thư mục dữ liệu',
    useDefault: 'Dùng mặc định',
    restartNeeded: 'Khởi động lại PdfReader để dùng thư mục mới. Dữ liệu cũ không tự chuyển sang.',
    restart: 'Khởi động lại',
    theme: 'Giao diện',
    themes: { system: 'Theo Windows', light: 'Sáng', dark: 'Tối' },
    invertPages: 'Đảo màu trang PDF (đọc ban đêm)'
  }
```

3d. In `src/renderer/src/reader/ReaderView.tsx`, the sidebar toggle button uses `t.highlight.togglePanel`; change it to `t.reader.toggleSidebar` so typecheck passes.

- [ ] **Step 4: Main — `src/main/index.ts`**

4a. Imports:
- add `type OpenDialogOptions` to the `electron` import;
- change the dataFolder import to `import { describeDataFolder, documentsDir, resolveDataFolder } from './dataFolder'`;
- add `import { SettingsStore } from './settings'`;
- add `import { DEFAULT_SETTINGS, type DataFolderInfo, type Settings } from '../shared/settings'`.

4b. Replace the line

```ts
const store = new DocumentStore(documentsDir(resolveDataFolder(process.env)))
```

with

```ts
const settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
let settings: Settings = { ...DEFAULT_SETTINGS }
// The Data Folder this running app uses; chosen once at startup (a change needs a restart).
let activeDataFolder = ''
let store: DocumentStore
```

4c. Add these functions before `registerIpc`:

```ts
function broadcastSettings(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.settingsChanged, settings)
  }
}

async function applySettings(patch: unknown): Promise<Settings> {
  settings = await settingsStore.update(patch)
  broadcastSettings()
  return settings
}

function dataFolderInfo(): DataFolderInfo {
  const described = describeDataFolder(process.env, settings.dataFolder)
  return { ...described, restartNeeded: described.path.toLowerCase() !== activeDataFolder.toLowerCase() }
}
```

4d. In `registerIpc`, add:

```ts
  ipcMain.on(IPC.flushReadingPosition, (event) => {
    const context = documentOf(event)
    if (context) void saver.flush(context.fingerprint).catch(logSaveError)
  })
  ipcMain.handle(IPC.getSettings, () => settings)
  ipcMain.handle(IPC.updateSettings, (_event, patch: unknown) => applySettings(patch))
  ipcMain.handle(IPC.getDataFolderInfo, () => dataFolderInfo())
  ipcMain.handle(IPC.chooseDataFolder, async (event) => {
    const options: OpenDialogOptions = { title: t.settings.chooseTitle, properties: ['openDirectory', 'createDirectory'] }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    await applySettings({ dataFolder: folder })
    return folder
  })
  ipcMain.on(IPC.relaunchApp, () => {
    app.relaunch()
    app.quit()
  })
```

4e. Replace the start of `app.whenReady().then(async () => {` body so the store is created from Settings before anything else:

```ts
  app.whenReady().then(async () => {
    settings = await settingsStore.load()
    activeDataFolder = resolveDataFolder(process.env, settings.dataFolder)
    store = new DocumentStore(documentsDir(activeDataFolder))
    registerIpc()
    setMenu()
    const path = findPdfArg(process.argv)
    if (!path || !(await openAndReport(path))) windows.showHome()
  })
```

(`app.quit()` in the relaunch handler still runs the `will-quit` flush, so pending Reading Positions are saved before the restart.)

- [ ] **Step 5: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 6: App check — Settings round trip**

With `PDFREADER_DATA_DIR` UNSET (back up the real `settings.json` first):
1. Launch, and in the home window evaluate `await window.api.getDataFolderInfo()`: `source` is `onedrive` or `appdata`, `restartNeeded` false.
2. `await window.api.updateSettings({ dataFolder: '<scratch dir>' })` → returns Settings with that folder; `getDataFolderInfo()` now has `source: 'settings'`, `restartNeeded: true`; `settings.json` contains it.
3. `await window.api.updateSettings({ theme: 'neon' })` rejects; `settings.json` unchanged.
4. Restart the app: `getDataFolderInfo()` → `restartNeeded: false`; opening and scrolling a PDF writes `<scratch dir>\documents\<fp>.json`.
5. Restore the original `settings.json`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/shared/strings.ts src/preload/index.ts src/main/index.ts src/renderer/src/reader/ReaderView.tsx
git commit -m "feat: expose Settings over IPC and start from the configured Data Folder

Co-Authored-By: <your model>"
```

---

### Task 3: Settings screen, dark mode and page inversion

**Files:**
- Create: `src/renderer/src/settings/useSettings.ts`, `src/renderer/src/settings/SettingsView.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/home/HomeView.tsx`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Task 2 API and strings.
- Produces:
  - `useSettings(): Settings | null` (live, follows `onSettingsChanged`)
  - `useAppliedTheme(theme: Theme): void` (toggles `dark` class on `<html>`; `system` follows `prefers-color-scheme`)
  - `SettingsView` props `{ settings: Settings | null; onBack(): void }`
  - `HomeView` props `{ onOpenSettings(): void }`
  - `ReaderView` props `{ invertPages: boolean }`

Behavior:
- Home shows a "Cài đặt" button; it switches the home window to the Settings screen; "← Tài liệu gần đây" goes back.
- Settings screen: Data Folder (current path, where it comes from, "Chọn thư mục…", "Dùng mặc định", restart notice + "Khởi động lại" when needed); theme radios (Theo Windows / Sáng / Tối); "Đảo màu trang PDF" checkbox.
- Theme applies to every window immediately. `system` follows Windows light/dark and reacts to changes.
- Reader toolbar gets a "◐" toggle for page inversion (saved in Settings). Inverted pages: canvas colors inverted (`invert(1) hue-rotate(180deg)`), Highlights stay visible.

- [ ] **Step 1: Create `src/renderer/src/settings/useSettings.ts`**

```ts
import { useEffect, useState } from 'react'
import type { Settings, Theme } from '../../../shared/settings'

/** Current Settings, kept in sync with changes made in any window. Null until loaded. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let active = true
    window.api.getSettings().then(
      (loaded) => {
        if (active) setSettings(loaded)
      },
      (err) => console.error('Failed to load settings', err)
    )
    const unsubscribe = window.api.onSettingsChanged(setSettings)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return settings
}

/** Applies the theme as a `dark` class on <html>; 'system' follows Windows and its changes. */
export function useAppliedTheme(theme: Theme): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
```

- [ ] **Step 2: Create `src/renderer/src/settings/SettingsView.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { THEMES, type DataFolderInfo, type Settings } from '../../../shared/settings'
import { t } from '../../../shared/strings'

interface SettingsViewProps {
  settings: Settings | null
  onBack(): void
}

export function SettingsView({ settings, onBack }: SettingsViewProps) {
  const [info, setInfo] = useState<DataFolderInfo | null>(null)

  const refreshInfo = useCallback(() => {
    window.api.getDataFolderInfo().then(setInfo, (err) => console.error('Failed to read data folder info', err))
  }, [])

  useEffect(() => {
    refreshInfo()
  }, [refreshInfo, settings?.dataFolder])

  const update = (patch: Partial<Settings>) => {
    window.api.updateSettings(patch).catch((err) => console.error('Failed to update settings', err))
  }

  if (!settings || !info) return <div className="status">{t.reader.loading}</div>

  return (
    <div className="home settings">
      <header className="home-header">
        <button className="link-button" onClick={onBack}>
          {t.settings.back}
        </button>
      </header>
      <h1>{t.settings.title}</h1>

      <section className="settings-section">
        <h2>{t.settings.dataFolder}</h2>
        <p className="settings-help">{t.settings.dataFolderHelp}</p>
        <code className="settings-path">{info.path}</code>
        <p className="settings-source">{t.settings.source[info.source]}</p>
        <div className="settings-actions">
          <button onClick={() => window.api.chooseDataFolder().catch((err) => console.error(err))}>
            {t.settings.choose}
          </button>
          <button disabled={settings.dataFolder === null} onClick={() => update({ dataFolder: null })}>
            {t.settings.useDefault}
          </button>
        </div>
        {info.restartNeeded && (
          <div className="settings-restart">
            <p>{t.settings.restartNeeded}</p>
            <button onClick={() => window.api.relaunchApp()}>{t.settings.restart}</button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>{t.settings.theme}</h2>
        <div className="settings-radios" role="radiogroup" aria-label={t.settings.theme}>
          {THEMES.map((theme) => (
            <label key={theme}>
              <input
                type="radio"
                name="theme"
                checked={settings.theme === theme}
                onChange={() => update({ theme })}
              />
              {t.settings.themes[theme]}
            </label>
          ))}
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={settings.invertPages}
            onChange={(event) => update({ invertPages: event.target.checked })}
          />
          {t.settings.invertPages}
        </label>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Replace `src/renderer/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { WindowContext } from '../../shared/ipc'
import { HomeView } from './home/HomeView'
import { ReaderView } from './reader/ReaderView'
import { SettingsView } from './settings/SettingsView'
import { useAppliedTheme, useSettings } from './settings/useSettings'

export function App() {
  const [context, setContext] = useState<WindowContext | null>(null)
  const [screen, setScreen] = useState<'recent' | 'settings'>('recent')
  const settings = useSettings()
  useAppliedTheme(settings?.theme ?? 'system')

  useEffect(() => {
    void window.api.getContext().then(setContext)
  }, [])

  if (!context) return null
  if (context.kind === 'document') return <ReaderView invertPages={settings?.invertPages ?? false} />
  if (screen === 'settings') return <SettingsView settings={settings} onBack={() => setScreen('recent')} />
  return <HomeView onOpenSettings={() => setScreen('settings')} />
}
```

- [ ] **Step 4: Settings button in `src/renderer/src/home/HomeView.tsx`**

Change the signature to:

```tsx
export function HomeView({ onOpenSettings }: { onOpenSettings(): void }) {
```

and replace the header with:

```tsx
      <header className="home-header">
        <h1>{t.home.title}</h1>
        <div className="home-actions">
          <button className="secondary" onClick={onOpenSettings}>
            {t.settings.open}
          </button>
          <button onClick={() => void window.api.openFileDialog()}>{t.home.open}</button>
        </div>
      </header>
```

- [ ] **Step 5: Page inversion in `src/renderer/src/reader/ReaderView.tsx`**

5a. Change the component signatures and pass the prop through:

```tsx
export function ReaderView({ invertPages }: { invertPages: boolean }) {
```

In its final `return`, render `<ReaderSurface pdf={state.pdf} initial={state.initial} initialHighlights={state.highlights} invertPages={invertPages} />`.

Add `invertPages: boolean` to `ReaderSurfaceProps`, and destructure it: `function ReaderSurface({ pdf, initial, initialHighlights, invertPages }: ReaderSurfaceProps) {`.

5b. Change the root element to:

```tsx
    <div className={invertPages ? 'reader inverted' : 'reader'}>
```

5c. In the toolbar, directly before `<span className="page-indicator">…`, add:

```tsx
        <button
          className={invertPages ? 'active' : ''}
          title={t.reader.invertPages}
          aria-pressed={invertPages}
          onClick={() =>
            window.api.updateSettings({ invertPages: !invertPages }).catch((err) => console.error(err))
          }
        >
          ◐
        </button>
```

- [ ] **Step 6: Append theme, inversion and settings styles to `src/renderer/src/styles.css`**

```css
/* Page inversion (night reading). */
.reader.inverted .page {
  background: #111;
}
.reader.inverted .page canvas {
  filter: invert(1) hue-rotate(180deg);
}
.reader.inverted .highlight-rect {
  mix-blend-mode: screen;
}

/* Settings screen. */
.home-actions {
  display: flex;
  gap: 8px;
}
.home-header button.secondary,
.settings-actions button,
.settings-restart button {
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 4px;
  padding: 6px 14px;
  font: inherit;
  cursor: pointer;
}
.link-button {
  border: none;
  background: none;
  color: #2f62c8;
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.settings h1 {
  font-size: 20px;
  font-weight: 600;
}
.settings-section {
  margin-bottom: 28px;
}
.settings-section h2 {
  font-size: 15px;
  margin: 0 0 6px;
}
.settings-help,
.settings-source {
  color: #666;
  margin: 4px 0;
}
.settings-path {
  display: block;
  padding: 6px 8px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  word-break: break-all;
}
.settings-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.settings-restart {
  margin-top: 10px;
  padding: 10px;
  background: #fff7d6;
  border: 1px solid #ecd27a;
  border-radius: 6px;
}
.settings-radios {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
}
.settings-check {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* Dark theme: applied when <html> has class "dark" (see useAppliedTheme). */
html.dark {
  color-scheme: dark;
}
html.dark body {
  background: #1e1f22;
  color: #e3e3e3;
}
html.dark .status,
html.dark .home-empty,
html.dark .recent-path,
html.dark .progress-label,
html.dark .page-indicator,
html.dark .settings-help,
html.dark .settings-source,
html.dark .panel-meta,
html.dark .panel-empty,
html.dark .panel-note,
html.dark .menu-note {
  color: #a8a8a8;
}
html.dark .toolbar,
html.dark .sidebar {
  background: #2b2d31;
  border-color: #3d3f44;
}
html.dark .scroll {
  background: #18191b;
}
html.dark .toolbar button,
html.dark .menu-actions button,
html.dark .home-header button.secondary,
html.dark .settings-actions button,
html.dark .settings-restart button,
html.dark .panel-search,
html.dark .menu-note textarea,
html.dark .recent-item,
html.dark .panel-item,
html.dark .settings-path {
  background: #313338;
  color: #e3e3e3;
  border-color: #4a4d53;
}
html.dark .toolbar button.active,
html.dark .home-header button:not(.secondary) {
  background: #2c3e66;
  border-color: #4f73c2;
  color: #e3e3e3;
}
html.dark .selection-toolbar,
html.dark .highlight-menu {
  background: #2b2d31;
  border-color: #4a4d53;
}
html.dark .progress-bar {
  background: #3d3f44;
}
html.dark .settings-restart {
  background: #3b3420;
  border-color: #7a6a2c;
}
html.dark .link-button {
  color: #8fb0ff;
}
html.dark .swatch.selected {
  outline-color: #e3e3e3;
}
```

- [ ] **Step 7: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 8: App check — Settings screen and themes**

1. Home: click "Cài đặt" (CDP click): Settings screen shows the Data Folder path and source; screenshot.
2. Select "Tối": `document.documentElement.classList.contains('dark')` is true in the home window AND in an open Document window; screenshots look dark with readable text.
3. Select "Theo Windows": the class follows the OS setting (check `matchMedia('(prefers-color-scheme: dark)').matches`).
4. In a Document window click "◐": `.reader.inverted` exists, the page canvas looks inverted (screenshot), and `settings.json` has `"invertPages": true`; the Settings checkbox (home window) is checked too.
5. Back up/restore `settings.json` around this check.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/settings/useSettings.ts src/renderer/src/settings/SettingsView.tsx src/renderer/src/App.tsx src/renderer/src/home/HomeView.tsx src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: add Settings screen, dark theme and page inversion

Co-Authored-By: <your model>"
```

---

### Task 4: Outline sidebar tab

**Files:**
- Create: `src/renderer/src/reader/outline/outline.ts`, `src/renderer/src/reader/outline/outline.test.ts`, `src/renderer/src/reader/outline/OutlinePanel.tsx`
- Modify: `src/renderer/src/reader/pdf.ts`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `PageBox` (`layout.ts`); pdf.js `getOutline`, `getDestination`, `getPageIndex`, `PageViewport.convertToViewportPoint`.
- Produces:
  - `interface OutlineTarget { pageIndex: number; top: number | null }` (`top` in page units, scale 1, origin top-left)
  - `interface OutlineNode { title: string; target: OutlineTarget | null; children: OutlineNode[] }`
  - `outlineScrollTop(target: OutlineTarget, boxes: PageBox[], scale: number): number | null`
  - `loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]>` in `pdf.ts`
  - `OutlinePanel` props `{ nodes: OutlineNode[] | null; onNavigate(target: OutlineTarget): void }`
  - Sidebar tabs: "Mục lục" and "Highlight"; the sidebar opens on "Mục lục".

- [ ] **Step 1: Write the failing test**

`src/renderer/src/reader/outline/outline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { layoutPages } from '../layout'
import { outlineScrollTop } from './outline'

// At scale 2: page 0 top 16 (height 400); page 1 top 428.
const BOXES = layoutPages(
  [
    { width: 100, height: 200 },
    { width: 100, height: 100 }
  ],
  2
)

describe('outlineScrollTop', () => {
  it('scrolls to the page top when the destination has no position', () => {
    expect(outlineScrollTop({ pageIndex: 1, top: null }, BOXES, 2)).toBe(428)
  })

  it('scrolls to the destination position inside the page', () => {
    expect(outlineScrollTop({ pageIndex: 1, top: 30 }, BOXES, 2)).toBe(488)
  })

  it('clamps a position above the page and rejects unknown pages', () => {
    expect(outlineScrollTop({ pageIndex: 0, top: -50 }, BOXES, 2)).toBe(16)
    expect(outlineScrollTop({ pageIndex: 7, top: null }, BOXES, 2)).toBeNull()
  })
})
```

Run: `npx vitest run src/renderer/src/reader/outline` → FAIL (module not found).

- [ ] **Step 2: Create `src/renderer/src/reader/outline/outline.ts`**

```ts
import type { PageBox } from '../layout'

/** Where an outline entry points: a page, and optionally a position on it (page units, scale 1). */
export interface OutlineTarget {
  pageIndex: number
  top: number | null
}

export interface OutlineNode {
  title: string
  target: OutlineTarget | null
  children: OutlineNode[]
}

export function outlineScrollTop(target: OutlineTarget, boxes: PageBox[], scale: number): number | null {
  const box = boxes[target.pageIndex]
  if (!box) return null
  return Math.max(0, box.top + Math.max(0, target.top ?? 0) * scale)
}
```

Run the test → PASS.

- [ ] **Step 3: Load the outline in `src/renderer/src/reader/pdf.ts`**

Add imports:

```ts
import type { RefProxy } from 'pdfjs-dist/types/src/display/api'
import type { OutlineNode, OutlineTarget } from './outline/outline'
```

Append:

```ts
type RawOutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

async function resolveOutlineTarget(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<OutlineTarget | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const [ref, mode, ...args] = explicit as unknown[]
  let pageIndex: number
  if (Number.isInteger(ref)) pageIndex = ref as number
  else if (typeof ref === 'object' && ref !== null) pageIndex = await doc.getPageIndex(ref as RefProxy)
  else return null
  const name = typeof mode === 'object' && mode !== null ? (mode as { name?: unknown }).name : undefined
  const pdfTop = name === 'XYZ' ? args[1] : name === 'FitH' || name === 'FitBH' ? args[0] : null
  if (typeof pdfTop !== 'number') return { pageIndex, top: null }
  const page = await doc.getPage(pageIndex + 1)
  const [, top] = page.getViewport({ scale: 1 }).convertToViewportPoint(0, pdfTop)
  return { pageIndex, top }
}

async function toOutlineNode(doc: PDFDocumentProxy, item: RawOutlineItem): Promise<OutlineNode> {
  const [target, children] = await Promise.all([
    resolveOutlineTarget(doc, item.dest).catch(() => null),
    Promise.all((item.items as RawOutlineItem[]).map((child) => toOutlineNode(doc, child)))
  ])
  return { title: item.title, target, children }
}

/** The Document's outline (bookmarks) with each entry resolved to a page and position. */
export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const items = await doc.getOutline()
  if (!items) return []
  return Promise.all(items.map((item) => toOutlineNode(doc, item)))
}
```

- [ ] **Step 4: Create `src/renderer/src/reader/outline/OutlinePanel.tsx`**

```tsx
import { useState } from 'react'
import { t } from '../../../../shared/strings'
import type { OutlineNode, OutlineTarget } from './outline'

interface OutlinePanelProps {
  nodes: OutlineNode[] | null
  onNavigate(target: OutlineTarget): void
}

export function OutlinePanel({ nodes, onNavigate }: OutlinePanelProps) {
  if (nodes === null) return <p className="panel-empty">{t.reader.loading}</p>
  if (nodes.length === 0) return <p className="panel-empty">{t.outline.empty}</p>
  return (
    <ul className="outline-tree">
      {nodes.map((node, index) => (
        <OutlineItem key={index} node={node} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function OutlineItem({ node, onNavigate }: { node: OutlineNode; onNavigate(target: OutlineTarget): void }) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children.length > 0
  return (
    <li>
      <div className="outline-row">
        {hasChildren ? (
          <button
            className="outline-toggle"
            aria-expanded={open}
            title={open ? t.outline.collapse : t.outline.expand}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="outline-toggle" />
        )}
        <button
          className="outline-title"
          disabled={!node.target}
          onClick={() => {
            if (node.target) onNavigate(node.target)
          }}
        >
          {node.title}
        </button>
      </div>
      {open && hasChildren && (
        <ul className="outline-tree">
          {node.children.map((child, index) => (
            <OutlineItem key={index} node={child} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  )
}
```

- [ ] **Step 5: Sidebar tabs in `src/renderer/src/reader/ReaderView.tsx`**

5a. Imports:

```ts
import { OutlinePanel } from './outline/OutlinePanel'
import { outlineScrollTop, type OutlineNode, type OutlineTarget } from './outline/outline'
```

and change the pdf import to `import { getDocumentTextIndex, loadOutline, loadPdf, type LoadedPdf } from './pdf'`.

5b. After `const [focusedId, setFocusedId] = …`, add:

```ts
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'highlights'>('outline')
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)

  useEffect(() => {
    let cancelled = false
    loadOutline(pdf.doc).then(
      (nodes) => {
        if (!cancelled) setOutline(nodes)
      },
      (err) => {
        console.error('Failed to load outline', err)
        if (!cancelled) setOutline([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [pdf.doc])

  const goToOutline = (target: OutlineTarget) => {
    const element = scrollRef.current
    const top = outlineScrollTop(target, boxes, scale)
    if (element && top !== null) element.scrollTop = top
  }
```

5c. Replace the `aside` element:

```tsx
        {sidebarOpen && (
          <aside className="sidebar">
            <HighlightPanel highlights={highlights} activeId={activeId} onSelect={goToHighlight} />
          </aside>
        )}
```

with:

```tsx
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={sidebarTab === 'outline'}
                className={sidebarTab === 'outline' ? 'active' : ''}
                onClick={() => setSidebarTab('outline')}
              >
                {t.outline.tab}
              </button>
              <button
                role="tab"
                aria-selected={sidebarTab === 'highlights'}
                className={sidebarTab === 'highlights' ? 'active' : ''}
                onClick={() => setSidebarTab('highlights')}
              >
                {t.highlight.tab}
              </button>
            </div>
            {sidebarTab === 'outline' ? (
              <div className="outline-panel">
                <OutlinePanel nodes={outline} onNavigate={goToOutline} />
              </div>
            ) : (
              <HighlightPanel highlights={highlights} activeId={activeId} onSelect={goToHighlight} />
            )}
          </aside>
        )}
```

- [ ] **Step 6: Append outline styles to `src/renderer/src/styles.css`**

```css
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid #ddd;
}
.sidebar-tabs button {
  flex: 1;
  padding: 8px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  font: inherit;
  cursor: pointer;
  color: inherit;
}
.sidebar-tabs button.active {
  border-bottom-color: #4a7fe0;
  font-weight: 600;
}
.outline-panel {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}
.outline-tree {
  list-style: none;
  margin: 0;
  padding-left: 12px;
}
.outline-panel > .outline-tree {
  padding-left: 0;
}
.outline-row {
  display: flex;
  align-items: flex-start;
}
.outline-toggle {
  flex-shrink: 0;
  width: 20px;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 2px 0;
}
.outline-title {
  flex: 1;
  text-align: left;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
}
.outline-title:hover:not(:disabled) {
  background: rgba(74, 127, 224, 0.12);
}
.outline-title:disabled {
  cursor: default;
  opacity: 0.6;
}
html.dark .sidebar-tabs {
  border-color: #3d3f44;
}
```

- [ ] **Step 7: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 8: App check — outline**

Generate a PDF with an outline (bookmarks) of at least two levels (e.g. with a small script using pdf-lib's low-level `Outlines` dictionary, or any PDF with bookmarks you have) and one without.
1. With bookmarks: Ctrl+B opens the sidebar on "Mục lục"; the top-level entries show; expanding shows children; clicking an entry scrolls to its page (page indicator changes).
2. Without bookmarks: "File này không có mục lục."
3. "Highlight" tab still shows the Highlight panel.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/reader/outline/outline.ts src/renderer/src/reader/outline/outline.test.ts src/renderer/src/reader/outline/OutlinePanel.tsx src/renderer/src/reader/pdf.ts src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: add outline tab to the reader sidebar

Co-Authored-By: <your model>"
```

---

### Task 5: Search in the Document (Ctrl+F)

**Files:**
- Create: `src/renderer/src/reader/search/search.ts`, `src/renderer/src/reader/search/search.test.ts`, `src/renderer/src/reader/search/SearchBar.tsx`, `src/renderer/src/reader/search/SearchLayer.tsx`
- Modify: `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `getDocumentTextIndex` (`pdf.ts`), `findAllText`, `matchToParts`, `TextIndex` (`highlights/textIndex.ts`), `SCROLL_MARGIN` (`highlights/geometry.ts`), `PageBox`.
- Produces from `search.ts`:
  - `interface SearchHit { parts: HighlightPart[] }`
  - `searchDocument(index: TextIndex, query: string): SearchHit[]`
  - `stepHit(current: number, count: number, direction: 1 | -1): number`
  - `firstHitFrom(hits: SearchHit[], pageIndex: number): number`
  - `hitScrollTop(hit: SearchHit, boxes: PageBox[], scale: number): number | null`
  - `hitsByPage(hits: SearchHit[]): Map<number, { hitIndex: number; part: HighlightPart }[]>`
- Produces components: `SearchBar`, `SearchLayer` (props below).

Behavior:
- `Ctrl+F` opens a search box in the toolbar (or focuses and selects it if open). Typing searches after 200 ms (case- and diacritic-insensitive).
- All hits are drawn on the pages (light orange), the current hit stronger. The count shows "3 / 12", "Không thấy", or "Đang tìm…".
- `Enter` / `↓` / `F3` = next, `Shift+Enter` / `↑` / `Shift+F3` = previous (wrapping). The first hit chosen is the first one on or after the page at the top of the view. Moving to a hit scrolls it near the top.
- `Escape` or "✕" closes search and clears the hits.

- [ ] **Step 1: Write the failing test**

`src/renderer/src/reader/search/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTextIndex, type TextRun } from '../highlights/textIndex'
import { layoutPages } from '../layout'
import { firstHitFrom, hitsByPage, hitScrollTop, searchDocument, stepHit } from './search'

const RUNS: TextRun[] = [
  { pageIndex: 0, text: 'Hợp đồng mua bán', rect: { x: 0, y: 10, width: 160, height: 10 }, hasEOL: true },
  { pageIndex: 2, text: 'Phụ lục hợp đồng', rect: { x: 0, y: 30, width: 160, height: 10 }, hasEOL: false }
]
const INDEX = buildTextIndex(RUNS)

describe('searchDocument', () => {
  it('finds every hit ignoring case and diacritics', () => {
    const hits = searchDocument(INDEX, 'HOP DONG')
    expect(hits.map((h) => h.parts[0].pageIndex)).toEqual([0, 2])
  })

  it('returns no hits for an empty query', () => {
    expect(searchDocument(INDEX, '  ')).toEqual([])
  })
})

describe('stepHit', () => {
  it('wraps in both directions', () => {
    expect(stepHit(2, 3, 1)).toBe(0)
    expect(stepHit(0, 3, -1)).toBe(2)
    expect(stepHit(-1, 3, 1)).toBe(0)
    expect(stepHit(-1, 3, -1)).toBe(2)
    expect(stepHit(0, 0, 1)).toBe(-1)
  })
})

describe('firstHitFrom', () => {
  const hits = searchDocument(INDEX, 'hop dong')

  it('picks the first hit on or after a page, wrapping to the start', () => {
    expect(firstHitFrom(hits, 1)).toBe(1)
    expect(firstHitFrom(hits, 3)).toBe(0)
    expect(firstHitFrom([], 0)).toBe(-1)
  })
})

describe('hitScrollTop and hitsByPage', () => {
  const hits = searchDocument(INDEX, 'hop dong')
  const boxes = layoutPages(
    [
      { width: 200, height: 300 },
      { width: 200, height: 300 },
      { width: 200, height: 300 }
    ],
    1
  )

  it('scrolls a hit a margin below the top', () => {
    // Page 2 top = 16 + 300 + 12 + 300 + 12 = 640; hit y = 30.
    expect(hitScrollTop(hits[1], boxes, 1)).toBe(640 + 30 - 48)
  })

  it('groups hit parts by page with their hit index', () => {
    const byPage = hitsByPage(hits)
    expect(byPage.get(0)?.map((e) => e.hitIndex)).toEqual([0])
    expect(byPage.get(2)?.map((e) => e.hitIndex)).toEqual([1])
  })
})
```

Run: `npx vitest run src/renderer/src/reader/search` → FAIL (module not found).

- [ ] **Step 2: Create `src/renderer/src/reader/search/search.ts`**

```ts
import type { HighlightPart } from '../../../../shared/documentData'
import { SCROLL_MARGIN } from '../highlights/geometry'
import { findAllText, matchToParts, type TextIndex } from '../highlights/textIndex'
import type { PageBox } from '../layout'

export interface SearchHit {
  parts: HighlightPart[]
}

export function searchDocument(index: TextIndex, query: string): SearchHit[] {
  return findAllText(index, query)
    .map((match) => ({ parts: matchToParts(index, match) }))
    .filter((hit) => hit.parts.length > 0)
}

/** Next/previous hit index, wrapping; -1 when there are no hits. */
export function stepHit(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

/** The first hit on or after `pageIndex`, else the first hit; -1 when there are none. */
export function firstHitFrom(hits: SearchHit[], pageIndex: number): number {
  if (hits.length === 0) return -1
  const index = hits.findIndex((hit) => hit.parts[0].pageIndex >= pageIndex)
  return index === -1 ? 0 : index
}

export function hitScrollTop(hit: SearchHit, boxes: PageBox[], scale: number): number | null {
  const part = hit.parts[0]
  const rect = part?.rects[0]
  const box = part ? boxes[part.pageIndex] : undefined
  if (!part || !rect || !box) return null
  return Math.max(0, box.top + rect.y * scale - SCROLL_MARGIN)
}

export function hitsByPage(hits: SearchHit[]): Map<number, { hitIndex: number; part: HighlightPart }[]> {
  const byPage = new Map<number, { hitIndex: number; part: HighlightPart }[]>()
  hits.forEach((hit, hitIndex) => {
    for (const part of hit.parts) {
      const list = byPage.get(part.pageIndex) ?? []
      list.push({ hitIndex, part })
      byPage.set(part.pageIndex, list)
    }
  })
  return byPage
}
```

Run the test → PASS.

- [ ] **Step 3: Create `src/renderer/src/reader/search/SearchLayer.tsx`**

```tsx
import type { HighlightPart } from '../../../../shared/documentData'

interface SearchLayerProps {
  entries: { hitIndex: number; part: HighlightPart }[]
  scale: number
  currentHit: number
}

export function SearchLayer({ entries, scale, currentHit }: SearchLayerProps) {
  return (
    <div className="search-layer">
      {entries.flatMap(({ hitIndex, part }) =>
        part.rects.map((rect, rectIndex) => (
          <div
            key={`${hitIndex}-${rectIndex}`}
            className={hitIndex === currentHit ? 'search-hit current' : 'search-hit'}
            style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}
          />
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/src/reader/search/SearchBar.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { t } from '../../../../shared/strings'

interface SearchBarProps {
  query: string
  onQuery(query: string): void
  status: 'idle' | 'searching' | 'done'
  count: number
  current: number
  /** Changes every time Ctrl+F is pressed, to re-focus the box. */
  focusKey: number
  onStep(direction: 1 | -1): void
  onClose(): void
}

export function SearchBar({ query, onQuery, status, count, current, focusKey, onStep, onClose }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusKey])

  const label =
    status === 'searching'
      ? t.search.searching
      : query.trim() === ''
        ? ''
        : count === 0
          ? t.search.none
          : t.search.count(current + 1, count)

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={t.search.placeholder}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      />
      <span className="search-count">{label}</span>
      <button title={t.search.previous} disabled={count === 0} onClick={() => onStep(-1)}>
        ↑
      </button>
      <button title={t.search.next} disabled={count === 0} onClick={() => onStep(1)}>
        ↓
      </button>
      <button title={t.search.close} onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Wire search into `src/renderer/src/reader/ReaderView.tsx`**

5a. Imports:

```ts
import { SearchBar } from './search/SearchBar'
import { SearchLayer } from './search/SearchLayer'
import { firstHitFrom, hitsByPage, hitScrollTop, searchDocument, stepHit, type SearchHit } from './search/search'
```

5b. After the outline state (Task 4), add:

```ts
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocusKey, setSearchFocusKey] = useState(0)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [currentHit, setCurrentHit] = useState(-1)
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'done'>('idle')
  const hitEntries = useMemo(() => hitsByPage(hits), [hits])
  const layoutRef = useRef({ boxes, scale })
  layoutRef.current = { boxes, scale }

  useEffect(() => {
    if (!searchOpen || query.trim() === '') {
      setHits([])
      setCurrentHit(-1)
      setSearchStatus('idle')
      return
    }
    let cancelled = false
    setSearchStatus('searching')
    const timer = setTimeout(() => {
      getDocumentTextIndex(pdf.doc)
        .then((index) => {
          if (cancelled) return
          const found = searchDocument(index, query)
          setHits(found)
          setCurrentHit(firstHitFrom(found, anchorRef.current.pageIndex))
          setSearchStatus('done')
        })
        .catch((err) => {
          console.error('Search failed', err)
          if (cancelled) return
          setHits([])
          setCurrentHit(-1)
          setSearchStatus('done')
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchOpen, query, pdf.doc])

  // Bring the current hit into view whenever it changes.
  useEffect(() => {
    const hit = hits[currentHit]
    const element = scrollRef.current
    if (!hit || !element) return
    const top = hitScrollTop(hit, layoutRef.current.boxes, layoutRef.current.scale)
    if (top !== null) element.scrollTop = top
  }, [hits, currentHit])

  const hitsCountRef = useRef(0)
  hitsCountRef.current = hits.length
  const stepSearch = useCallback((direction: 1 | -1) => {
    setCurrentHit((current) => stepHit(current, hitsCountRef.current, direction))
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
  }, [])
```

5c. In the keydown handler's `if (event.ctrlKey) { … }` block, add before `else return`:

```ts
        else if (event.key === 'f' || event.key === 'F') {
          setSearchOpen(true)
          setSearchFocusKey((key) => key + 1)
        }
```

and directly after that `ctrlKey` block (before the `if (event.altKey || …` line), add:

```ts
      if (event.key === 'F3' && searchOpen) {
        event.preventDefault()
        stepSearch(event.shiftKey ? -1 : 1)
        return
      }
      if (event.key === 'Escape' && searchOpen && !selection) {
        closeSearch()
        return
      }
```

Add `searchOpen`, `stepSearch` and `closeSearch` to that effect's dependency array.

5d. In the toolbar, directly before the `◐` button (Task 3), add:

```tsx
        {searchOpen ? (
          <SearchBar
            query={query}
            onQuery={setQuery}
            status={searchStatus}
            count={hits.length}
            current={currentHit}
            focusKey={searchFocusKey}
            onStep={stepSearch}
            onClose={closeSearch}
          />
        ) : (
          <button
            title={t.search.open}
            onClick={() => {
              setSearchOpen(true)
              setSearchFocusKey((key) => key + 1)
            }}
          >
            🔍
          </button>
        )}
```

5e. Render hits on each page: replace the `PdfPage` children

```tsx
                <HighlightLayer
                  highlights={byPage.get(pageIndex) ?? NO_HIGHLIGHTS}
                  pageIndex={pageIndex}
                  scale={scale}
                  activeId={activeId}
                />
```

with

```tsx
                <>
                  <HighlightLayer
                    highlights={byPage.get(pageIndex) ?? NO_HIGHLIGHTS}
                    pageIndex={pageIndex}
                    scale={scale}
                    activeId={activeId}
                  />
                  {hitEntries.has(pageIndex) && (
                    <SearchLayer entries={hitEntries.get(pageIndex)!} scale={scale} currentHit={currentHit} />
                  )}
                </>
```

- [ ] **Step 6: Append search styles to `src/renderer/src/styles.css`**

```css
.search-bar {
  display: flex;
  align-items: center;
  gap: 4px;
}
.search-bar input {
  font: inherit;
  width: 220px;
  padding: 3px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.search-count {
  min-width: 70px;
  color: #666;
  font-variant-numeric: tabular-nums;
}
.search-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
.search-hit {
  position: absolute;
  background: rgba(255, 150, 0, 0.3);
  mix-blend-mode: multiply;
  border-radius: 2px;
}
.search-hit.current {
  background: rgba(255, 110, 0, 0.6);
  outline: 2px solid rgba(220, 90, 0, 0.9);
}
html.dark .search-bar input {
  background: #313338;
  color: #e3e3e3;
  border-color: #4a4d53;
}
html.dark .search-count {
  color: #a8a8a8;
}
```

- [ ] **Step 7: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 8: App check — search**

Open a multi-page text PDF:
1. Press Ctrl+F: the search box appears focused.
2. Type a word that appears on several pages, without diacritics if the PDF has Vietnamese text: within ~1 s the count shows "1 / N", hits are drawn (screenshot), the view jumps to the first hit at/after the current page.
3. Press Enter three times and Shift+Enter once: the count and the view follow; F3 also moves.
4. Type a word that does not exist: "Không thấy", no hits drawn.
5. Press Escape: the box closes and hits disappear.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/reader/search/search.ts src/renderer/src/reader/search/search.test.ts src/renderer/src/reader/search/SearchBar.tsx src/renderer/src/reader/search/SearchLayer.tsx src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: search the Document with Ctrl+F

Co-Authored-By: <your model>"
```

---

### Task 6: Password-protected PDFs

**Files:**
- Create: `src/renderer/src/reader/PasswordPrompt.tsx`
- Modify: `src/renderer/src/reader/pdf.ts`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: pdf.js `PDFDocumentLoadingTask.onPassword`, `PasswordResponses`.
- Produces:
  - `type PasswordReason = 'need' | 'incorrect'`
  - `class PasswordCancelledError extends Error`
  - `loadPdf(bytes: Uint8Array, requestPassword?: (reason: PasswordReason) => Promise<string | null>): Promise<LoadedPdf>` (page sizes now loaded in parallel)
  - `PasswordPrompt` props `{ reason: PasswordReason; onSubmit(password: string): void; onCancel(): void }`

Behavior: opening an encrypted PDF shows a modal asking for the password ("Sai mật khẩu. Thử lại." after a wrong one). Cancel shows `t.reader.passwordCancelled`. The password is only passed to pdf.js; it is never stored, sent to main, or logged.

- [ ] **Step 1: Update `loadPdf` in `src/renderer/src/reader/pdf.ts`**

Replace the existing `loadPdf` function with:

```ts
export type PasswordReason = 'need' | 'incorrect'

/** Thrown by loadPdf when the user cancels the password prompt. */
export class PasswordCancelledError extends Error {
  constructor() {
    super('Password entry cancelled')
    this.name = 'PasswordCancelledError'
  }
}

export async function loadPdf(
  bytes: Uint8Array,
  requestPassword?: (reason: PasswordReason) => Promise<string | null>
): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false })
  let cancelled = false
  if (requestPassword) {
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      const why: PasswordReason = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'need'
      requestPassword(why).then(
        (password) => {
          if (password === null) {
            cancelled = true
            void task.destroy()
          } else {
            updatePassword(password)
          }
        },
        () => {
          cancelled = true
          void task.destroy()
        }
      )
    }
  }
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    if (cancelled) throw new PasswordCancelledError()
    throw err
  }
  const pageSizes: PageSize[] = await Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const viewport = (await doc.getPage(i + 1)).getViewport({ scale: 1 })
      return { width: viewport.width, height: viewport.height }
    })
  )
  return { doc, pageSizes }
}
```

- [ ] **Step 2: Create `src/renderer/src/reader/PasswordPrompt.tsx`**

```tsx
import { useState } from 'react'
import { t } from '../../../shared/strings'
import type { PasswordReason } from './pdf'

interface PasswordPromptProps {
  reason: PasswordReason
  onSubmit(password: string): void
  onCancel(): void
}

export function PasswordPrompt({ reason, onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(password)
        }}
      >
        <h2>{t.password.title}</h2>
        <p className={reason === 'incorrect' ? 'modal-error' : ''}>
          {reason === 'incorrect' ? t.password.incorrect : t.password.need}
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel()
          }}
        />
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t.password.cancel}
          </button>
          <button type="submit">{t.password.ok}</button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Use it in `ReaderView` (`src/renderer/src/reader/ReaderView.tsx`)**

3a. Imports: change the pdf import to

```ts
import {
  getDocumentTextIndex,
  loadOutline,
  loadPdf,
  PasswordCancelledError,
  type LoadedPdf,
  type PasswordReason
} from './pdf'
```

and add `import { PasswordPrompt } from './PasswordPrompt'`.

3b. Replace the `LoadState` type and the whole `ReaderView` function (keep `ReaderSurface` unchanged) with:

```tsx
type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'password-cancelled' }
  | { status: 'ready'; pdf: LoadedPdf; initial: ReadingPosition | null; highlights: Highlight[] }

interface PasswordRequest {
  reason: PasswordReason
  resolve(password: string | null): void
  /** Increments per prompt so a wrong password re-mounts the prompt with an empty field. */
  attempt: number
}

export function ReaderView({ invertPages }: { invertPages: boolean }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  const passwordAttemptRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const requestPassword = (reason: PasswordReason) =>
      new Promise<string | null>((resolve) => {
        if (cancelled) {
          resolve(null)
          return
        }
        passwordAttemptRef.current += 1
        setPasswordRequest({ reason, resolve, attempt: passwordAttemptRef.current })
      })
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
        const pdf = await loadPdf(bytes, requestPassword)
        const data = await dataPromise
        if (!cancelled) {
          setState({ status: 'ready', pdf, initial: data?.reading ?? null, highlights: data?.highlights ?? NO_HIGHLIGHTS })
        }
      } catch (err) {
        if (err instanceof PasswordCancelledError) {
          if (!cancelled) setState({ status: 'password-cancelled' })
          return
        }
        console.error('Failed to open document', err)
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <>
        <div className="status">{t.reader.loading}</div>
        {passwordRequest && (
          <PasswordPrompt
            key={passwordRequest.attempt}
            reason={passwordRequest.reason}
            onSubmit={(password) => {
              passwordRequest.resolve(password)
              setPasswordRequest(null)
            }}
            onCancel={() => {
              passwordRequest.resolve(null)
              setPasswordRequest(null)
            }}
          />
        )}
      </>
    )
  }
  if (state.status === 'error') return <div className="status">{t.reader.loadFailed}</div>
  if (state.status === 'password-cancelled') return <div className="status">{t.reader.passwordCancelled}</div>
  return (
    <ReaderSurface
      pdf={state.pdf}
      initial={state.initial}
      initialHighlights={state.highlights}
      invertPages={invertPages}
    />
  )
}
```

- [ ] **Step 4: Append modal styles to `src/renderer/src/styles.css`**

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.modal {
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}
.modal h2 {
  margin: 0;
  font-size: 16px;
}
.modal input {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.modal-error {
  color: #b3261e;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.modal-actions button {
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 4px;
  padding: 5px 14px;
  font: inherit;
  cursor: pointer;
}
.modal-actions button[type='submit'] {
  background: #e3edff;
  border-color: #7aa7ff;
}
html.dark .modal {
  background: #2b2d31;
}
html.dark .modal input,
html.dark .modal-actions button {
  background: #313338;
  color: #e3e3e3;
  border-color: #4a4d53;
}
```

- [ ] **Step 5: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 6: App check — password**

Produce an encrypted PDF with any available tool (e.g. `qpdf --encrypt user owner 256 -- in.pdf out.pdf`, or Python `pypdf` `writer.encrypt('user')`). If no tool is available, list this check as pending human.
1. Open it: the modal asks for the password. Enter a wrong one: "Sai mật khẩu. Thử lại." with an empty input. Enter the right one: the PDF renders.
2. Open it again and click "Hủy": "File có mật khẩu nên chưa mở." is shown, no crash.
3. Confirm the password text appears in no log output and in no file in the Data Folder.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/reader/PasswordPrompt.tsx src/renderer/src/reader/pdf.ts src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: open password-protected PDFs

Co-Authored-By: <your model>"
```

---

### Task 7: Notice for PDFs without a text layer

**Files:**
- Modify: `src/renderer/src/reader/pdf.ts`, `src/renderer/src/reader/ReaderView.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Produces: `hasTextLayer(doc: PDFDocumentProxy, maxPages?: number /* default 5 */): Promise<boolean>` in `pdf.ts`.

Behavior: after opening, if none of the first 5 pages has any non-blank text, a dismissible banner under the toolbar says `t.reader.noTextLayer`. Reading Position still saves as usual.

- [ ] **Step 1: Add `hasTextLayer` to `src/renderer/src/reader/pdf.ts`**

```ts
/** True when any of the first `maxPages` pages has selectable, non-blank text. */
export async function hasTextLayer(doc: PDFDocumentProxy, maxPages = 5): Promise<boolean> {
  const count = Math.min(doc.numPages, maxPages)
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const content = await (await doc.getPage(pageNumber)).getTextContent()
    if (content.items.some((item) => 'str' in item && item.str.trim() !== '')) return true
  }
  return false
}
```

- [ ] **Step 2: Banner in `ReaderView`**

Import `hasTextLayer` from `./pdf`. In `ReaderSurface`, add:

```ts
  const [showNoTextNotice, setShowNoTextNotice] = useState(false)

  useEffect(() => {
    let cancelled = false
    hasTextLayer(pdf.doc).then(
      (hasText) => {
        if (!cancelled) setShowNoTextNotice(!hasText)
      },
      (err) => console.error('Failed to inspect text layer', err)
    )
    return () => {
      cancelled = true
    }
  }, [pdf.doc])
```

Directly after the closing `</div>` of `.toolbar`, add:

```tsx
      {showNoTextNotice && (
        <div className="notice" role="status">
          <span>{t.reader.noTextLayer}</span>
          <button onClick={() => setShowNoTextNotice(false)}>{t.reader.dismiss}</button>
        </div>
      )}
```

- [ ] **Step 3: Append banner styles to `src/renderer/src/styles.css`**

```css
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  background: #fff7d6;
  border-bottom: 1px solid #ecd27a;
}
.notice button {
  border: 1px solid #d9c26a;
  background: transparent;
  border-radius: 4px;
  padding: 2px 10px;
  font: inherit;
  cursor: pointer;
}
html.dark .notice {
  background: #3b3420;
  border-color: #7a6a2c;
}
```

- [ ] **Step 4: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 5: App check**

1. Generate an image-only PDF (e.g. a page that only draws filled rectangles, no text operators). Open it: the banner shows; "Đóng" hides it; scrolling still saves the Reading Position.
2. Open a text PDF: no banner.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/reader/pdf.ts src/renderer/src/reader/ReaderView.tsx src/renderer/src/styles.css
git commit -m "feat: tell the reader when a PDF has no selectable text

Co-Authored-By: <your model>"
```

---

### Task 8: Reader polish deferred from Plan 1

**Files:**
- Modify: `src/main/index.ts`, `src/renderer/src/reader/ReaderView.tsx`

**Interfaces:**
- Consumes: `window.api.flushReadingPosition()` (Task 2).

Changes:
1. **Explicit flush signal instead of "not focused" flushing.** Scrolling an unfocused window (Windows scrolls inactive windows under the wheel) currently writes about every 500 ms. The renderer now sends `flushReadingPosition` right after flushing its throttle on `blur`/`beforeunload`; main flushes only on that signal, on window `blur`, and on `closed`.
2. **Release the PDF.** `ReaderView` destroys the loaded pdf.js document when it unmounts (or when a load finishes after unmount).
3. **Empty PDF.** A PDF with 0 pages shows `t.reader.emptyDocument` instead of "Trang 1 / 0".

- [ ] **Step 1: Main — remove the focus-based flush**

In `src/main/index.ts`, replace the `reportReadingPosition` handler with:

```ts
  ipcMain.on(IPC.reportReadingPosition, (event, reading: unknown, pageCount: unknown) => {
    const context = documentOf(event)
    if (!context || !isReadingPosition(reading) || !Number.isInteger(pageCount) || (pageCount as number) < 0) return
    saver.report(context.fingerprint, { reading, pageCount: pageCount as number })
  })
```

(The `flushReadingPosition` handler from Task 2 stays.) If `BrowserWindow` is now unused in this file, keep it only if other code uses it (Task 2's `broadcastSettings` and `chooseDataFolder` do).

- [ ] **Step 2: Renderer — send the flush signal**

In `ReaderSurface`, replace the blur/beforeunload effect with:

```ts
  useEffect(() => {
    const flush = () => {
      report.flush()
      window.api.flushReadingPosition()
    }
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
      report.flush()
    }
  }, [report])
```

- [ ] **Step 3: Renderer — destroy the document, handle 0 pages**

Replace the whole `ReaderView` function (from Task 6) with this version. Changes: `loaded` tracks the document so cleanup can destroy it; a load that finishes after unmount destroys its document immediately; a 0-page PDF shows `t.reader.emptyDocument`.

```tsx
export function ReaderView({ invertPages }: { invertPages: boolean }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  const passwordAttemptRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let loaded: LoadedPdf | null = null
    const requestPassword = (reason: PasswordReason) =>
      new Promise<string | null>((resolve) => {
        if (cancelled) {
          resolve(null)
          return
        }
        passwordAttemptRef.current += 1
        setPasswordRequest({ reason, resolve, attempt: passwordAttemptRef.current })
      })
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
        const pdf = await loadPdf(bytes, requestPassword)
        if (cancelled) {
          void pdf.doc.destroy()
          return
        }
        loaded = pdf
        const data = await dataPromise
        if (!cancelled) {
          setState({ status: 'ready', pdf, initial: data?.reading ?? null, highlights: data?.highlights ?? NO_HIGHLIGHTS })
        }
      } catch (err) {
        if (err instanceof PasswordCancelledError) {
          if (!cancelled) setState({ status: 'password-cancelled' })
          return
        }
        console.error('Failed to open document', err)
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
      void loaded?.doc.destroy()
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <>
        <div className="status">{t.reader.loading}</div>
        {passwordRequest && (
          <PasswordPrompt
            key={passwordRequest.attempt}
            reason={passwordRequest.reason}
            onSubmit={(password) => {
              passwordRequest.resolve(password)
              setPasswordRequest(null)
            }}
            onCancel={() => {
              passwordRequest.resolve(null)
              setPasswordRequest(null)
            }}
          />
        )}
      </>
    )
  }
  if (state.status === 'error') return <div className="status">{t.reader.loadFailed}</div>
  if (state.status === 'password-cancelled') return <div className="status">{t.reader.passwordCancelled}</div>
  if (state.pdf.pageSizes.length === 0) return <div className="status">{t.reader.emptyDocument}</div>
  return (
    <ReaderSurface
      pdf={state.pdf}
      initial={state.initial}
      initialHighlights={state.highlights}
      invertPages={invertPages}
    />
  )
}
```

- [ ] **Step 4: Typecheck, tests, build**

`npm run typecheck` → 0. `npm test` → all pass. `npm run build` → succeeds.

- [ ] **Step 5: App check**

1. Open a PDF in window A and focus another app. Scroll window A with CDP-dispatched wheel events for ~3 s: the JSON `updatedAt` changes at most once per ~3 s (debounced), not every 500 ms. Focus window A, scroll, then blur it: the position is written within ~1 s.
2. Close a Document window within 1 s of scrolling and reopen: the exact last position is restored.
3. Open a 0-page PDF (hand-written minimal PDF with an empty `/Kids []` page tree): "File PDF không có trang nào."

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/renderer/src/reader/ReaderView.tsx
git commit -m "fix: flush reading position on explicit signal, release PDFs, handle empty files

Co-Authored-By: <your model>"
```

---

### Task 9: End-to-end verification

**Files:** none expected. Fix failures in the owning file with a test where the cause is pure logic; commit fixes separately.

- [ ] **Step 1:** `npm run typecheck` → 0; `npm test` → all pass; `npm run dist` → installer builds.
- [ ] **Step 2:** Settings: theme and inversion persist across restarts; Data Folder change requires restart and then takes effect; "Dùng mặc định" returns to the default after restart.
- [ ] **Step 3:** Search, outline, Highlights and inversion work together on one Document (search hits and Highlights both visible; inverted pages keep both readable).
- [ ] **Step 4:** Run the packaged app (`dist\win-unpacked\PdfReader.exe`) with an isolated Data Folder: Settings screen, dark mode, Ctrl+F, outline and password prompt all work in the production build (no console errors via CDP).
- [ ] **Step 5:** List pending human checks: real OS dark-mode switch, Vietnamese IME in the search box, real password PDF from the user, look and feel of dark mode.
