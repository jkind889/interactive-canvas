export type ShortcutAction =
  | 'undo'
  | 'redo'
  | 'delete'
  | 'select-all'
  | 'tool-select'
  | 'tool-hand'
  | 'tool-text'
  | 'tool-frame'
  | 'add-image'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'zoom-reset'
  | 'layer-forward'
  | 'layer-backward'
  | 'layer-front'
  | 'layer-back'
  | 'escape'
  | 'format-bold'
  | 'format-italic'
  | 'format-underline'

export interface ShortcutContext {
  /** A Fabric text object is in edit mode. */
  editingText: boolean
  /** Exactly one text is selected (and not being edited): Ctrl/Cmd+B, I and U format it as a whole. */
  textSelected?: boolean
}

export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target' | 'isComposing'
>

/** Inputs, textareas (incl. Fabric's hidden one), selects and contenteditable. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    // Buttons/checkboxes are inputs but do not take typed text.
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(type)
  }
  return el.isContentEditable === true
}

/** Elements that use Space/Enter for themselves. */
export function isActivatableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return ['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) || el.getAttribute('role') === 'button'
}

/**
 * Maps a key event to an editor action, or null if the page should keep it.
 * Never claims keys while the user is typing into a field or editing text.
 */
export function resolveShortcut(e: KeyEventLike, ctx: ShortcutContext): ShortcutAction | null {
  if (e.isComposing || ctx.editingText || isEditableTarget(e.target)) return null

  const mod = e.ctrlKey || e.metaKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

  if (mod) {
    if (e.altKey) return null
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && !e.shiftKey) return 'redo'
    if (key === 'a' && !e.shiftKey) return 'select-all'
    if (key === ']') return 'layer-front'
    if (key === '[') return 'layer-back'
    // Only for a selected text; with anything else the key stays the browser's.
    if (ctx.textSelected && !e.shiftKey) {
      if (key === 'b') return 'format-bold'
      if (key === 'i') return 'format-italic'
      if (key === 'u') return 'format-underline'
    }
    return null
  }
  if (e.altKey) return null

  switch (key) {
    case 'Delete':
    case 'Backspace':
      return 'delete'
    case 'Escape':
      return 'escape'
    case ']':
      return 'layer-forward'
    case '[':
      return 'layer-backward'
    case '+':
    case '=':
      return 'zoom-in'
    case '-':
    case '_':
      return 'zoom-out'
    case '0':
      return 'zoom-reset'
  }
  if (e.shiftKey && e.code === 'Digit1') return 'zoom-fit'
  if (e.shiftKey) return null
  switch (key) {
    case 'v':
      return 'tool-select'
    case 'h':
      return 'tool-hand'
    case 't':
      return 'tool-text'
    case 'f':
      return 'tool-frame'
    case 'i':
      return 'add-image'
  }
  return null
}

/** A mark that a key pressed while a text is being edited toggles. */
export type EditingShortcut = 'bold' | 'italic' | 'underline'

export interface EditingContext {
  /** The hidden textarea of the text being edited (where its keys arrive), or null when no text is being edited. */
  editedTextarea: EventTarget | null
}

/**
 * Keys pressed while a text is being edited. Claims only Ctrl/Cmd+B, I and U, and only when
 * they come from the text being edited: never with Alt or Shift held, never during IME
 * composition. Everything else (typing, selection and clipboard keys, Ctrl/Cmd+A, Esc and Tab
 * to leave the edit) stays Fabric's and the browser's. `resolveShortcut` keeps returning
 * null while a text is edited, so no canvas shortcut fires.
 */
export function resolveEditingShortcut(e: KeyEventLike, ctx: EditingContext): EditingShortcut | null {
  if (ctx.editedTextarea === null || e.target !== ctx.editedTextarea || e.isComposing) return null
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key === 'b') return 'bold'
  if (key === 'i') return 'italic'
  if (key === 'u') return 'underline'
  return null
}

/** Space held (outside fields/buttons) temporarily switches to the hand tool. */
export function isPanHoldKey(e: KeyEventLike, ctx: ShortcutContext): boolean {
  return (
    e.code === 'Space' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.isComposing &&
    !ctx.editingText &&
    !isEditableTarget(e.target) &&
    !isActivatableTarget(e.target)
  )
}
