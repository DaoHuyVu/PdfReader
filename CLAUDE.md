# CLAUDE.md

PdfReader: personal Windows desktop PDF reader that remembers the Reading Position and lets the reader highlight text and attach Notes, without modifying the PDF. One user, one developer; data syncs between machines through personal OneDrive.

- Main process: Electron 38, Node `fs/promises`, `crypto` (no other runtime library)
- Renderer: React 19, `pdfjs-dist` 4.10.38, plain hooks (no router, no store library)
- Build and package: electron-vite 4 (Vite 7), electron-builder (NSIS, Windows x64), TypeScript 5.9, Vitest 3

Domain terms, and the words to avoid: `CONTEXT.md`. Decisions: `docs/adr/`.

## Commands

Prerequisites: Node.js 20.19+ or 22.12+. Clear `ELECTRON_RUN_AS_NODE` before running Electron. Set `PDFREADER_DATA_DIR` to a temp folder so test data stays out of the real Data Folder.

| Task | Command |
|---|---|
| Build | `npm run build` (output in `out/`) |
| Test | `npm test` |
| Typecheck | `npm run typecheck` |
| Run | `npm run dev` |
| Run built app | `npm run preview`, or `npx electron . "<file>.pdf"` |
| Installer | `npm run dist` (output in `dist\`) |

## Project rules

- The app never writes to, renames or deletes the user's PDF files. Export writes a new file.
- Opening a Document writes nothing by itself. The Reading Position is saved only after the reader scrolls or zooms.
- Passwords are never stored or logged.
- Data files are written atomically (temp file + rename). An unreadable file is renamed to `<fingerprint>.corrupt-<time>.bak`, never deleted. A file with a newer `schemaVersion` is left untouched.
- Work or school OneDrive (`%OneDrive%`, `%OneDriveCommercial%`) is never used as the Data Folder.
- Paths are Windows paths. Compare them case-insensitively.
- Search ignores case and Vietnamese diacritics (`foldText` in `reader/highlights/textIndex.ts`).
- `pdfjs-dist` stays pinned to exactly `4.10.38`. Do not widen the range.
- `npm run typecheck` and `npm test` pass before every commit.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Coding Style

These rules hold in every language here. Mechanics (format, casing, import order) belong to the tools in §6.

- **Names reveal intent.** One concept, one word, everywhere; use the `CONTEXT.md` terms (Document, Reading Position, Highlight, Carry Over). Spell words out; keep only abbreviations the industry already uses (`id`, `url`, `ipc`).
- **One function, one job.** Return early on guard conditions. Nest 3 levels deep at most. Give every meaningful literal a name.
- **Pure logic stands apart from IO.** Rules, calculations and mapping take data and return data. Files, IPC, clock, pdf.js and React call into them. Pure logic is tested without mocks.
- **Dependencies flow one way**, in the direction §7 gives. A circular import is a bug.
- **A component owns one responsibility**, with explicit inputs and outputs. Side effects live where the name announces them (`main/` stores and IPC handlers, `use…` hooks, `useEffect`, event handlers).
- **Errors surface.** Every caught error is handled, rethrown, or logged with context (`console.error('Failed to …', err)`). IPC payloads arrive as `unknown`, pass a type guard, and invalid ones `throw new Error(…)`. Expected failures are `{ ok: false; reason }` unions such as `OpenResult`. The renderer reports failures with `alert()`. Validate at boundaries (IPC, file read), then trust the data inside.
- **Comments say why**: intent, constraints, gotchas. The code says what. Delete dead code; git keeps history.
- **Tests live next to the file they test** as `x.test.ts` (Vitest, node environment, pure logic only; UI is checked by running the app) and are named for behaviour: `describe('DocumentStore')`, `it('backs up a corrupt main file instead of deleting it')`.
- **New dependencies are a decision.** Ask before adding a package, framework or service. Use what the stack already has first.

## 6. Language Standards

- **TypeScript / TSX**: `strict`, `noUnusedLocals`, `noUnusedParameters`; no semicolons, single quotes, 2-space indent, named exports only (no `export default`) · `tsconfig.json` (ESLint, Prettier: no config yet) · `npm run typecheck`
- **CSS**: one file, `src/renderer/src/styles.css`; hard-coded colors, dark mode as `html.dark .x` overrides · no config yet · none
- **HTML**: one file, `src/renderer/index.html` (`lang="vi"`) · no config yet · none

## 7. Folder Structure

Electron's three processes plus a shared contract. Renderer is close to a feature-based SPA, main is one flat module per concern. Dependencies point `main`, `preload`, `renderer` → `shared`; `shared` imports nothing outside itself. The renderer reaches `main` only through `window.api` (IPC). Inside the renderer, `reader → reader/{highlights,outline,search}`.

```
src/
  shared/        # IPC map + PdfReaderApi, domain types/guards/merge, settings types, colors, UI strings
  main/          # index.ts: lifecycle + all IPC handlers; windows, stores, Fingerprint, Data Folder
  preload/       # builds the typed window.api from shared/ipc.ts
  renderer/
    index.html
    src/         # App.tsx screen switch, styles.css (all styles)
      home/      # Recent Documents screen
      settings/  # Settings screen + useSettings
      reader/    # ReaderView, PdfPage, pdf.js wrapper, layout math, throttle
        highlights/  # components, useHighlights, geometry/textIndex/reanchor logic
        outline/     # outline panel + logic
        search/      # Ctrl+F bar, hit layer, search logic
docs/
  adr/           # architecture decision records
  superpowers/plans/  # implementation plans
```

### Where new code goes

| New code | Location | File naming |
|---|---|---|
| IPC channel | `IPC` + `PdfReaderApi` in `shared/ipc.ts`, handler in `main/index.ts`, bridge in `preload/index.ts` | channel `'<domain>:<kebab-action>'` |
| Domain type, guard, merge rule | `shared/documentData.ts` | grouped in that file |
| UI text | `t.<screen>.*` in `shared/strings.ts` | Vietnamese value; function for interpolation |
| Main-process store or service | `main/<concern>.ts` + `<concern>.test.ts` | camelCase file, class `XStore` |
| Screen | `renderer/src/<screen>/XView.tsx` | PascalCase |
| Reader feature | `renderer/src/reader/<feature>/` | `X.tsx` component, `x.ts` logic, `useX.ts` hook |
| Styles | `renderer/src/styles.css` | hard-coded colors + `html.dark` override |

Ask before creating a top-level folder, or a folder that fits no row above.

## 8. Reuse

Before writing a helper, hook, component, service or style block:

1. Search `src/shared/`, `reader/layout.ts`, `reader/throttle.ts`, `reader/highlights/` and the feature folder for an existing one.
2. Close match: extend it.
3. No match: write it inside the feature. Move it to a shared location on its third use.

| Shared kind | Location |
|---|---|
| Cross-process types, guards, IPC contract, UI strings | `src/shared/` |
| Scroll and zoom math | `src/renderer/src/reader/layout.ts` |
| Throttle | `src/renderer/src/reader/throttle.ts` |
| Text index, diacritic folding, text matching | `src/renderer/src/reader/highlights/textIndex.ts` |
| Highlight palette and CSS color | `src/shared/highlightColors.ts` |

Modules are deep: a small interface with the logic hidden behind it. Add behaviour to the existing module instead of wrapping it.

**Known debt.** Leave these as they are; new code follows the right-hand column.

| Debt | Where | New code does |
|---|---|---|
| Atomic JSON write copied 3× | `main/documentStore.ts`, `settings.ts`, `recent.ts` | Export and reuse `writeAtomic`; no 4th copy |
| Promise-queue serialization copied 3× | same 3 stores | Reuse one by export; no 4th copy |
| `isRecord` duplicated | `shared/documentData.ts` (private), `main/settings.ts` | Export it from `documentData.ts` |
| Scroll-to-target math 3×, group-by-page 4× | `highlights/geometry.ts`, `search/search.ts`, `outline/outline.ts` | Next use: one helper in `reader/layout.ts` |
| Color swatch buttons 3× | `HighlightMenu`, `HighlightPanel`, `SelectionToolbar` | Next use: extract one swatch component in `highlights/` |
| `textIndex` used outside `highlights/` | `reader/highlights/textIndex.ts` | Import it from there; do not move or copy it |
| `ReaderView.tsx` 611 lines, `ReaderSurface` ~25 state items | `reader/ReaderView.tsx` | New feature in its own subfolder + hook; `ReaderSurface` only wires it in |
| No CSS custom properties; dark mode as overrides | `styles.css` | Match it: hard-coded colors + `html.dark` override |

## 9. Naming and Language

- Identifiers (types, functions, variables, files): English.
- Comments, test names, error messages, log messages: English. UI strings: Vietnamese, only in `src/shared/strings.ts`.
- Domain codes that are data, not names, keep their exact spelling: IPC channels (`document:save-highlight`), Highlight colors (`'yellow' | 'green' | 'blue' | 'pink' | 'orange'`), themes (`'system' | 'light' | 'dark'`), `schemaVersion: 1`.

## 10. Commits

Conventional Commits (`feat`, `fix`, `docs`, `chore`), description in English: `feat: search the Document with Ctrl+F`. No scope.
