import { memo, useId, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Editor, LayerItem } from '../editor/Editor.ts'
import { ChevronIcon, FrameIcon, ImageIcon, TextIcon } from './icons.tsx'

const KindIcon = ({ kind }: { kind: LayerItem['kind'] }) => (kind === 'frame' ? <FrameIcon /> : kind === 'text' ? <TextIcon /> : <ImageIcon />)

const kindName = { image: 'Image', text: 'Text', frame: 'Frame' } as const

/**
 * Everything on the board in stacking order, front-most first, with frames at the bottom
 * (they always sit behind content). Clicking a row selects that object, even one that is
 * completely covered; Ctrl/Cmd- or Shift-click adds it to or removes it from the selection.
 */
export const LayerPanel = memo(function LayerPanel({
  editor,
  layers,
  readOnly,
}: {
  editor: Editor
  layers: readonly LayerItem[]
  readOnly: boolean
}) {
  const [open, setOpen] = useState(true)
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
        onClick={() => setOpen((v) => !v)}
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
              className={`layer-row${item.selected ? ' is-selected' : ''}`}
              tabIndex={readOnly ? undefined : 0}
              title={item.frameName ? `${item.label} (in ${item.frameName})` : item.label}
              // A mouse press must not move focus here: Space (hold to pan) and the letter
              // shortcuts would then act on the list instead of the board.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onClick(e, item.id)}
              onKeyDown={(e) => onKey(e, item.id)}
            >
              <span className="layer-icon" aria-label={kindName[item.kind]} role="img">
                <KindIcon kind={item.kind} />
              </span>
              <span className="layer-label">{item.label}</span>
              {item.frameName !== null && <span className="layer-frame">{item.frameName}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
