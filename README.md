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
- Add text with the Text tool (`T`): click for a default box, or drag out a box to choose its wrapping width (see below); double-click to edit; corner handles scale the font, side handles change the wrap width.
- Formatted text: bold, italic, underline and strikethrough on ranges of characters, headings (2, 1.5 or 1.25 times the box's font size, always bold) on whole lines, and a font, alignment and colour for the whole box, applied from the panel or with `Ctrl/Cmd+B`, `I`, `U` (see below). Formatting is drawn on the board and kept through saving, reloading, undo and redo, moving, scaling, changing the font size, typing, pasting and dropping text.
- Move, resize, rotate, multi-select, layer (forward/back/front/back), delete.
- **Frames**: named rectangles that structure a board without forcing everything into pages (see below).
- Undo / redo for every canvas change. Esc, or switching away from the window, cancels a drag, resize, frame or text box that is still in progress.
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

The panel shows how many items a frame owns. **Select with contents** selects a frame plus everything it owns, so that you can move them, or scale them together from a corner handle.

### Transforming several things at once

A multi-selection can be moved, scaled proportionally from a corner, and (if it contains no frame) rotated. Those are exactly the transforms the saved board can represent, so nothing drifts on save, undo or reload. There is no free-aspect stretch or skew of a group, and holding Shift no longer unlocks one. When scaling would push a text below 6 px or above 400 px, or a frame below 24 units, the whole selection stops together at that point instead of some members scaling further than others.

## Text boxes

With the Text tool (`T`), click on the board for a text box of the default width (ten times its font size), or press and drag out a rectangle: the box starts at its top-left corner and takes its **width**, which is where the text wraps. The box is always exactly as tall as its text; the height you drag is only a guide. The font size is the same as for a click (it depends on the zoom). A drag of less than a few pixels, or one narrower than two font sizes (a wobble, or a mostly vertical drag), counts as a click: you get the default box with its top-left corner where you pressed.

- You can drag out a box inside a frame (a frame's interior is click-through). Like any new text, it belongs to the frame that contains the centre of its box. Dragging sets the box's left edge and width, so it settles where the box sits across the frame; but the box grows downward as you type, and its frame is decided once more when you first stop typing, so a tall text started near a frame's bottom edge can still end up loose. Drag it back in, or start it higher. Pressing on an existing object, or on a frame's label or outline, does what it always did.
- `Esc` or switching away from the window while dragging cancels it, and `Esc` also leaves the Text tool. The tool is single-use: after the release you are typing in the new box with the Select tool active.
- A box you leave without typing anything disappears, with nothing saved and no undo step.

## Formatting text

Select one text and the panel on the right shows its formatting: font, size, heading, bold / italic / underline / strikethrough, alignment and colour. The panel's buttons never take the keyboard away from a text you are typing in: click one and keep typing. (Several selected objects show no formatting controls.)

- **While you are editing a text** (double-click it), bold, italic, underline and strikethrough act on the selected characters: a mark is removed if every selected character already has it, otherwise added to all of them. With only a caret, your choice applies to what you type next; the buttons show what the next character will look like. That choice is dropped when you move the caret (arrow keys, a click) or leave the text; a bold choice is also dropped when the caret's line becomes a heading (with the panel, with `# `, or by joining the line into a heading), since a heading is bold already, while italic, underline and strikethrough choices stay. Headings act on every line the selection touches, or the caret's line.
- **With the text selected but not being edited**, everything acts on the whole box: a mark goes on unless every character already has it; a heading goes on every line. An empty last line (where the caret goes after a final line break) is left out: it does not make the panel show the heading as mixed, and a heading set on the box does not reach it. Body on the box does reach it, so an empty last line that is still a heading (left over after deleting the text of a heading line) goes back to a normal line.
- **Font, alignment and colour** always apply to the whole box, also while you are editing it. Alignment moves the words inside the box; the box keeps its position and width. Colours are a fixed set of eight, including white for text on images.
- **A heading line is always bold.** Bold has no effect on a selection that lies entirely in heading lines (the Bold button shows pressed and greyed out there), and on a selection that mixes heading and normal lines it changes the normal lines only. Setting a line back to Body leaves it plain.
- **Undo:** formatting changed while editing is saved straight away, like typing, and the whole edit becomes one undo step when you leave the text. Formatting a selected box is an undo step of its own (quick repeats of the same kind, such as trying several fonts, count as one).
- Formatting never changes which frame an existing text belongs to, even when a heading makes it taller. A new text's frame is decided once more when you first stop typing in it, from where its box then is, so formatting done while first typing it can count.
- Holding `Ctrl/Cmd+B`, `I` or `U` down toggles once, however long you hold it.

### Typing shortcuts

While you type in a text, three markers turn into formatting, as a quicker way to press the same buttons. The markers disappear; they are never stored.

- `# `, `## ` or `### ` at the very start of a line (the space typed last) makes that line Heading 1, 2 or 3. It works on an empty line, at the start of a line that already has text, and on a line that is already a heading (it changes the level).
- `**bold**`: typing the second `*` of the closing `**` makes the text since the opening `**` bold. `*italic*`: typing the closing `*` makes it italic. What you type straight afterwards is plain again. In a heading, `**...**` only removes the markers (a heading is bold already).
- They do not fire when what is between the markers is empty, starts or ends with a space, contains a `*` or a line break; when the opening marker is in the middle of a word or touches another `*`; or for `####` or a `#` that is not at the start of the line. So `2 * 3 * 4`, `a ** b`, `* item`, `snake*case*`, `***x***` and `#tag` stay as typed. Text that already contains markers (pasted, dropped, typed with an input method such as a Japanese IME, or loaded) is never converted.
- **Backspace straight after a shortcut fired puts the characters back exactly as you typed them**, with the markers, and deletes nothing. It does so only as the very next thing you do: once you type, move the caret, use the panel or leave the text, Backspace deletes as usual.
- Like typing, a shortcut is saved straight away and is part of the one undo step recorded when you leave the text.

## Storage, tabs and older builds

Everything is stored in this browser's IndexedDB, for this origin (`http://localhost:5173` and `http://127.0.0.1:5173` are different origins and have separate boards).

- **Boards saved by the previous build (milestone 1) open as they are.** Opening writes nothing. A board without frames keeps being saved in the old format.
- **The first save of a board that contains a frame upgrades the database** in the same step that writes the board. From then on the previous build can no longer open it. This is deliberate: an old tab would otherwise silently drop the frames. There is no backup and no way back to the old build for that board.
- **Two tabs on one board:** a tab never overwrites a board that another tab has changed since it loaded or last saved. It becomes read-only with a Reload button, and whatever it had not yet saved is not saved.
- **Text formatting is stored inside each text**, in optional fields that are left out when they have their default, so a plain text is stored exactly as before and formatting needs no database change. A malformed formatting field is dropped when the board loads instead of making the board unreadable. The previous build shows formatted text plain and drops its formatting the next time it saves that board.
- If another tab holds the database while a frame is first being saved, the save fails after a few seconds with a Retry; close the other tab and retry.

### Known limits

- One board per browser profile and origin.
- Until a board has its first frame, an open tab of the previous build can still overwrite it or prune its unused images, as it always could. This build reports the conflict instead of overwriting back, and re-stores any image bytes that are missing the next time it saves.
- Image bytes are stored as uploaded (no downscaling) and are also kept in memory for the session, so that undo can always bring an image back; very large images are limited by browser storage quota, and a failed write is reported in the header.
- Something sitting inside a frame without belonging to it looks the same as something that does. The item count and "Select with contents" tell you which is which.
- A new text box made with a click is wider than what you type into it (ten times its font size), and belonging goes by the centre of that box. A text started in the right part of a frame can therefore end up not belonging to it, and one started just left of a frame can end up belonging to it. Dragging the box out with the Text tool sets its left edge and width, which settles this across the frame, but not downward: the box grows as you type, and its frame is decided again from its centre when you first stop typing, so a tall text started near a frame's bottom edge can still end up loose. Afterwards, drag the text, or narrow it with a side handle, to settle it. Whether a new text should instead keep the frame it was started in is an open design question.
- Fonts are named choices (Sans, Serif, Mono, Handwritten, Display) drawn with fonts already on the machine, so the exact typeface, and where lines wrap, can differ between machines.
- A heading belongs to a line, and editing carries each line's level over rather than guessing it from the text. Enter at the end of a heading starts a normal line; Enter in the middle of a heading leaves two headings; Enter at the start of a heading leaves an empty heading line above it. A heading line whose characters are all deleted stays a heading, so what you type there next is a heading too. Joining two lines keeps the level of the line the join starts in: Backspace at the start of a normal line under a heading makes it part of the heading, and Backspace at the start of a heading under a line with text makes it normal text (not bold), except that a heading joined onto an empty line stays a heading. Typing next to a bold character is bold (unless you turned bold off at the caret first). Pasted or dropped text keeps its bold, italic, underline and strikethrough, so text copied from a heading arrives bold at the normal size, but it never brings its own size, colour or font. A mark chosen with only a caret also applies to text pasted or dropped at the caret before it moves. These choices are provisional.
- A selection that ends just after a line break (at the very start of the next line) does not count that next line for a heading.
- A font or heading whose longest word does not fit the box widens it, as typing does; changing back does not narrow it again (undo does). Drag a side handle to narrow it. The same goes for a long word typed with its markers (`**word**`): the box widens while the markers are typed and stays that wide when they disappear, so it can end up a little wider than bolding the word from the panel would make it.
- Several selected objects show no formatting controls, even if they are all texts.
- Dropping dragged text into a centred or right-aligned text can shift its box: when the dropped words make the box wider, it widens from its left edge, which is how the canvas library inserts dropped text. Typing keeps the box's alignment edge in place.
- `Ctrl/Cmd+Z` while you are typing in a text is the browser's own undo of the typing. It brings back the characters but not a heading level the undone edit changed: after Backspace joins a normal line into a heading, undoing it this way leaves both lines headings. Leave the text and use the board's undo instead to restore the text and its formatting exactly. The browser's undo also cannot take back a typing shortcut or its Backspace revert: straight after one it does nothing, and later it undoes only what was typed since.
- Touch input is not supported.

## Testing

```sh
npm run lint && npm run typecheck && npm test && npm run build

npm run test:e2e:install   # once: downloads Playwright's bundled Chromium
npm run test:e2e           # starts its own dev server on :5199 and runs e2e/*.spec.ts
```

- **Unit tests** (`src/**/*.test.ts`, Vitest) cover the pure model (documents, ownership rules, scale limits, hit geometry), history, persistence (revision tokens, the database upgrade, asset presence, with `fake-indexeddb`), keyboard handling, and the `Editor` state machines (hydration, gestures, frames) on a small fake of Fabric, since jsdom has no canvas.
- **e2e tests** (`e2e/`, Playwright) run the real app with real Fabric and real IndexedDB in a real browser: `hydration.spec.ts` (nothing is editable or saved before the board has loaded; a board that cannot be restored is read-only and untouched), `gestures.spec.ts` (what a save sees during a drag, cancelling, mouse buttons, the single scale factor), `frames.spec.ts` (drawing, hit testing, ownership, carrying, resizing), `storage.spec.ts` (opening a milestone 1 board, the upgrade, two tabs), `text.spec.ts` (formatted text drawn, saved, scaled, undone and typed into), `formatting.spec.ts` (the panel's text controls and `Ctrl/Cmd+B`, `I`, `U` on a range, at a caret and on a whole box), `texttool.spec.ts` (dragging out a text box with the Text tool, and the click that still gives the default box) and `typing.spec.ts` (the typing shortcuts typed for real, what stays literal, Backspace to undo one, and that typing goes on normally afterwards). Fixtures are generated in code, including boards written by a frozen copy of the previous build's storage code; each test gets an isolated browser context, so it never touches your own profile or data.
- Use a browser already on your machine instead of the bundled one with `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`; change the port with `E2E_PORT`.
- Failure traces and screenshots go to `test-results/` (git-ignored).

## Keyboard shortcuts

Shortcuts never fire while you are typing in a field or editing text, except `Ctrl/Cmd+B`, `I`, `U` in a text you are editing, and `Backspace` straight after a typing shortcut (see above). While a drag, resize, frame or text box is in progress only `Esc` and the zoom keys respond.

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
| `Ctrl/Cmd+B` / `I` / `U`    | Bold / italic / underline: the selected characters (or what you type next) while editing a text; the whole box when one text is selected |
| `+` / `-` / `0` / `Shift+1` | Zoom in / out / 100% / fit     |
| `Esc`                       | Cancel what is in progress; otherwise leave the tool, or deselect |

Only the primary mouse button edits. The middle button pans.

## Architecture

- **Fabric.js 7** (MIT) renders and edits the canvas. React renders only the chrome (header, toolbar, inspector) and never touches Fabric objects.
- `src/editor/Editor.ts` is the single bridge: it owns the Fabric canvas, history, assets and autosave, and exposes an immutable `EditorState` snapshot through `subscribe`/`getState` (`useSyncExternalStore`). Fabric's event callbacks only record facts; a finished gesture is settled in a microtask after Fabric's own mouse-up handling, and a save during a gesture stores the board from before it.
- `src/editor/FrameCanvas.ts` extends Fabric's canvas for frames (what counts as a hit, Shift-click and marquee rules) and `src/editor/frameLayer.ts` holds the one geometry used both to draw a frame's outline and label and to hit them.
- `src/model/` is pure and unit-tested: document types and validation, the frame ownership rules and scale limits (`frames.ts`), the canonical form of text formatting and what the formatting controls do to it (`richText.ts`), snapshot `History` (with coalescing), layer reordering, viewport math.
- `src/persistence/` has the IndexedDB store (document and image bytes written in one transaction, guarded by a revision token) and the `Autosaver` status machine.
- `src/input/shortcuts.ts` maps key events to actions and decides when to stay out of the way.

The saved document references images by id; the bytes live in a separate IndexedDB store. Frames have stable ids, names and unrotated rectangles, and each object records the frame that owns it. A text's formatting is stored as character ranges (UTF-16 offsets into its text) and per-line heading levels, and drawn as Fabric per-character styles (`src/editor/objects.ts`). Undo/redo restores objects from serialized snapshots, using already-decoded images, so it is synchronous.
