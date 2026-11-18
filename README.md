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
- **Layers**: a list of everything on the board in stacking order, so that something completely covered can still be selected (see below).
- **Locking**: lock a background image, a finished frame or anything else, so that it cannot be grabbed, moved or changed by accident while everything around it stays reachable (see below).
- **Images: crop, fit and fill**: crop a reference image down to the part that matters without losing the original, change the crop later or undo it, and fit or fill an image to its box (see below).
- Undo / redo for every canvas change. Esc, or switching away from the window, cancels a drag, resize or frame that is still in progress.
- Autosave to this browser (IndexedDB), including the original image bytes. The header always says what the save state really is, including failures.
- Fail-closed loading: nothing is editable or saved until the stored board has loaded. If it cannot be fully restored (an image fails to decode, the document is unreadable, or storage is unavailable) the board opens **read-only** with a visible reason, pan/zoom still work, and the stored document and image bytes are never rewritten or deleted.

Out of scope for now: published projects, guest viewing, mobile and touch, auth, any backend, frames inside frames, clipping content to a frame, rotating a frame.

## Frames

A frame is a white sheet with an outline and a name label. It sits behind all content and clips nothing.

- **Draw one** with the Frame tool (`F`): drag out a rectangle, or just click for a default-sized frame. The tool is single-use.
- **Grab a frame by its label or its outline.** Its interior is click-through, so you can still select and marquee the things inside it.
- **Rename** it in the panel on the right (double-clicking the label, or the outline, puts the cursor there). A name you are typing is kept when you click elsewhere; Esc discards it.
- **Resizing a frame alone** changes its shape freely and leaves its contents where they are.

### What belongs to a frame

Belonging is decided by what *you moved*, and it is stored; it is never guessed from where things happen to sit.

- Something joins a frame when **it** is moved, resized, rotated or created so that its centre ends inside the frame. Where frames overlap, the one in front gets it. A text's centre is the centre of its box, whose width is the wrapping width rather than the width of what is typed.
- **Moving, resizing or drawing a frame never picks anything up.** A loose image that a frame was moved over, or drawn round, sits inside it but does not travel with it. Nudge the image (or marquee several and nudge them) and they join.
- Moving a frame carries everything it owns. Something owned stays owned until you move it out, or shrink the frame until it no longer contains it (it then becomes loose, even if another frame is underneath).
- Moving a frame *together with* loose objects leaves them loose; things it already owns stay its own.
- Deleting a frame keeps its contents on the board.

The panel shows how many items a frame owns. **Select with contents** selects a frame plus everything it owns that is not locked, so that you can move them, or scale them together from a corner handle.

### Transforming several things at once

A multi-selection can be moved, scaled proportionally from a corner, and (if it contains no frame) rotated. Those are exactly the transforms the saved board can represent, so nothing drifts on save, undo or reload. There is no free-aspect stretch or skew of a group, and holding Shift no longer unlocks one. When scaling would push a text below 6 px or above 400 px, or a frame below 24 units, the whole selection stops together at that point instead of some members scaling further than others.

## Layers

The **Layers** panel at the bottom right lists everything on the board, front-most first: all images and texts from front to back, then all frames from front to back (frames always sit behind content). Its header collapses and expands it.

- **Click a row to select that object**, even one hidden completely under a bigger image. Ctrl/Cmd-click or Shift-click adds a row to the selection or takes it out, so you can build a multi-selection from the list and then move or scale it on the board.
- **Alt-drag moves a covered object you selected from the list.** Its handles work as usual, but a plain press on its body goes to whatever lies on top of it, as everywhere on the board (inside the box of a multi-selection a press goes to the selection, Alt or not). Hold Alt while pressing and the press goes to the selected object instead, if it is under the pointer. It is an ordinary drag: one undo step, cancelled by Esc (even with Alt still held), and dragged out of its frame it stops belonging to it. A frame's label or outline still wins over it.
- `[` / `]` and the Layer buttons in the panel on the right reorder the selection; the list shows the new order straight away.
- A text's row follows what you type. While a text is empty it is not listed, because an empty text is never kept.
- The list is flat. Something that belongs to a frame is not shown inside it, because stacking order is shared by the whole board and has nothing to do with belonging; its row shows the frame's name instead.
- Selecting from the list changes nothing on the board, so it is never an undo step and never saves. If you were typing a text, leaving it works as when you click anywhere else: typed text is kept as its own undo step, and a text left empty is discarded. A field you were typing in (font size, frame name, board title) keeps what you typed and lets go, so your next keys act on the board.
- Each row has a padlock at its right edge (it shows on hover, and always on a locked row). See Locking.
- On a read-only board the list still shows what is there, but its rows and padlocks do nothing.

## Locking

A locked image, text or frame stays exactly where it is until you unlock it. It is meant for a background image you keep pressing on by accident, or a finished frame you do not want to nudge.

