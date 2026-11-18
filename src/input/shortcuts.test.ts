import { afterEach, describe, expect, it } from 'vitest'
import { isEditableTarget, isPanHoldKey, resolveShortcut } from './shortcuts.ts'
import type { KeyEventLike } from './shortcuts.ts'

const idle = { editingText: false }

function key(k: string, init: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: k,
    code: init.code ?? (k.length === 1 ? `Key${k.toUpperCase()}` : k),
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    target: document.body,
    ...init,
  }
}

const made: HTMLElement[] = []
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  document.body.appendChild(e)
  made.push(e)
  return e
}
afterEach(() => made.splice(0).forEach((e) => e.remove()))

describe('resolveShortcut: actions', () => {
  it('maps tool and add keys', () => {
    expect(resolveShortcut(key('v'), idle)).toBe('tool-select')
    expect(resolveShortcut(key('h'), idle)).toBe('tool-hand')
    expect(resolveShortcut(key('t'), idle)).toBe('tool-text')
    expect(resolveShortcut(key('i'), idle)).toBe('add-image')
    expect(resolveShortcut(key('f'), idle)).toBe('tool-frame')
    expect(resolveShortcut(key('F'), idle)).toBe('tool-frame') // Caps Lock
    expect(resolveShortcut(key('F', { shiftKey: true }), idle)).toBeNull()
    expect(resolveShortcut(key('f', { ctrlKey: true }), idle)).toBeNull() // the browser's Find stays the browser's
    expect(resolveShortcut(key('f', { altKey: true }), idle)).toBeNull()
    expect(resolveShortcut(key('f'), { editingText: true })).toBeNull()
    expect(resolveShortcut(key('V', { shiftKey: true }), idle)).toBeNull() // Shift+V is not select
  })

  it('maps undo/redo for both Ctrl and Cmd, and both redo spellings', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true }), idle)).toBe('undo')
    expect(resolveShortcut(key('z', { metaKey: true }), idle)).toBe('undo')
    expect(resolveShortcut(key('Z', { ctrlKey: true, shiftKey: true }), idle)).toBe('redo')
    expect(resolveShortcut(key('z', { metaKey: true, shiftKey: true }), idle)).toBe('redo')
    expect(resolveShortcut(key('y', { ctrlKey: true }), idle)).toBe('redo')
  })

  it('maps delete, escape and select all', () => {
    expect(resolveShortcut(key('Delete'), idle)).toBe('delete')
    expect(resolveShortcut(key('Backspace'), idle)).toBe('delete')
    expect(resolveShortcut(key('Escape'), idle)).toBe('escape')
    expect(resolveShortcut(key('Escape', { altKey: true }), idle)).toBe('escape') // cancels an Alt-drag
    expect(resolveShortcut(key('Escape', { ctrlKey: true }), idle)).toBeNull()
    expect(resolveShortcut(key('a', { ctrlKey: true }), idle)).toBe('select-all')
  })

  it('maps zoom and layer keys', () => {
    expect(resolveShortcut(key('='), idle)).toBe('zoom-in')
    expect(resolveShortcut(key('+', { shiftKey: true }), idle)).toBe('zoom-in')
    expect(resolveShortcut(key('-'), idle)).toBe('zoom-out')
    expect(resolveShortcut(key('0'), idle)).toBe('zoom-reset')
    expect(resolveShortcut(key('!', { shiftKey: true, code: 'Digit1' }), idle)).toBe('zoom-fit')
    expect(resolveShortcut(key(']'), idle)).toBe('layer-forward')
    expect(resolveShortcut(key('['), idle)).toBe('layer-backward')
    expect(resolveShortcut(key(']', { ctrlKey: true }), idle)).toBe('layer-front')
    expect(resolveShortcut(key('[', { metaKey: true }), idle)).toBe('layer-back')
  })

  it('leaves browser and OS combinations alone', () => {
    expect(resolveShortcut(key('t', { ctrlKey: true }), idle)).toBeNull() // new tab
    expect(resolveShortcut(key('r', { ctrlKey: true }), idle)).toBeNull()
    expect(resolveShortcut(key('z', { ctrlKey: true, altKey: true }), idle)).toBeNull()
    expect(resolveShortcut(key('h', { altKey: true }), idle)).toBeNull()
    expect(resolveShortcut(key('F5'), idle)).toBeNull()
    expect(resolveShortcut(key('Tab'), idle)).toBeNull()
    expect(resolveShortcut(key('Enter'), idle)).toBeNull()
  })
})

describe('resolveShortcut: never interferes with typing', () => {
  it.each([
    ['text input', () => el('input', { type: 'text' })],
    ['search input', () => el('input', { type: 'search' })],
    ['number input', () => el('input', { type: 'number' })],
    ['input with no type', () => el('input')],
    ['textarea (Fabric hidden textarea)', () => el('textarea')],
    ['select', () => el('select')],
  ])('ignores everything while focus is in a %s', (_name, make) => {
    const target = make()
    for (const k of ['v', 'h', 't', 'i', 'Delete', 'Backspace', '0', '-', '=', '[', ']', 'Escape']) {
      expect(resolveShortcut(key(k, { target }), idle), k).toBeNull()
    }
    expect(resolveShortcut(key('z', { target, ctrlKey: true }), idle)).toBeNull() // native undo in the field
    expect(resolveShortcut(key('a', { target, ctrlKey: true }), idle)).toBeNull() // native select-all in the field
  })

  it('ignores contenteditable targets', () => {
    const target = el('div')
    Object.defineProperty(target, 'isContentEditable', { value: true })
    expect(resolveShortcut(key('v', { target }), idle)).toBeNull()
  })

  it('ignores everything while a canvas text object is being edited', () => {
    const ctx = { editingText: true }
    expect(resolveShortcut(key('v'), ctx)).toBeNull()
    expect(resolveShortcut(key('Backspace'), ctx)).toBeNull()
    expect(resolveShortcut(key('z', { ctrlKey: true }), ctx)).toBeNull()
  })

  it('ignores keys during IME composition', () => {
    expect(resolveShortcut(key('v', { isComposing: true }), idle)).toBeNull()
  })

  it('still handles shortcuts when a button or the canvas has focus', () => {
    expect(resolveShortcut(key('v', { target: el('button') }), idle)).toBe('tool-select')
    expect(resolveShortcut(key('Delete', { target: el('canvas') }), idle)).toBe('delete')
    expect(resolveShortcut(key('v', { target: el('input', { type: 'checkbox' }) }), idle)).toBe('tool-select')
  })

  it('handles a null or non-element target without throwing', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(window as unknown as EventTarget)).toBe(false)
    expect(resolveShortcut(key('v', { target: null }), idle)).toBe('tool-select')
  })
})

describe('isPanHoldKey', () => {
  const space = (init: Partial<KeyEventLike> = {}) => key(' ', { code: 'Space', ...init })

  it('accepts Space on the page', () => {
    expect(isPanHoldKey(space(), idle)).toBe(true)
  })

  it('does not take Space from fields, buttons, or text editing', () => {
    expect(isPanHoldKey(space({ target: el('input', { type: 'text' }) }), idle)).toBe(false)
    expect(isPanHoldKey(space({ target: el('textarea') }), idle)).toBe(false)
    expect(isPanHoldKey(space({ target: el('button') }), idle)).toBe(false)
    expect(isPanHoldKey(space(), { editingText: true })).toBe(false)
  })

  it('ignores modified Space and other keys', () => {
    expect(isPanHoldKey(space({ ctrlKey: true }), idle)).toBe(false)
    expect(isPanHoldKey(key('a'), idle)).toBe(false)
  })
})
