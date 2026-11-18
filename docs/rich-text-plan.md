# Text formatting milestone: plan, decisions, progress

Status: in progress on `feat/milestone-2-frames`. The owner asked for this milestone ("flesh out
the text before publishing frames") and for work to start without a second approval round, so
the defaults below are the coordinator's and are **provisional until the owner has reviewed
them**. Anything marked "open question" is deliberately left for the owner.

Nothing here changes a settled frame, transform or storage rule in `AGENTS.md`.

## What the person using the canvas gets

1. **Formatting on text.** Bold, italic, underline and strikethrough on a selected range of
   characters, or on the whole box when the box is selected without being edited. Heading 1, 2
   and 3 on whole lines. Font, alignment and colour on the whole box.
2. **Markdown-like typing shortcuts.** While typing: `# `, `## `, `### ` at the start of a line
   turn the line into a heading; `**word**` becomes bold; `*word*` becomes italic. The markers
   disappear when the shortcut fires.
3. **Fonts.** A short list of font choices that work without downloading anything.
4. **Sizing a text box before typing.** With the Text tool, drag out a box; its width becomes
   the wrapping width. A plain click still gives the default box.

Not in this milestone: lists, links, quotes, code blocks, tables, per-range fonts, sizes or
colours, a fixed box height, importing or exporting Markdown source, pasting rich text from
other applications, duplicating or copying whole objects (the app has no such command today),
publishing.

## Defaults, and why

- **Live shortcuts, not stored Markdown.** The stored text never contains the markers; a
  shortcut is only a faster way to press the same button. Text typed or pasted with markers
  already in it (a paste, or a marker completed by anything other than typing its last
  character) is left exactly as it is. This keeps the canvas, the saved board and undo free of
  a second "source" representation.
- **Literal typing stays possible.** A shortcut fires only when the closing marker is typed,
  the marked text is not empty and has no space just inside either marker, and the opening
  marker starts a word; so `2 * 3 * 4`, `a ** b` and a lone `#` stay as typed. `# ` only fires
  at the very start of a line. Pressing **Backspace straight after a shortcut fired** puts the
  literal characters back. Nothing fires during IME composition.
- **Ranges and boxes.** Bold, italic, underline, strikethrough: the selected characters while
  editing; with only a caret, the choice applies to what is typed next; with the box selected
  and not being edited, the whole box. A whole-box toggle turns the mark on unless everything
  already has it. Headings are a property of a line (a paragraph between line breaks): the
  lines the selection touches while editing, every line when the box is selected.
- **Headings.** Heading 1, 2, 3 are 2, 1.5 and 1.25 times the box's font size, and always
  bold. They scale with the box. Pressing Enter at the end of a heading starts a normal line.
- **Font, alignment, colour are per box**, not per range. That is the bounded version; per
  range can come later without changing the stored shape of what exists.
- **Fonts are named choices backed by fonts already on the machine** (Sans, Serif, Mono,
  Handwritten, Display), each a CSS fallback chain. No font files are bundled and nothing is
  fetched, which keeps the app local-only and avoids a font-loading step during board load.
  The board stores the choice's id, not a font name, so a later build can back the same ids
  with bundled font files without migrating boards. Consequence: the exact typeface, and so
  where lines wrap, can differ between machines (already true of today's system font).
- **A dragged text box sets the wrapping width only.** A text box is still as tall as its
  text; the dragged height is a guide and is not stored. A drag shorter than the click
  threshold is a click and gives the default box (ten times the font size wide), as today.
  Esc, a window blur or the board going read-only cancels the drag like any other gesture.
- **Keyboard.** Ctrl/Cmd+B, I, U while editing a text act on the range or caret; with a text
  box selected they act on the whole box. They are claimed only in those two situations.
  Every existing canvas shortcut still stays out of the way while a text is being edited, and
  native editing keys (typing, selection, clipboard, Esc and Tab to leave the edit) are not
  touched.
- **History.** As with typing today: formatting changed during an edit is saved as it happens
  and becomes one undo step when the edit ends. Formatting applied to a selected, non-edited
  box is its own undo step at once.

## Stored shape

`TextRecord` gains optional fields. A field is absent when it has its default, so a plain
text is stored byte for byte as before, and equality ("a commit that changes nothing records
nothing") stays exact.

| Field      | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `font`     | Font choice id. Absent: Sans.                                            |
| `align`    | `center` or `right`. Absent: left.                                       |
| `color`    | `#rrggbb`, lower case. Absent: the default ink.                          |
| `spans`    | Marks on character ranges: `{ start, end, bold?, italic?, underline?, strike? }`, offsets in UTF-16 units of `text`, sorted, non-overlapping, merged, each with at least one mark. Absent: none. |
| `headings` | Heading level (0 to 3) per line of `text`, trailing zeros trimmed. Absent: none. |

- No database or document version change. Both stored versions (1 and 2) carry the optional
  fields. An older build that opens such a board ignores the fields and would drop them on its
  next save; old-build compatibility is not a requirement (owner's instruction).
- Loading is lenient about formatting only: a malformed formatting field is dropped or trimmed
  to something valid, like a dangling frame owner, instead of making the board unreadable.
  Everything else about a text record stays strict.
- The scale limits keep applying to the box's font size (6 to 400 px), computed once per
  gesture from pre-gesture values. A heading is drawn larger than that size.

## How it is built

- `src/model/richText.ts` (pure): canonical form of spans and headings, mark toggling and
  range queries, the heading scale, the font choice ids, and the typing-shortcut matcher.
- `src/editor/objects.ts`: one function writes a text record's formatting onto a Fabric
  textbox (per-character styles; a heading line carries a font-size style on every character,
  and on a placeholder entry when the line is empty), and `toRecord` reads it back. Fabric
  stays the live source of truth while a text is edited; after every text change the editor
  re-derives the canonical formatting and rewrites the styles if they differ.
- `src/editor/Editor.ts`: formatting commands, the in-edit key handling, the typing
  shortcuts, and the Text tool's drag as a draft gesture like the Frame tool's.
- `src/ui/Inspector.tsx`: the controls. Buttons do not take focus, so an edit keeps its
  selection.

## Slices

Each slice is implemented by an Opus 5.5 worker, checked and committed by the coordinator,
then reviewed by a different Opus 5.5 reviewer before the next one starts.

| # | Slice | State |
| - | ----- | ----- |
| 1 | Formatted text in the document: record fields, validation, equality, writing to and reading from the canvas, scaling, load/save/undo round trips. No controls yet. | committed, in review |
| 2 | Formatting commands, panel controls, Ctrl/Cmd+B/I/U, range/caret/whole-box behaviour. | not started |
| 3 | Typing shortcuts (`#`, `**`, `*`), Backspace to revert, Enter after a heading. | not started |
| 4 | Text tool: drag out a box. | not started |

After the last slice is reviewed, the branch goes to a further independent hands-on QA and
final review (Astra, coordinated separately). The milestone is not finished before that.

## Integration contract with `feat/layers-image-tools`

A separate branch, based on `698b628`, adds a layer list, z-order, locks and image
crop/fit/fill/replace. Neither branch merges the other while in progress. This section lists
what this branch touches in shared files and what it relies on, so the eventual integration
can be done deliberately. It is updated as slices land.

Shared files this branch has changed so far (slice 1):

- `src/model/types.ts`: `TextRecord` gains optional `font`, `align`, `color`, `spans`,
  `headings`, plus the `FontId` and `TextSpan` types. `ImageRecord`, `RecordBase`,
  `FrameRecord`, `BoardDoc` and the stored-document types are untouched.
- `src/model/doc.ts`: the text branch of `parseObject` appends the canonical formatting
  fields; `serializeDoc` now copies every object through `withoutUndefined` (any key whose
  value is `undefined` is left out, for images too); `recordsEqual` is replaced by a
  by-value comparison (`valuesEqual`) that descends into arrays and plain objects.
- `src/editor/objects.ts`: the text branch of `createObject` and of `toRecord`,
  `normalizeTextScale`, and new exports for writing and reading a text's formatting. The
  image and frame paths, `Meta` and `SELECTION_STYLE` are untouched.
- `src/editor/Editor.ts`: the `text:changed` handler and `setFontSize` only.
- `src/editor/testing/fakeFabric.ts`: fields and two methods on the fake `Textbox`.
- `e2e/helpers.ts`: optional formatting fields on `StoredObject`.
- `README.md`, `AGENTS.md`: text formatting in the storage, invariant, project-shape and
  known-limit sections.

Contracts the other branch can rely on, and that this branch needs kept:

- An optional record field is absent when it has its default; `serializeDoc` never writes an
  `undefined` key. A plain text keeps exactly its previous keys.
- Scene equality is by value at any depth, so a nested value in a record (a crop rectangle,
  say) does not look like a change on every commit. Canonical form is still each feature's
  own job: two records that mean the same must be built the same.
- No document or database version change comes from this branch. If the other branch changes
  a version, text formatting fields must be carried by every version that can hold a text.
- `toRecord` reads a text's formatting from the Fabric object alone, and anything that
  changes a text's base font size must go through `setTextFontSize` so headings keep their
  ratio. A new code path that scales or resizes text has to do the same.
- This branch does not touch z-order, layer reordering or image records.

Expected overlap from the remaining slices: `SelectionInfo` and the `Inspector` gain a text
section; `Editor` gains formatting commands, a capture-phase key handler for keys pressed
while a text is edited, and a text variant of the draft gesture used by the Frame tool;
`src/input/shortcuts.ts` gains Ctrl/Cmd+B/I/U. Formatting commands act on the active object
behind the same `editable && !busy` guards as the existing commands, so a lock that keeps an
object from being selected also keeps it from being formatted; a lock that still allows
selection will need to gate these commands explicitly.

What the other branch has told this one (as of 2026-11-18; their branch does not contain
this branch's changes):

- Their optional `locked` and crop fields are accepted in stored versions 1 and 2, with no
  document or database version change. Together with this branch that makes two sets of
  optional fields in the same versions; neither needs a bump.
- A locked object is skipped by canvas clicks, the marquee and select-all, but can still be
  selected on its own from the layer list, without handles. Every mutation of it is blocked
  until it is unlocked; the one exception is that moving the frame that owns it still
  carries it.

Acceptance case for the integration and for the final QA pass: **a locked text selected
from the layer list must not be formattable.** The `editable && !busy` guards are not
enough, because that object is the active object. At integration every text formatting
command (marks, heading, font, alignment, colour, font size), Ctrl/Cmd+B/I/U, entering a
text edit by double-click, and the typing shortcuts must reject a locked text: nothing on
the canvas changes, no history step, no save. The panel should show its formatting controls
disabled or not at all. This cannot be implemented or tested on this branch alone, since the
lock does not exist here; it is an integration task, to be done only when the owner
authorizes merging the two.

## Open questions for the owner

- Whether to bundle font files so that a board looks the same on every machine (matters once
  frames are published).
- Whether a new text should belong to the frame that was clicked in (already listed in the
  README's known limits; unchanged here).

## Review log

Filled in as slices are reviewed: reviewer, findings, disposition.