- **Lock** with the padlock on its row in the layer list, the **Lock** button in the panel on the right, or `Ctrl/Cmd+Shift+L`. Locking several selected things locks them all.
- **It cannot be grabbed on the board.** A press on it goes to whatever lies beneath, as if it were not there: drag a small image out from under a locked background, or drag across the background to marquee what is on it. A marquee, Select all and Shift-click leave it out, a double-click does not edit a locked text, and a locked frame cannot be grabbed by its label or outline. With the Text tool, a click on a locked image places a new text there.
- **Unlock** with the padlock on its row (it stays visible on a locked row), or select the row and press **Unlock** (or `Ctrl/Cmd+Shift+L`). Clicking a padlock never selects the row.
- **The layer list is the only way to select it**, and then only on its own: a selection that contains a locked item contains nothing else. Ctrl/Cmd- or Shift-clicking a locked row selects just it, and Ctrl/Cmd- or Shift-clicking another row then selects just that one. While it is selected it shows its outline but no handles, and nothing changes it: it cannot be moved, resized or deleted, it keeps its place in the stacking order, and its font size or frame name cannot be changed.
- **It still belongs to its frame.** Moving the frame carries a locked image with it. "Select with contents" leaves locked things out, so they follow a move but are not scaled with the frame; like anything else, a locked item is no longer the frame's once the frame is resized so that it no longer contains it. Deleting a frame leaves its locked things on the board. Things can still be moved into or out of a locked frame, and its unlocked contents can be edited as usual.
- Locking and unlocking are undo steps and are saved, like any other change. They never move anything or change what belongs to which frame.

## Images: crop, fit and fill

Select one image and the panel on the right shows **Crop**, **Fit** and **Fill**.

### Crop

- **Start** with **Crop**, or double-click the image (with the Select tool). The whole original appears in place, the part outside the crop is dimmed, and a box with eight handles shows what will be kept. Nothing on the board moves: the part you keep stays exactly where it was.
- **Drag a handle** to move that edge or corner (any shape you like), or **drag inside the box** to move it over the image. The box always stays on the image and never gets smaller than 8 units a side.
- **Apply** with Enter, **Done**, or by clicking anywhere outside the box (that click does nothing else). **Cancel** with Esc or **Cancel**: the image is exactly as it was and nothing is recorded.
- Pan and zoom work as usual while cropping (wheel, Space-drag, middle button, the zoom keys and buttons). Every other key waits. Clicking a tool, a layer row, Undo or another button applies the crop first and then does what you clicked.
- **Cropping never throws anything away.** The original image is kept whole; crop it again later and the whole original comes back, so you can widen the crop or drag it back out to the full image (the crop is then gone). A crop is one undo step.
- A crop counts as resizing the image: if what is left has its centre outside the frame it belonged to, it no longer belongs to it (and joins a frame in front that does contain its centre, as when you resize it).

### Fit and Fill

Both keep the image where it is and work on its current box: what you see of it now.

- **Fill** keeps the box exactly as it is and fills it with as much of the image as fits, centred. For example, a 600 x 400 photo cropped to its top-left corner as a square: Fill keeps the square and shows the middle 400 x 400 of the photo in it instead.
- **Fit** shows the whole image again, as large as fits inside the box, centred on it. The square from the example becomes a 3:2 picture as wide as the square, centred where the square was. Since an image has no empty area, the box shrinks to the image's shape.
- Each is one undo step. A button that would change nothing is greyed out. Fit counts as resizing for frame belonging, like a crop; Fill never changes what belongs to which frame.

A locked image cannot be cropped, fitted or filled until it is unlocked.

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
- The layer list cannot be stepped through with the arrow keys (Tab and Enter work), and it is not laid out for windows shorter than about 600 px.
- Locks and crops are stored as extra fields that any older build does not know (milestone 1, and the frames build from before locking): such a build reads only the fields it knows. Where it can still open the board (milestone 1 cannot open one that has frames), it ignores locks, and it shows a cropped image whole, at the same scale, with the original's top-left corner where the crop's top-left corner was (so the image is larger and its content shifts). When that build saves the board, the locks and crops are gone.
- The padlock on a layer row is a button inside a list option. Some screen readers may not announce it, and each row has two Tab stops (the row and its padlock).
- While cropping, the dimmed part of the image and the crop box are drawn over everything, including anything that lies on top of the image; the image itself keeps its place in the stacking order.
- Starting a crop with the Hand tool selected switches to the Select tool (as from the Text and Frame tools), so the crop box can be dragged straight away.
- A crop handle is grabbed within 8 screen pixels. On a very small crop box the handles cover the whole box, so it can be resized but not moved; zoom in to move it.
- On the board itself nothing shows that something is locked, apart from the plain cursor over it and the fact that it does not respond; the padlock in the layer list does show it.
- A locked item selected from the list is let go as soon as you press on it on the board, because the press goes to whatever lies beneath it (or starts a marquee).
- "Select with contents" stays available for a frame that owns only locked things; it then selects the frame alone.
- Alt+double-click on a covered text that you selected from the list starts editing it while it is still hidden under whatever covers it, so typing changes text you cannot see. Whether that double-click should be ignored, or bring the text into view, is an open design question.

