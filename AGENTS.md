# Yuriful repository guidance

## The project

Yuriful is a desktop-first freeform reference canvas: you lay out images and text on an infinite, pannable, zoomable board and group finished spreads into named frames. It is local-only. There is no account, no server and no cloud storage; a board lives in the browser's IndexedDB.

- Explain changes through the experience of using the canvas. Use plain, direct language and concrete examples ("drag a frame over a loose image and it is left behind").
- Keep shipped behaviour, approved plans, open design questions and future ideas distinct. Avoid inflated claims and long inventories of changed files.
- [README.md](README.md) describes the app to the person using it. This file states how to work on it, and repeats the product rules only as constraints on changes.

## Questions before changes

- Questions such as "how could we do this?" or "is this possible?" are requests for discussion, not permission to edit. Explain the options, tradeoffs and proposed approach first, and wait for explicit permission to implement.
- Keep any investigation needed to answer the question read-only.

## Settled decisions and approved plans

- Milestone work follows a plan the owner approved. The plan's stated rules are the authority for user-facing behaviour.
- Do not redefine an agreed rule because a review found an awkward edge case. Keep the rule, pin it with a test, record the edge case under "Known limits" in the README as an open design question, and report it.
- Within the authorized implementation scope, fixing a crash, data loss, or behaviour that contradicts the plan needs no extra approval; report it. This does not turn a question, a request to review or a read-only investigation into permission to edit.
- A change to what a rule *is* needs the owner first. When unsure whether a change redefines a rule or only makes it work as stated, treat it as a redefinition: keep the plan's behaviour and report the alternative.
- The frame, transform and storage rules below are settled. Do not reopen them, and ask only about consequential unknowns.

## Skills

- This repository has no project skills yet (there is no `.agents/skills/` or `.claude/skills/`). If skills are added, check them before planning the relevant work and apply the ones that fit. Do not assume a skill from another project exists here.

## Check lifecycle behaviour while implementing

- For any change to gestures, selection, text editing, saving or loading, identify the failure cases while designing and testing it, not afterwards:
  - a gesture interrupted by Esc, by the window losing focus, by a reload, or by the board going read-only;
  - a second mouse button pressed or released mid-drag, and a release that never arrives;
  - the autosave debounce firing, or a save already in flight, during a gesture;
  - an image import that finishes decoding during a gesture;
  - another tab having written the board, or pruned its image bytes;
  - every way of leaving a text edit (Esc, clicking elsewhere, clicking another object, Shift-click, a toolbar or panel button), remembering that typing is saved as it happens while history is recorded when the edit ends;
  - undo and redo straight afterwards, and input before the stored board has finished loading.
- Exercise the cases that apply with focused tests before asking for review. Independent review is a second check, not the first time these cases are considered. Documentation-only changes do not need them.

## Delegation and independent review

