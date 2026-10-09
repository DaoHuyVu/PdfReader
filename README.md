# PdfReader

A personal desktop PDF reader for Windows. It remembers where you stopped reading, lets you highlight text and add notes, and never modifies your PDF files.

## Features

- Continuous scrolling; only pages near the viewport are rendered, so large PDFs stay smooth.
- Zoom: fit width, fit page, and steps from 25% to 400%.
- **Reading Position** saved automatically (page, position in the page, zoom). It is saved only after you scroll or zoom; opening a file alone writes nothing.
- **Highlights** in 5 colors (select text, then click a color or press `1`–`5`), with optional **Notes**. A highlight can cross a page break.
- Sidebar (`Ctrl+B`): **Outline** (bookmarks) and **Highlights** (sorted by position, filter by color, search ignoring case and Vietnamese diacritics).
- **Search** in the document (`Ctrl+F`).
- **Export** a new PDF that contains your highlights and notes as standard annotations; the original file is never changed.
- Files are identified by content, so renamed or moved files keep their data. When a file's content changes, the app offers to **Carry Over** the old position and highlights and re-anchors them by their text ([ADR 0001](docs/adr/0001-identify-documents-by-content.md)).
- Password-protected PDFs (the password is never stored), dark mode, and page inversion for night reading.
- Recent Documents with reading progress; one window per document; Vietnamese interface.

## Requirements

- Windows 10 or 11 (x64)
- Node.js 20.19+ or 22.12+ (required by Vite 7)

## Install

```bash
npm install
npm run dist
```

This builds `dist\PdfReader Setup <version>.exe`. Run it once:
- It installs PdfReader for the current user (`%LOCALAPPDATA%\Programs\PdfReader`), with no admin prompt.
- It creates a desktop shortcut and a Start menu entry, and starts the app.
- It adds PdfReader to **Open with** for `.pdf` files. It does not change your default PDF app; choose it yourself in Windows if you want.

Uninstall from Windows Settings > Apps. The installer is not code-signed, so SmartScreen may warn: click **More info**, then **Run anyway**.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+O` | Open a PDF |
| `Ctrl+H` | Recent Documents |
| `Ctrl+B` | Toggle the sidebar |
| `Ctrl+F` | Search; `Enter` / `Shift+Enter` or `F3` / `Shift+F3` for next / previous |
| `1`–`5` | Highlight the selected text (yellow, green, blue, pink, orange) |
| `Esc` | Cancel the selection, close search or menus |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / fit width |

## Where data is stored

One JSON file per document in the **Data Folder**, under `documents\<fingerprint>.json`. The Data Folder is chosen in this order:

1. `PDFREADER_DATA_DIR` (environment variable, for development)
2. The folder chosen in **Settings** (applies after restart; existing data is not moved)
3. `%OneDriveConsumer%\PdfReaderData` — your personal OneDrive, so every machine sees the same data
4. `%APPDATA%\PdfReader` — local only

Work/school OneDrive is never used, so personal reading data does not sync into an employer's tenant. OneDrive conflict copies are merged automatically (newest Reading Position wins; highlights are combined; deleted highlights stay deleted). See [ADR 0002](docs/adr/0002-per-document-json-in-onedrive.md).

Per-machine files in the app's user-data folder (`%APPDATA%\PdfReader` for the installed app, `%APPDATA%\pdf-reader` for `npm run dev`): `recent.json` (Recent Documents) and `settings.json` (Settings).

## Development

| Script | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` | Build into `out/` |
| `npm run preview` | Run the built app |
| `npm run dist` | Build the Windows installer into `dist\` |
| `npm run icon` | Regenerate `build/icon.png` |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |

- Keep test data out of your real Data Folder: `$env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run dev`.
- If Electron starts as plain Node (`electron.app` is undefined), your shell has `ELECTRON_RUN_AS_NODE=1`; run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first.
- If `node_modules/electron/dist` has no `electron.exe` after `npm install`, run `node node_modules/electron/install.js`.
- `pdfjs-dist` is pinned to exactly `4.10.38`.
- DevTools (View > Toggle Developer Tools) exist only in development; the installed app does not have them. The Content-Security-Policy applies to production builds only.
- Domain terms are defined in [CONTEXT.md](CONTEXT.md); decisions in [docs/adr](docs/adr/); plans in [docs/superpowers/plans](docs/superpowers/plans/).

## Project structure

```
src/
  shared/     Document data and merge rules, Settings types, IPC contract, UI strings, highlight colors
  main/       Electron main: Fingerprint, Data Folder, Document store, saver, Recent, Settings, export, windows
  preload/    Typed window.api (contextIsolation + sandbox)
  renderer/   React UI: reader (pdf.js), highlights, outline, search, export, home, settings
scripts/      make-icon.mjs
build/        icon.png, installer.nsh
docs/         ADRs and implementation plans
```
