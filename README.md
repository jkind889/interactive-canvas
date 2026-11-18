# yuriful

A desktop-first freeform reference canvas: a local-only editor where you lay out images and text on an infinite, pannable, zoomable board, and group finished spreads into named **frames**. Nothing leaves your machine: there is no account, no server and no cloud storage.

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

## What it does

- Pan and zoom (hand tool, Space+drag, middle mouse, wheel pans, Ctrl/Cmd+wheel zooms, +/- and Fit buttons).
- Add images by file picker or by dropping files onto the board.
- Add text; double-click to edit; corner handles scale the font, side handles change the wrap width.
- Move, resize, rotate, multi-select, layer (forward/back/front/back), delete.
- **Frames**: named rectangles that structure a board without forcing everything into pages (see below).
- Undo / redo for every canvas change. Esc, or switching away from the window, cancels a drag, resize or frame that is still in progress.
- Autosave to this browser (IndexedDB), including the original image bytes. The header always says what the save state really is, including failures.
- Fail-closed loading: nothing is editable or saved until the stored board has loaded. If it cannot be fully restored (an image fails to decode, the document is unreadable, or storage is unavailable) the board opens **read-only** with a visible reason, pan/zoom still work, and the stored document and image bytes are never rewritten or deleted.

Out of scope for now: published projects, guest viewing, mobile and touch, auth, any backend, frames inside frames, clipping content to a frame, rotating a frame.

## Frames

A frame is a white sheet with an outline and a name label. It sits behind all content and clips nothing.

- **Draw one** with the Frame tool (`F`): drag out a rectangle, or just click for a default-sized frame. The tool is single-use.
- **Grab a frame by its label or its outline.** Its interior is click-through, so you can still select and marquee the things inside it.
- **Rename** it in the panel on the right (double-clicking the label puts the cursor there).
- **Resizing a frame alone** changes its shape freely and leaves its contents where they are.

### What belongs to a frame

Belonging is decided by what *you moved*, and it is stored; it is never guessed from where things happen to sit.

- Something joins a frame when **it** is moved, resized, rotated or created so that its centre ends inside the frame. Where frames overlap, the one in front gets it. A text's centre is the centre of its box, whose width is the wrapping width rather than the width of what is typed.
- **Moving, resizing or drawing a frame never picks anything up.** A loose image that a frame was moved over, or drawn round, sits inside it but does not travel with it. Nudge the image (or marquee several and nudge them) and they join.
- Moving a frame carries everything it owns. Something owned stays owned until you move it out, or shrink the frame until it no longer contains it (it then becomes loose, even if another frame is underneath).
- Moving a frame *together with* loose objects leaves them loose; things it already owns stay its own.
- Deleting a frame keeps its contents on the board.

The panel shows how many items a frame owns. **Select with contents** selects a frame plus everything it owns, so that you can move them, or scale them together from a corner handle.

### Transforming several things at once

A multi-selection can be moved, scaled proportionally from a corner, and (if it contains no frame) rotated. Those are exactly the transforms the saved board can represent, so nothing drifts on save, undo or reload. There is no free-aspect stretch or skew of a group, and holding Shift no longer unlocks one. When scaling would push a text below 6 px or above 400 px, or a frame below 24 units, the whole selection stops together at that point instead of some members scaling further than others.

## Storage, tabs and older builds

Everything is stored in this browser's IndexedDB, for this origin (`http://localhost:5173` and `http://127.0.0.1:5173` are different origins and have separate boards).

- **Boards saved by the previous build (milestone 1) open as they are.** Opening writes nothing. A board without frames keeps being saved in the old format.
- **The first save of a board that contains a frame upgrades the database** in the same step that writes the board. From then on the previous build can no longer open it. This is deliberate: an old tab would otherwise silently drop the frames. There is no backup and no way back to the old build for that board.
- **Two tabs on one board:** a tab never overwrites a board that another tab has changed since it loaded or last saved. It becomes read-only with a Reload button, and whatever it had not yet saved is not saved.
- If another tab holds the database while a frame is first being saved, the save fails after a few seconds with a Retry; close the other tab and retry.

### Known limits