## Testing

```sh
npm run lint && npm run typecheck && npm test && npm run build

npm run test:e2e:install   # once: downloads Playwright's bundled Chromium
npm run test:e2e           # starts its own dev server on :5199 and runs e2e/*.spec.ts
```

- **Unit tests** (`src/**/*.test.ts`, Vitest) cover the pure model (documents, ownership rules, scale limits, hit geometry), history, persistence (revision tokens, the database upgrade, asset presence, with `fake-indexeddb`), keyboard handling, crop, Fit and Fill geometry, and the `Editor` state machines (hydration, gestures, frames, layers, locking, crop mode, Fit and Fill) on a small fake of Fabric, since jsdom has no canvas.
- **e2e tests** (`e2e/`, Playwright) run the real app with real Fabric and real IndexedDB in a real browser: `hydration.spec.ts` (nothing is editable or saved before the board has loaded; a board that cannot be restored is read-only and untouched), `gestures.spec.ts` (what a save sees during a drag, cancelling, mouse buttons, the single scale factor), `frames.spec.ts` (drawing, hit testing, ownership, carrying, resizing), `layers.spec.ts` (selecting covered objects from the layer list and Alt-dragging them, reordering, multi-selections built from the list, leaving a text edit, the panel's place on screen), `locking.spec.ts` (presses, marquees and Shift-click passing through locked things, a locked member travelling with its frame, the three ways to lock, undo, save and reload), `images.spec.ts` (cropping by handles and by moving the box, on rotated and scaled images, proving with canvas pixel samples that the kept pixels do not move; cancelling; what a save and a reload see mid-crop; Fit and Fill; frame belonging; a cropped image in a multi-selection) and `storage.spec.ts` (opening a milestone 1 board, the upgrade, two tabs). Fixtures are generated in code, including boards written by a frozen copy of the previous build's storage code; each test gets an isolated browser context, so it never touches your own profile or data.
- Use a browser already on your machine instead of the bundled one with `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`; change the port with `E2E_PORT`.
- Failure traces and screenshots go to `test-results/` (git-ignored).

## Keyboard shortcuts

Shortcuts never fire while you are typing in a field or editing text. While a drag, resize or frame is in progress only `Esc` and the zoom keys respond. While cropping only `Enter`, `Esc`, the zoom keys and `Space` respond.

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
| `Ctrl/Cmd+Shift+L`          | Lock the selection; unlock a locked one |
| `+` / `-` / `0` / `Shift+1` | Zoom in / out / 100% / fit     |
| `Esc`                       | Cancel what is in progress (also a crop); otherwise leave the tool, or deselect |
| `Enter` (while cropping)    | Apply the crop                 |
| Double-click an image       | Crop it                        |

Only the primary mouse button edits. The middle button pans. Holding Alt while pressing acts on the selected object even when something lies on top of it (see Layers); without Alt a press goes to the front-most object (inside the box of a multi-selection, to the selection), and a frame's label or outline wins either way. A locked object is never what a press goes to.

## Architecture

- **Fabric.js 7** (MIT) renders and edits the canvas. React renders only the chrome (header, toolbar, inspector, layer list) and never touches Fabric objects.
- `src/editor/Editor.ts` is the single bridge: it owns the Fabric canvas, history, assets and autosave, and exposes an immutable `EditorState` snapshot through `subscribe`/`getState` (`useSyncExternalStore`). Fabric's event callbacks only record facts; a finished gesture is settled in a microtask after Fabric's own mouse-up handling, and a save during a gesture stores the board from before it.
- `src/editor/FrameCanvas.ts` extends Fabric's canvas for frames (what counts as a hit, Shift-click and marquee rules) and `src/editor/frameLayer.ts` holds the one geometry used both to draw a frame's outline and label and to hit them.
- `src/model/` is pure and unit-tested: document types and validation, the frame ownership rules and scale limits (`frames.ts`), crop, Fit and Fill geometry (`crop.ts`), snapshot `History` (with coalescing), layer reordering, viewport math. `src/editor/cropLayer.ts` draws crop mode's box and handles from the same geometry that is hit.
- `src/persistence/` has the IndexedDB store (document and image bytes written in one transaction, guarded by a revision token) and the `Autosaver` status machine.
- `src/input/shortcuts.ts` maps key events to actions and decides when to stay out of the way.

The saved document references images by id; the bytes live in a separate IndexedDB store. Frames have stable ids, names and unrotated rectangles, and each object records the frame that owns it. Undo/redo restores objects from serialized snapshots, using already-decoded images, so it is synchronous.
