# yuriful

A desktop-first freeform reference canvas. Milestone 1: a local-only editor where you can lay out images and text on an infinite, pannable, zoomable board. Nothing leaves your machine: there is no account, no server and no cloud storage.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

| Script              | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Vite dev server                       |
| `npm run build`     | Typecheck, then production build      |
| `npm run typecheck` | `tsc -b --noEmit`                     |
| `npm run lint`      | ESLint                                |
| `npm test`          | Vitest (unit tests)                   |
| `npm run test:e2e`  | Playwright real-browser regression tests |
| `npm run test:e2e:install` | One-time: download Playwright's Chromium |

## What milestone 1 does

- Pan and zoom (hand tool, Space+drag, middle mouse, wheel pans, Ctrl/Cmd+wheel zooms, +/- and Fit buttons).
- Add images by file picker or by dropping files onto the board.
- Add text; double-click to edit; corner handles scale the font, side handles change the wrap width.
- Move, resize, rotate, multi-select, layer (forward/back/front/back), delete.
- Undo / redo for every canvas change.
- Autosave to this browser (IndexedDB), including the original image bytes. The header always says what the save state really is, including failures.
- Fail-closed loading: nothing is editable or saved until the stored board has loaded. If it cannot be fully restored (an image fails to decode, the document is unreadable, or storage is unavailable) the board opens **read-only** with a visible reason, pan/zoom still work, and the stored document and image bytes are never rewritten or deleted.

Out of scope for now: frames, published projects, guest viewing, mobile, auth, any backend.

## Testing

```sh
npm run lint && npm run typecheck && npm test && npm run build

npm run test:e2e:install   # once: downloads Playwright's bundled Chromium
npm run test:e2e           # starts its own dev server on :5199 and runs e2e/*.spec.ts
```

- **Unit tests** (`src/**/*.test.ts`, Vitest) cover the pure model, history, persistence, keyboard handling and the `Editor` hydration/read-only behavior (with a small fake of Fabric, since jsdom has no canvas).
- **e2e tests** (`e2e/`, Playwright) run the real app in a real browser. `e2e/hydration.spec.ts` stalls hydration deterministically (it holds back IndexedDB's `open` event) and fires keyboard, pointer, wheel, file-picker and drop input; it also corrupts a stored image's bytes and checks that the board is read-only and that the original document and every asset byte (hashed) are unchanged after edit attempts and reloads. Fixtures are generated in code; each test gets an isolated browser context, so it never touches your own profile or data.
- Use a browser already on your machine instead of the bundled one with `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`; change the port with `E2E_PORT`.
- Failure traces and screenshots go to `test-results/` (git-ignored).

## Keyboard shortcuts

Shortcuts never fire while you are typing in a field or editing text.

| Key                         | Action                         |
| --------------------------- | ------------------------------ |
| `V` / `H` / `T` / `I`       | Select / Hand / Text / Add image |
| `Space` (hold)              | Temporary hand                 |
| `Ctrl/Cmd+Z`                | Undo                           |
| `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`| Redo                           |
| `Delete` / `Backspace`      | Delete selection               |
| `Ctrl/Cmd+A`                | Select all                     |
| `[` / `]`                   | Send backward / bring forward  |
| `Ctrl/Cmd+[` / `]`          | Send to back / bring to front  |
| `+` / `-` / `0` / `Shift+1` | Zoom in / out / 100% / fit     |
| `Esc`                       | Leave tool, or deselect        |

## Architecture

- **Fabric.js 7** (MIT) renders and edits the canvas. React renders only the chrome (header, toolbar, inspector) and never touches Fabric objects.
- `src/editor/Editor.ts` is the single bridge: it owns the Fabric canvas, history, assets and autosave, and exposes an immutable `EditorState` snapshot through `subscribe`/`getState` (`useSyncExternalStore`).
- `src/model/` is pure and unit-tested: document types and validation, snapshot `History` (with coalescing), layer reordering, viewport math.
- `src/persistence/` has the IndexedDB store (document and image bytes written in one transaction) and the `Autosaver` status machine.
- `src/input/shortcuts.ts` maps key events to actions and decides when to stay out of the way.

The saved document references images by id; the bytes live in a separate IndexedDB store. Undo/redo restores objects from serialized snapshots, using already-decoded images, so it is synchronous.

### Known limits

- One board per browser profile. Two tabs open on the same board will overwrite each other's saves.
- Image bytes are stored as uploaded (no downscaling); very large images are limited by browser storage quota, and a failed write is reported in the header.
