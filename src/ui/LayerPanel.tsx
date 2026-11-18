import { memo, useId } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Editor, LayerItem } from '../editor/Editor.ts'
import { ChevronIcon, FrameIcon, ImageIcon, LockIcon, TextIcon, UnlockIcon } from './icons.tsx'

const KindIcon = ({ kind }: { kind: LayerItem['kind'] }) => (kind === 'frame' ? <FrameIcon /> : kind === 'text' ? <TextIcon /> : <ImageIcon />)

const kindName = { image: 'Image', text: 'Text', frame: 'Frame' } as const

/**
 * A field in the chrome that keeps keystrokes for itself (the font size, a frame name, the
 * board title). Fabric's hidden textarea (in the document body, marked `data-fabric`) is
 * not one: leaving a text edit is the editor's job.
 */
function focusedChromeField(): HTMLElement | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el.closest('[data-fabric], .canvas-host')) return null
  return el.matches('input, textarea, select') || el.isContentEditable ? el : null
}

/**
 * What a primary mouse press on a row or padlock lets go of, without taking focus itself: a
 * focused chrome field (its blur commits what was typed), or a row or padlock of this list that
 * still holds focus from the keyboard (otherwise Space, meant to pan, would act on that row).
 */
function focusToRelease(): HTMLElement | null {
  const field = focusedChromeField()
  if (field) return field
  const el = document.activeElement
  return el instanceof HTMLElement && el.closest('.layers-list') ? el : null
}

/**
 * Everything on the board in stacking order, front-most first, with frames at the bottom
 * (they always sit behind content). Clicking a row selects that object, even one that is
 * completely covered; Ctrl/Cmd- or Shift-click adds it to or removes it from the selection.
 * Each row's padlock locks or unlocks its item without selecting it; a locked item can be
 * selected only here, and only on its own.
 */
export const LayerPanel = memo(function LayerPanel({
  editor,
  layers,
  readOnly,
  open,
  onToggleOpen,
}: {
  editor: Editor
  layers: readonly LayerItem[]
  readOnly: boolean
  /** Kept by the parent, so that it survives the list becoming empty and the panel unmounting. */
  open: boolean
  onToggleOpen: () => void
}) {
  const listId = useId()

  const choose = (id: string, toggle: boolean) => {
    if (readOnly) return
    editor.selectLayer(id, { toggle })
  }
  const onClick = (e: ReactMouseEvent<HTMLLIElement>, id: string) => {
    if (e.button !== 0) return
    choose(id, e.ctrlKey || e.metaKey || e.shiftKey)
  }
  const onKey = (e: ReactKeyboardEvent<HTMLLIElement>, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation() // Space here selects; it is not the hold-to-pan key
    if (e.repeat) return // holding the key must not toggle the row back and forth
    choose(id, e.ctrlKey || e.metaKey || e.shiftKey)
  }

  return (
    <section className="floating layers" aria-label="Layers panel">
      <button
        type="button"
        className="layers-header"
        aria-expanded={open}
        aria-controls={listId}
        title={open ? 'Hide the layer list' : 'Show the layer list'}
        onClick={onToggleOpen}
      >
        <span className="layers-title">Layers</span>
        <span className="layers-count">{layers.length}</span>
        <span className={`layers-chevron${open ? ' is-open' : ''}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <ul id={listId} className="layers-list" role="listbox" aria-label="Layers" aria-multiselectable="true" aria-disabled={readOnly || undefined}>
          {layers.map((item) => (
            <li
              key={item.id}
              role="option"
              aria-selected={item.selected}
              aria-disabled={readOnly || undefined}
              data-layer-id={item.id}
              data-layer-kind={item.kind}
              data-layer-locked={item.locked || undefined}
              className={`layer-row${item.selected ? ' is-selected' : ''}${item.locked ? ' is-locked' : ''}`}
              tabIndex={readOnly ? undefined : 0}
              title={item.frameName ? `${item.label} (in ${item.frameName})` : item.label}
              onMouseDown={(e) => {
                // Preventing the press's default (below) would also keep a focused field (font
                // size, frame name, title) focused, and its keys would then act on the newly
                // selected object. Let it go first, as any other click would; its blur commits
                // what was typed. A read-only board's rows do nothing, focus included.
                if (!readOnly && e.button === 0) focusToRelease()?.blur()
                // A mouse press must not move focus here: Space (hold to pan) and the letter
                // shortcuts would then act on the list instead of the board.
                e.preventDefault()
              }}
              onClick={(e) => onClick(e, item.id)}
              onKeyDown={(e) => onKey(e, item.id)}
            >
              <span className="layer-icon" aria-label={kindName[item.kind]} role="img">
                <KindIcon kind={item.kind} />
              </span>
              <span className="layer-label">{item.label}</span>
              {item.frameName !== null && <span className="layer-frame">{item.frameName}</span>}
              <button
                type="button"
                className="layer-lock"
                data-testid="layer-lock"
                aria-label={item.locked ? 'Unlock' : 'Lock'}
                aria-pressed={item.locked}
                title={`${item.locked ? 'Unlock' : 'Lock'} ${item.label}`}
                disabled={readOnly}
                onMouseDown={(e) => {
                  // As for the row: let a focused field go (its blur commits it), but do not take
                  // focus, so that Space and the letter shortcuts keep acting on the board.
                  if (!readOnly && e.button === 0) focusToRelease()?.blur()
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.stopPropagation() // locking is not selecting: the row is left alone
                  if (readOnly || e.button !== 0) return
                  editor.toggleLayerLock(item.id)
                }}
                onKeyDown={(e) => {
                  // Enter and Space press this button; they must not reach the row, which would select it.
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
                }}
              >
                {item.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
