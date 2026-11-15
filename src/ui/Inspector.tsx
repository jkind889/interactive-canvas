import { useId } from 'react'
import type { Editor, SelectionInfo } from '../editor/Editor.ts'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../model/doc.ts'
import { IconButton } from './IconButton.tsx'
import { BackwardIcon, ForwardIcon, ToBackIcon, ToFrontIcon, TrashIcon } from './icons.tsx'

const heading = (s: SelectionInfo) => (s.kind === 'multiple' ? `${s.count} objects` : s.kind === 'text' ? 'Text' : 'Image')

export function Inspector({ editor, selection }: { editor: Editor; selection: SelectionInfo }) {
  const sizeId = useId()
  return (
    <aside className="floating inspector" aria-label="Selection">
      <div className="inspector-title">{heading(selection)}</div>

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

      <button type="button" className="danger-btn" aria-keyshortcuts="Delete Backspace" onClick={() => editor.deleteSelection()}>
        <TrashIcon />
        <span>Delete</span>
      </button>
    </aside>
  )
}