- One board per browser profile and origin.
- Until a board has its first frame, an open tab of the previous build can still overwrite it or prune its unused images, as it always could. This build reports the conflict instead of overwriting back, and re-stores any image bytes that are missing the next time it saves.
- Image bytes are stored as uploaded (no downscaling) and are also kept in memory for the session, so that undo can always bring an image back; very large images are limited by browser storage quota, and a failed write is reported in the header.
- Something sitting inside a frame without belonging to it looks the same as something that does. The item count and "Select with contents" tell you which is which.
- A new text box is wider than what you type into it (ten times its font size), and belonging goes by the centre of that box. A text started in the right part of a frame can therefore end up not belonging to it, and one started just left of a frame can end up belonging to it; drag the text, or narrow it with a side handle, to settle it. Whether a new text should instead belong to the frame that was clicked in is an open design question.
- Touch input is not supported.

## Testing

```sh
npm run lint && npm run typecheck && npm test && npm run build

npm run test:e2e:install   # once: downloads Playwright's bundled Chromium
npm run test:e2e           # starts its own dev server on :5199 and runs e2e/*.spec.ts
```

- **Unit tests** (`src/**/*.test.ts`, Vitest) cover the pure model (documents, ownership rules, scale limits, hit geometry), history, persistence (revision tokens, the database upgrade, asset presence, with `fake-indexeddb`), keyboard handling, and the `Editor` state machines (hydration, gestures, frames) on a small fake of Fabric, since jsdom has no canvas.
- **e2e tests** (`e2e/`, Playwright) run the real app with real Fabric and real IndexedDB in a real browser: `hydration.spec.ts` (nothing is editable or saved before the board has loaded; a board that cannot be restored is read-only and untouched), `gestures.spec.ts` (what a save sees during a drag, cancelling, mouse buttons, the single scale factor), `frames.spec.ts` (drawing, hit testing, ownership, carrying, resizing) and `storage.spec.ts` (opening a milestone 1 board, the upgrade, two tabs). Fixtures are generated in code, including boards written by a frozen copy of the previous build's storage code; each test gets an isolated browser context, so it never touches your own profile or data.
- Use a browser already on your machine instead of the bundled one with `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`; change the port with `E2E_PORT`.
- Failure traces and screenshots go to `test-results/` (git-ignored).

## Keyboard shortcuts

Shortcuts never fire while you are typing in a field or editing text. While a drag, resize or frame is in progress only `Esc` and the zoom keys respond.

| Key                         | Action                         |
| --------------------------- | ------------------------------ |
| `V` / `H` / `T` / `F` / `I` | Select / Hand / Text / Frame / Add image |
| `Space` (hold)              | Temporary hand                 |
| `Ctrl/Cmd+Z`                | Undo                           |
| `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`| Redo                           |
| `Delete` / `Backspace`      | Delete selection               |
| `Ctrl/Cmd+A`                | Select all                     |
| `[` / `]`                   | Send backward / bring forward (frames stay behind content) |
| `Ctrl/Cmd+[` / `]`          | Send to back / bring to front  |
| `+` / `-` / `0` / `Shift+1` | Zoom in / out / 100% / fit     |
| `Esc`                       | Cancel what is in progress; otherwise leave the tool, or deselect |

Only the primary mouse button edits. The middle button pans.

## Architecture

- **Fabric.js 7** (MIT) renders and edits the canvas. React renders only the chrome (header, toolbar, inspector) and never touches Fabric objects.
- `src/editor/Editor.ts` is the single bridge: it owns the Fabric canvas, history, assets and autosave, and exposes an immutable `EditorState` snapshot through `subscribe`/`getState` (`useSyncExternalStore`). Fabric's event callbacks only record facts; a finished gesture is settled in a microtask after Fabric's own mouse-up handling, and a save during a gesture stores the board from before it.
- `src/editor/FrameCanvas.ts` extends Fabric's canvas for frames (what counts as a hit, Shift-click and marquee rules) and `src/editor/frameLayer.ts` holds the one geometry used both to draw a frame's outline and label and to hit them.
- `src/model/` is pure and unit-tested: document types and validation, the frame ownership rules and scale limits (`frames.ts`), snapshot `History` (with coalescing), layer reordering, viewport math.
- `src/persistence/` has the IndexedDB store (document and image bytes written in one transaction, guarded by a revision token) and the `Autosaver` status machine.
- `src/input/shortcuts.ts` maps key events to actions and decides when to stay out of the way.

The saved document references images by id; the bytes live in a separate IndexedDB store. Frames have stable ids, names and unrotated rectangles, and each object records the frame that owns it. Undo/redo restores objects from serialized snapshots, using already-decoded images, so it is synchronous.
