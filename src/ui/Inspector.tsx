import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Editor, SelectionInfo } from '../editor/Editor.ts'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../model/doc.ts'
import { IconButton } from './IconButton.tsx'
import { BackwardIcon, ForwardIcon, LockIcon, SelectContentsIcon, ToBackIcon, ToFrontIcon, TrashIcon, UnlockIcon } from './icons.tsx'

const kindHeading = (s: SelectionInfo) =>
  s.kind === 'multiple' ? `${s.count} objects` : s.kind === 'text' ? 'Text' : s.kind === 'frame' ? 'Frame' : 'Image'
const heading = (s: SelectionInfo) => (s.locked ? `${kindHeading(s)} · Locked` : kindHeading(s))

const itemCount = (n: number) => (n === 0 ? 'Nothing yet' : n === 1 ? '1 item' : `${n} items`)

/** Name, contents and "Select with contents" for a single selected frame. */
function FramePanel({ editor, selection }: { editor: Editor; selection: SelectionInfo }) {
  const nameId = useId()
  const nameInput = useRef<HTMLInputElement>(null)
  const name = selection.frameName ?? ''
  const members = selection.memberCount ?? 0

  // Double-clicking a frame's label on the canvas puts the cursor in this field.
  useEffect(() => {
    editor.setFrameRenamer(() => {
      nameInput.current?.focus()
      nameInput.current?.select()
    })
    return () => editor.setFrameRenamer(null)
  }, [editor])

  // A name being typed is committed when the pointer goes down anywhere else. Waiting for the
  // browser's own blur is too late: by then the canvas has already handled the press (the
  // selection has changed, or a drag has begun) and the editor would refuse the rename. The
  // capture phase on the document runs before any of that. It also covers the panel's own
  // buttons, which deliberately do not take focus.
  useEffect(() => {
    const commitPending = (e: PointerEvent) => {
      const input = nameInput.current
      // Also for Undo: the typed name is committed first and is then the step that Undo takes
      // back, so Redo returns it. (Leaving it pending instead would lose it whenever the undo
      // changes the frame's name and this field is rebuilt.)
      if (input && document.activeElement === input && e.target !== input) input.blur()
    }
    document.addEventListener('pointerdown', commitPending, true)
    return () => document.removeEventListener('pointerdown', commitPending, true)
  }, [])

  const commit = (input: HTMLInputElement) => {
    // The editor normalizes the name (and refuses while it is busy or read-only): show what it really is.
    input.value = editor.renameFrame(input.value) ?? name
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      e.currentTarget.value = name
      e.currentTarget.blur()
    }
  }

  return (
    <>
      <div className="inspector-row">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          key={name}
          ref={nameInput}
          className="text-input"
          defaultValue={name}
          disabled={selection.locked}
          maxLength={80}
          spellCheck={false}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={onKey}
        />
      </div>
      <div className="inspector-row">
        <span>Contents</span>
        <span className="inspector-value" data-testid="frame-item-count">
          {itemCount(members)}
        </span>
      </div>
      <button
        type="button"
        className="secondary-btn inspector-btn"
        disabled={members === 0 || selection.locked}
        title="Select this frame together with everything it owns, to move or scale them as one"
        onClick={() => editor.selectFrameContents()}
      >
        <SelectContentsIcon />
        <span>Select with contents</span>
      </button>
      <p className="inspector-note">
        Something belongs to a frame once you move it into the frame. Moving or resizing the frame itself never picks things up.
      </p>
    </>
  )
}

export function Inspector({ editor, selection }: { editor: Editor; selection: SelectionInfo }) {
  const sizeId = useId()
  const isFrame = selection.kind === 'frame'
  return (
    <aside className="floating inspector" aria-label="Selection">
      <div className="inspector-title">{heading(selection)}</div>

      {isFrame && <FramePanel editor={editor} selection={selection} />}

      {selection.kind === 'text' && selection.fontSize !== null && (
        <div className="inspector-row">
          <label htmlFor={sizeId}>Font size</label>
          <input
            id={sizeId}
            className="number-input"
            type="number"
            inputMode="numeric"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            disabled={selection.locked}
            value={Math.round(selection.fontSize)}
            onChange={(e) => {
              const n = e.currentTarget.valueAsNumber
              if (Number.isFinite(n) && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) editor.setFontSize(n)
            }}
          />
        </div>
      )}

      <div className="inspector-row">
        <span id={`${sizeId}-layer`}>Layer</span>
        <div className="btn-group" role="group" aria-labelledby={`${sizeId}-layer`}>
          <IconButton label="Bring to front" shortcut="Ctrl+]" keys="Control+] Meta+]" disabled={!selection.layer.front} onClick={() => editor.arrange('front')}>
            <ToFrontIcon />
          </IconButton>
          <IconButton label="Bring forward" shortcut="]" keys="]" disabled={!selection.layer.forward} onClick={() => editor.arrange('forward')}>
            <ForwardIcon />
          </IconButton>
          <IconButton label="Send backward" shortcut="[" keys="[" disabled={!selection.layer.backward} onClick={() => editor.arrange('backward')}>
            <BackwardIcon />
          </IconButton>
          <IconButton label="Send to back" shortcut="Ctrl+[" keys="Control+[ Meta+[" disabled={!selection.layer.back} onClick={() => editor.arrange('back')}>
            <ToBackIcon />
          </IconButton>
        </div>
      </div>

      <button
        type="button"
        className="secondary-btn inspector-btn"
        aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
        title={selection.locked ? 'Unlock, so that it can be moved and changed again (Ctrl+Shift+L)' : 'Lock against moving and changing by accident (Ctrl+Shift+L)'}
        onClick={() => editor.setSelectionLocked(!selection.locked)}
      >
        {selection.locked ? <UnlockIcon /> : <LockIcon />}
        <span>{selection.locked ? 'Unlock' : 'Lock'}</span>
      </button>
      {selection.locked && (
        <p className="inspector-note" data-testid="locked-note">
          Locked: it cannot be moved or changed. Unlock it here or with its padlock in the layer list.
        </p>
      )}

      <button
        type="button"
        className="danger-btn"
        aria-keyshortcuts="Delete Backspace"
        disabled={selection.locked}
        onClick={() => editor.deleteSelection()}
      >
        <TrashIcon />
        <span>{isFrame ? 'Delete frame' : 'Delete'}</span>
      </button>
      {isFrame && !selection.locked && <p className="inspector-note">Deleting a frame keeps its contents on the board.</p>}
    </aside>
  )
}
