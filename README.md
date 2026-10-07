# PdfReader

A personal desktop PDF reader for Windows that remembers where you stopped reading. It never modifies your PDF files.

> **Status:** Plan 1 (Reader Core) is done: reading, zoom, and an automatically saved reading position. Highlights, Notes, search, dark mode and an installer are planned (see [Roadmap](#roadmap)).

## Features

- Continuous vertical scrolling. Only pages near the viewport are rendered, so large PDFs stay smooth.
- Zoom modes: fit width, fit page, and fixed steps from 25% to 400%.
- Automatic **Reading Position**: the app saves the page, the position within the page, and the zoom, then reopens the Document exactly there. It saves only after you scroll or zoom; opening a file alone writes nothing.
- A Document is identified by its content, not its path. Renamed, moved or copied files keep their position. See [ADR 0001](docs/adr/0001-identify-documents-by-content.md).
- **Recent Documents** screen that shows the reading progress of each file.
- One window per Document. Opening a file that is already open focuses its window.
- Opens directly when you launch it with a `.pdf` path, for example "Open with" from Explorer. Only one app instance runs.
- Vietnamese user interface.

## Requirements

- Windows 10 or 11 (x64)
- Node.js 20.19+ or 22.12+ (required by Vite 7)

## Getting started

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Starts the app with hot reload |
| `npm run build` | Builds main, preload and renderer into `out/` |
| `npm run preview` | Runs the built app |
| `npm run typecheck` | Runs TypeScript with no output files |
| `npm test` | Runs the Vitest unit tests |

To open a PDF directly with the built app:

```bash
npm run build
npx electron . "D:\Books\some.pdf"
```

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+O` | Open a PDF |
| `Ctrl+H` | Show Recent Documents |
| `Ctrl+=` / `Ctrl++` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Fit width |

## Where data is stored

The app keeps one JSON file per Document in the **Data Folder**, under `documents\<fingerprint>.json`. The Data Folder is chosen in this order:

1. `PDFREADER_DATA_DIR`, if this environment variable is set
2. `%OneDriveConsumer%\PdfReaderData`: your personal OneDrive, so every machine sees the same data
3. `%APPDATA%\PdfReader`: local only, no sync

Work or school OneDrive (`%OneDrive%`, `%OneDriveCommercial%`) is ignored on purpose, so personal reading data never syncs into an employer's tenant.

How sync works:
- When two machines change the same Document while offline, OneDrive creates a Conflict Copy. The app merges it the next time it loads that Document and then deletes the copy. The most recently updated Reading Position wins.
- A data file that cannot be read is renamed to `<fingerprint>.corrupt-<time>.bak` and is never deleted.
- A data file written by a newer app version (`schemaVersion` > 1) is left untouched.

See [ADR 0002](docs/adr/0002-per-document-json-in-onedrive.md).

The Recent Documents list is stored per machine in `%APPDATA%\pdf-reader\recent.json`, because file paths differ between machines.

## Development notes

- **Keep test data out of your real Data Folder.** Set `PDFREADER_DATA_DIR` first:
  ```powershell
  $env:PDFREADER_DATA_DIR = "$env:TEMP\pdfreader-dev"; npm run dev
  ```
  This does not isolate the Recent Documents list, which is always in `%APPDATA%\pdf-reader`.
- **Error `electron.app` is undefined, or Electron starts as plain Node:** your environment has `ELECTRON_RUN_AS_NODE=1` set. Some tool and agent environments set it. Clear it before running:
  ```powershell
  Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run dev
  ```
- **Electron binary missing after `npm install`** (`node_modules/electron/dist` has no `electron.exe`): run `node node_modules/electron/install.js` again.
- `pdfjs-dist` is pinned to exactly `4.10.38`. Do not widen the version range.

## Project structure

```
src/
  shared/      Types and logic used by both processes: Document data and merge rules, IPC contract, UI strings
  main/        Electron main process: Fingerprint, Data Folder, Document store, position saver, Recent list, windows
  preload/     Exposes the typed window.api to the renderer (contextIsolation + sandbox)
  renderer/    React UI: reader view (pdf.js) and Recent Documents view
docs/
  adr/         Architecture decision records
  superpowers/plans/  Implementation plans
CONTEXT.md     Domain glossary: use these terms in code and discussion
```

Unit tests sit next to the code they test (`*.test.ts`). They cover the pure logic: Fingerprint, merge rules, Document store, position saver, Recent list, and the page layout math.

## Roadmap

- **Plan 2: Highlights & Notes.** Select text and pick one of 5 colors (keys `1`–`5`), attach Notes, show a Highlight sidebar with color filter and search, re-anchor Highlights when a file changes, and Carry Over data to a changed file.
- **Plan 3: Reader features.** Ctrl+F search, outline sidebar, dark mode with optional page inversion, password-protected PDFs, a notice for scanned PDFs without text, and a Settings screen to choose the Data Folder.
- **Plan 4: Export & packaging.** Export a new PDF that contains Highlights and Notes (the original file is never changed), and an NSIS installer with "Open with" registration.