- The main agent is the coordinator: it owns requirements, decisions, task boundaries, integration, final verification and the result reported to the owner. Delegate bounded, independent work when it improves progress or review quality; keep small or tightly dependent steps local.
- Use the delegation tools, roles and models actually available in the current session, and preserve the owner's model choices. Subagents report to the coordinator, do not delegate further, and do not mutate Git state. Use at most three at once.
- Before spawning, give each subagent its files, acceptance criteria and checks. Editing subagents share this checkout: they preserve others' edits and report overlap before writing. Reviewers do not edit the repository.
- After each committed slice, have an independent subagent review that commit against the plan and the neighbouring code before starting the next slice. Do not simulate a review or substitute a self-review. If no subagent capability is available, say so rather than claiming a review.
- Give the reviewer the actual commit, not a summary of it, and ask for bugs, regressions and test gaps with a concrete failure scenario for each. Ask for correctness, the plan's acceptance behaviour and real-browser evidence first. If you ask a reviewer to break the code on purpose to see whether a test notices, name the few breaks that matter rather than requesting a sweep.
- A reviewer that runs checks does so in its own copy, so that it depends on neither the working tree nor the owner's dev server: `git archive <commit> | tar -x -C <scratch dir>`, a junction or symlink from that copy's `node_modules` to the repository's, and a different `E2E_PORT`. TypeScript's build info (`tsBuildInfoFile`, set in this repository's tsconfig files) and Vite's cache (`cacheDir`, by default) live under `node_modules` and would be shared through that link. Neither has a command-line switch: edit the copy's `tsconfig.app.json`, `tsconfig.node.json` and `vite.config.ts` to point both inside the copy.
- Fix valid findings in a follow-up commit, rerun the affected checks, and have the fix re-reviewed. A fix commit made after a re-review needs its own re-review. A review cut short (for example by a usage limit) has not cleared anything: resume or replace it.
- Report reviewer identities, a finding-by-finding disposition (fixed in which commit, or dismissed and why), and the checks actually run. Delegation does not expand authorization.

## Commits and publishing

- Commit in logical slices. Every commit must be a safe checkpoint: the app works and whatever it stores is valid. Run the checks for the changed surface, inspect the full diff, then commit.
- Write commit messages around what changes for the person using the canvas, then why. Report the checks actually run; never invent impact, counts or verification.
- Do not push, merge, reset, switch branches, rewrite history or clean up destructively unless asked. Preserve uncommitted changes you did not make.
- Choose the base of new work deliberately. Until `main` contains the current app together with `AGENTS.md` and `CLAUDE.md`, do not base on it: new work must descend from `origin/feat/milestone-2-frames`, or from a newer owner-approved branch that descends from it. Once `main` does contain them, use the up-to-date base the owner approves instead; this is not a standing rule to branch from the feature branch.
- Before starting, confirm that both instruction files exist on the chosen base and on the new branch. If they are missing, the base is wrong: pick a base that has them rather than copying the files onto an older app they do not describe.
- For a pull request: a short specific title; open with what was wrong or missing and what changes for the user; then the checks run and any gaps. Writing a description does not authorize pushing, filing or merging.

## Project shape

- One npm package (ES modules, strict TypeScript): React 19 for the chrome, Fabric.js 7 for the canvas, Vite for dev and build, Vitest (jsdom) for unit tests, Playwright for real-browser tests. There is no backend and no `.env`.
- Fabric is pinned at 7.4.0 by the lockfile, and `FrameCanvas` overrides Fabric internals. Do not change dependencies unless a task genuinely requires it; say why if you do.
- `src/model/` is pure, with no Fabric or DOM dependency: document types and validation (`types.ts`, `doc.ts`), frame ownership rules, scale limits and hit geometry (`frames.ts`), the canonical form of text formatting (`richText.ts`), `history.ts`, `layers.ts`, `viewport.ts`, `id.ts`.
- Only `src/editor/` imports Fabric, and `src/editor/Editor.ts` is the only part the UI talks to: it owns the canvas, history, assets and autosave and exposes an immutable state snapshot. `FrameCanvas.ts` holds the frame hit-testing, Shift-click and marquee rules; `frameLayer.ts` the one geometry used both to draw and to hit a frame's outline and label; `objects.ts` converts between records and Fabric objects, including a text's formatting and Fabric's per-character styles; `fonts.ts` maps font ids to CSS font chains; `assets.ts` decodes images and keeps their original bytes for the session.
- `src/persistence/` is the IndexedDB store (`boardStore.ts`), the save status machine (`autosave.ts`) and fail-closed loading (`hydrate.ts`). `src/input/shortcuts.ts` maps keys to actions. `src/ui/` is React chrome only.
- Test support: `src/editor/testing/` (a fake Fabric; a driver that replays by hand the event sequence of Fabric's mouse handlers, which is an imitation and not evidence of Fabric's behaviour; a fake store and assets), `src/persistence/testing/legacyStoreV1.ts` (a frozen copy of milestone 1's storage code; never modernize it), and `e2e/helpers.ts` (seeding and reading IndexedDB).
- Working files use LF. If Git on the machine has `core.autocrlf=true`, `git stash` and checkouts rewrite files with CRLF; tools that match text literally must tolerate that.

## Dev server and ports

- `npm run dev` serves the working tree, by default on port 5173. The owner often has one running: every saved file hot-reloads into their open tab, on their real board.
- Do not start, stop, restart or kill a dev server or preview you do not own. Identify the process that owns a port before touching it; never use a broad kill.
- `npm run test:e2e` starts its own dev server on `127.0.0.1:5199` (override with `E2E_PORT`) and reuses one already listening there. It needs a dev server rather than a build, because the tests load `legacyStoreV1.ts` from it. Tests run in isolated browser contexts and must never use the owner's board. Concurrent runs need different ports.
- IndexedDB is per origin: `http://localhost:5173` and `http://127.0.0.1:5173` hold different boards.

## Editor and gesture invariants

- A pointer gesture is settled (selection re-formed, scale folded, ownership decided, history recorded) in one microtask queued from Fabric's callback, after Fabric's own mouse-up handling has returned. Removing an object is deferred the same way. Three things do run inside callbacks: a moved frame's followers are placed during `object:moving`; leaving a text edit commits (and decides a new text's owner) in `text:editing:exited` and in the `object:modified` that Fabric fires straight after it; and `text:changed` rewrites the edited text's character styles to their canonical form before the typing save is scheduled (Fabric 7.4 fires it after it has changed the text, shifted the styles and placed the caret, and does nothing to the text afterwards).
- A save never sees an unfinished gesture: while one exists, the saved scene is the one from before it. Title and viewport are always live.
- Esc, a window blur, or the board going read-only cancels an unfinished drag, resize, scale, rotation or frame draft and restores the board from before it, with no history entry and no save. A press that moves nothing leaves no trace.
- While a gesture is unsettled only Esc and the zoom keys respond; every editing command and shortcut is ignored (an image import waits and is added afterwards as its own undo step). Wheel panning and zooming keep working, and the title stays editable.
- Only the primary mouse button edits. Presses of other buttons never reach Fabric, and a non-primary release during a primary drag is kept from it; the middle button pans.
- Undo and redo restore whole scenes, including frames and ownership. A commit that changes nothing records nothing and saves nothing.
- Nothing is editable or saved before the stored board has loaded. A board that cannot be fully restored, or that another tab has changed, is read-only: no selection, no edits, no writes, no pruning; pan and zoom still work.
- A blank text is never part of the scene: it is not saved, not in history, and is discarded when its edit ends, whatever formatting it has.
- A text's formatting on the canvas is always its canonical record: what a save stores is what the canvas shows. Fabric is the live source of truth while a text is edited; `toRecord` reads formatting from the Fabric object alone, and anything that changes a text's base font size (scale folding, `setFontSize`) redraws its headings at their ratio.

## Frames (settled)

- A frame is a named, unrotated rectangle behind all content. It clips nothing. It is grabbed by its label or within 6 screen pixels either side of its outline; its interior is click-through. A label or outline wins over content lying on top of it.
- Ownership is stored on each object (`frameId`) and never recomputed from position. Loading restores it as stored (an owner that names no existing frame is dropped).
- **An object changes owner only through its own movement.** When content is moved, resized, rotated or created, it keeps its owner if that frame was transformed in the same gesture, or still contains its centre. Otherwise it joins the front-most frame that contains its centre and was not transformed in that gesture, or becomes loose. An owner is sticky: a frame in front that also contains the object does not take it.
- "Centre" is the centre of the object's box for every kind of object, including a text's wrap box. The awkward case of a newly placed text (its box is much wider than what is typed) is an open design question recorded in the README's known limits; do not resolve it by changing which point is tested.
- **Moving, resizing or drawing a frame never adopts anything.** A loose object that a frame was moved over or drawn round stays loose until the object itself is moved.
- Moving a frame together with loose objects leaves them loose. Things it already owns stay owned, with no containment test, when they are transformed together with it.
- Moving a frame carries its unselected members exactly once. A member that is itself selected moves through the selection only, never twice.
- A resized frame releases members it no longer contains; they become loose and are not handed to another frame. Deleting a frame keeps its contents, loose.
- A click without movement, selecting, reordering, renaming, typing in existing text, changing font size, undo, redo and loading never change ownership.
- Pressing the label of a frame that is part of the current multi-selection acts on the whole selection.

## Transforms (settled)

- **A frame resized alone changes its own shape freely and leaves its contents where they are.** It never stretches or moves them. Each side stops at 24 units (or at its own length if it was already shorter).
- Transforming contents with their frame is explicit: "Select with contents" selects a frame plus what it owns, and that multi-selection is then moved or scaled as one.
- A multi-selection can be moved, scaled proportionally from a corner, and (if it contains no frame) rotated. There is no free-aspect stretch or skew of a group, and Shift does not unlock one. Every reachable canvas state must be representable in the stored records.
- One scale factor per proportional gesture: limits (text 6 to 400 px, a frame's smaller side at least 24 units) are computed from pre-gesture values and applied once to the whole selection, never per member, and an out-of-range member is never snapped into range. No transform is applied twice.

## Storage and migration

- Everything is stored locally in IndexedDB database `yuriful`: one board row, and image bytes in a separate store. Document and bytes are written in one transaction.
- Every save re-checks a revision token inside its own transaction. A tab of this build whose view is stale never overwrites: it becomes read-only instead. A cleanup of unused image bytes from a stale view does nothing. A document is never written with an image reference that has no stored bytes.
- Text formatting (`font`, `align`, `color`, `spans`, `headings`) lives in optional fields of the text record, absent when default, in both stored versions; no document or database version change. `parseDoc` reads them leniently (malformed values are dropped or trimmed into canonical form, like a dangling owner) and stays strict about everything else; `serializeDoc` never writes a default or undefined formatting key, so a plain text is stored exactly as before. Scene equality compares spans and headings structurally.
- Loading never rewrites the board row. After a complete restore it only removes image bytes the stored document does not reference; a load that ends read-only writes and removes nothing.
- A board saved by an earlier build must open by ordinary forward migration. A board without frames keeps the milestone 1 document shape; `parseDoc` accepts stored versions 1 and 2 and rejects anything else, and a database newer than version 2 opens read-only.
- The first save of a board with a frame upgrades the database to version 2 in the same transaction that writes the board. This is deliberately one-way: the older build can no longer open it.
- The existing board is early test data and the owner accepts one-way forward migration. Do not add backup, rollback, downgrade or old-build compatibility machinery unless asked.

## Out of scope for now

- Publishing, guest viewing, accounts, auth and any backend; mobile and touch input; frames inside frames; clipping content to a frame; rotating a frame; free-aspect or skew transforms of a group; adopting objects by drawing or moving a frame.

## Verification

- Run checks proportional to the changed surface, and report skipped or unavailable checks explicitly. Report the counts you actually observed; do not quote an old count.
- Documentation-only changes: confirm every path and command you mention exists. App checks are not required.
- Any code change: `npm run lint`, `npm run typecheck`, `npm test`.
- Changes to gestures, frames, hit testing, transforms, text editing, storage or UI: also `npm run test:e2e`. The fake Fabric models state machines, not geometry or Fabric's real event order; those are accepted only on real-browser evidence.
- Full gate: `npm run lint && npm run typecheck && npm test && npm run build`, then `npm run test:e2e`.
- Focused runs: `npx vitest run <test file>` and `npx playwright test <spec file> -g "<title>"`. Check for flakiness with `npx playwright test --repeat-each=2`. Run `npm run test:e2e:install` once to download Chromium, or set `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome` to use an installed browser.
- A new test must be able to fail: confirm it fails without the change it covers.

## Documentation

- The README describes behaviour to the person using the app; this file states the same rules as constraints on changes. When a rule, shortcut, storage behaviour or known limit changes, update both in the same commit. Update this file alone when only the way of working changes.

## Code review rules

- Flag: settling a gesture, or removing an object, inside a Fabric callback; a frame gaining a member by being moved, resized or drawn; an owner lost to a frame that merely overlaps it; a member moved twice; contents stretched or moved by a lone frame resize; a per-member limit inside a proportional scale or in serialization; a canvas state the records cannot store; a save that can see a half-finished gesture; a click or a read-only board that writes; a load that rewrites the board row; a save without the revision check; a test that reaches the owner's board or a live dev server; a test that cannot fail.
- Safe paths: deferred settlement; ownership decided by the pure rules in `src/model/frames.ts`; one scale factor per gesture; records as the source of truth; token-checked transactional writes; isolated browser contexts with seeded storage.
- Traps that have already cost time here:
  - The fake's multi-selection holds its members' absolute results, so it cannot detect a double move or wrong group geometry. Cover those in `e2e/`.
  - Removing an object inside Fabric's `text:editing:exited` makes Fabric throw afterwards. Defer the removal.
  - Objects cannot be flipped, so a handle dragged past its anchor stops at the last accepted scale. A test cannot reach a minimum size by dragging through the anchor; drag to just short of it.
  - Button names overlap ("Select" and "Select with contents", "Frame" and "Delete frame"): use exact role locators in Playwright.
  - The editor unit tests fake only `setTimeout`; `fake-indexeddb` runs on `setImmediate`, so real store writes need real macrotasks to finish.
