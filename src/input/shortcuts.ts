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
  | 'toggle-lock'
  | 'escape'

export interface ShortcutContext {
  /** A Fabric text object is in edit mode. */
  editingText: boolean
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
    if (key === 'l' && e.shiftKey) return 'toggle-lock'
    if (key === ']') return 'layer-front'
    if (key === '[') return 'layer-back'
    return null
  }
  // Esc also counts with Alt held: Alt-drag moves a covered selected object, and Esc must cancel it.
  if (key === 'Escape') return 'escape'
  if (e.altKey) return null

  switch (key) {
    case 'Delete':
    case 'Backspace':
      return 'delete'
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

/**
 * Plain Enter (outside fields and buttons, which use Enter themselves): applies an open crop.
 * Enter in the title field, or on a focused Cancel button, is not this key.
 */
export function isConfirmKey(e: KeyEventLike, ctx: ShortcutContext): boolean {
  return (
    e.key === 'Enter' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    !e.isComposing &&
    !ctx.editingText &&
    !isEditableTarget(e.target) &&
    !isActivatableTarget(e.target)
  )
}
