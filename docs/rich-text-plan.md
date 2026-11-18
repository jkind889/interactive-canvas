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

## Open questions for the owner

- Whether to bundle font files so that a board looks the same on every machine (matters once
  frames are published).
- Whether a new text should belong to the frame that was clicked in (already listed in the
  README's known limits; unchanged here).

## Review log

Filled in as slices are reviewed: reviewer, findings, disposition.
