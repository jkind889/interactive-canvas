import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyDoc } from '../model/doc.ts'
import type { BoardDoc, StoredAsset, TextRecord } from '../model/types.ts'
import { CONFLICT_MESSAGE } from '../persistence/autosave.ts'
import { BoardConflictError } from '../persistence/boardStore.ts'
import { Editor } from './Editor.ts'
import { canvasOf, dragBy, mouse, press, release, scaleBy, tick } from './testing/drive.ts'
import type { Canvas, FakeObject, Textbox } from './testing/fakeFabric.ts'
import { FakeAssets, SpyStore, deferred } from './testing/fakes.ts'

vi.mock('fabric', () => import('./testing/fakeFabric.ts'))

const asset = (id: string): StoredAsset => ({ id, name: `${id}.png`, type: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer })
const text = (patch: Partial<TextRecord> = {}): TextRecord => ({ type: 'text', id: 'txt-1', left: 300, top: 40, angle: 0, text: 'keep me', fontSize: 24, width: 240, ...patch })

const storedDoc = (): BoardDoc => ({
  ...createEmptyDoc(),
  title: 'Stored',
  objects: [{ type: 'image', id: 'img-1', left: 10, top: 20, angle: 0, assetId: 'a1', scaleX: 1, scaleY: 1 }, text()],
})

const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })

let host: HTMLDivElement
const editors: Editor[] = []
const flush = () => vi.advanceTimersByTimeAsync(10_000)

async function setup(doc: BoardDoc | null = storedDoc()) {
  const store = new SpyStore(doc ? { doc, assets: new Map([['a1', asset('a1')]]) } : null)
  store.holdLoad = false
  const editor = new Editor(host, store, new FakeAssets())
  editors.push(editor)
  await editor.init()
  const canvas = canvasOf(editor)
  const byId = (id: string) => canvas.objects[doc ? doc.objects.findIndex((o) => o.id === id) : -1] as FakeObject
  /** Records as the editor would save them right now (through its own getDoc). */
  const scene = () => (editor as unknown as { getDoc: () => BoardDoc }).getDoc().objects
  const live = () => canvas.objects.map((o) => ({ left: o.left, top: o.top }))
  return { editor, store, canvas, byId, scene, live }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) // autosave's debounce; microtasks stay real
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  editors.splice(0).forEach((e) => e.dispose())
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('durable scene: a save never sees an unfinished gesture', () => {
  it('a save during a held drag has the new title and the pre-gesture scene; release saves the final scene; one undo goes back', async () => {
    const { editor, store, canvas, byId } = await setup()
    editor.setTitle('Renamed') // board is dirty before the gesture starts
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 100, 50)
    await flush() // the drag is held well past the autosave debounce
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0]!.doc.title).toBe('Renamed')
    expect(store.saves[0]!.doc.objects[0]).toMatchObject({ id: 'img-1', left: 10, top: 20 }) // not the half-dragged position

    dragBy(canvas, t, 5, 5)
    release(canvas, t)
    await tick()
    await flush()
    expect(store.saves).toHaveLength(2)
    expect(store.saves[1]!.doc.objects[0]).toMatchObject({ id: 'img-1', left: 115, top: 75 })

    expect(editor.getState().canUndo).toBe(true)
    editor.undo()
    expect(canvas.objects[0]).toMatchObject({ left: 10, top: 20 })
    expect(editor.getState().canUndo).toBe(false) // exactly one step
  })

  it('a flush when the page is hidden mid-drag also stores the pre-gesture scene', async () => {
    const { editor, store, canvas, byId } = await setup()
    editor.setTitle('Dirty')
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 70, 0)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    visibility.mockRestore()
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0]!.doc.objects[0]).toMatchObject({ left: 10, top: 20 })
    release(canvas, t)
    await tick()
    await flush()
    expect(store.saves.at(-1)!.doc.objects[0]).toMatchObject({ left: 80, top: 20 })
  })

  it('a save that follows one already in flight still stores the pre-gesture scene', async () => {
    const { editor, store, canvas, byId } = await setup()
    store.saveGate = deferred<void>()
    editor.setTitle('First')
    await flush() // save 1 is now in flight, held by the gate
    expect(store.attempts).toHaveLength(1)

    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 40, 40)
    editor.setTitle('Second') // changed while saving
    store.saveGate.resolve()
    store.saveGate = null
    await flush()
    expect(store.saves).toHaveLength(2)
    expect(store.saves[1]!.doc.title).toBe('Second')
    expect(store.saves[1]!.doc.objects[0]).toMatchObject({ left: 10, top: 20 })

    release(canvas, t)
    await tick()
    await flush()
    expect(store.saves).toHaveLength(3)
    expect(store.saves[2]!.doc.objects[0]).toMatchObject({ left: 50, top: 60 })
  })
})

describe('clicks and text', () => {
  it('a press that never moves leaves no trace: no history entry, no save, not busy afterwards', async () => {
    const { editor, store, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    release(canvas, t)
    await tick()
    await flush()
    expect(editor.getState().canUndo).toBe(false)
    expect(store.attempts).toHaveLength(0)
    editor.addText() // commands work again
    expect(editor.getState().editingText).toBe(true)
  })

  it('a caret press on an editing textbox between typing bursts starts no gesture and adds no history', async () => {
    const { editor, store, canvas } = await setup(null)
    editor.addText()
    const tb = canvas.objects[0] as Textbox
    tb.type('first burst')
    // Clicking inside the text to move the caret: Fabric still fires before:transform and mouse:up.
    const t = press(canvas, tb)
    release(canvas, t)
    await tick()
    expect(editor.getState().editingText).toBe(true)
    expect(editor.getState().canUndo).toBe(false)
    tb.type('first burst, second burst')
    await flush()
    expect(store.saves.at(-1)!.doc.objects[0]).toMatchObject({ text: 'first burst, second burst' }) // typing saves the live scene

    tb.exitEditing()
    expect(editor.getState().canUndo).toBe(true)
    editor.undo()
    expect(canvas.objects).toHaveLength(0)
    expect(editor.getState().canUndo).toBe(false) // creating and typing the text was exactly one step
  })

  it('the text tool places its text after the click has been handled, not inside the canvas callback', async () => {
    const { editor, canvas } = await setup(null)
    editor.setTool('text')
    canvas.fire('mouse:up', { e: mouse(0, 120, 80), isClick: true })
    expect(canvas.objects).toHaveLength(0)
    await tick()
    expect(canvas.objects).toHaveLength(1)
    expect(canvas.objects[0]).toMatchObject({ left: 120, top: 80, isEditing: true })
    expect(editor.getState().tool).toBe('select')
  })

  it('a non-primary click with the text tool places nothing', async () => {
    const { editor, canvas } = await setup(null)
    editor.setTool('text')
    canvas.fire('mouse:up', { e: mouse(2, 120, 80), isClick: true })
    await tick()
    expect(canvas.objects).toHaveLength(0)
  })
})

describe('settlement is deferred and guarded', () => {
  it('nothing is committed inside object:modified; the commit happens in a microtask', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 30, 0)
    release(canvas, t)
    expect(editor.getState().canUndo).toBe(false) // still inside "Fabric's" mouse-up handling
    await tick()
    expect(editor.getState().canUndo).toBe(true)
  })

  it('a settlement cancelled before it runs does nothing', async () => {
    const { editor, store, canvas, byId, live } = await setup()
    const before = live()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 30, 0)
    canvas.fire('object:modified', { e: mouse(0), target: t.target, transform: t, action: 'drag' }) // settlement queued
    editor.handleKeyDown(key('Escape')) // cancelled in the same task
    await tick()
    await flush()
    expect(live()).toEqual(before)
    expect(editor.getState().canUndo).toBe(false)
    expect(store.attempts).toHaveLength(0)
  })

  it('a settlement superseded by a newer gesture does nothing', async () => {
    const { editor, canvas, byId } = await setup()
    const first = press(canvas, byId('img-1'))
    dragBy(canvas, first, 30, 0)
    canvas.fire('object:modified', { e: mouse(0), target: first.target, transform: first, action: 'drag' })
    const second = press(canvas, byId('txt-1')) // replaces the gesture before the queued settlement runs
    await tick()
    expect(editor.getState().canUndo).toBe(false)
    editor.addText() // still busy with the second gesture
    expect(canvas.objects).toHaveLength(2)
    release(canvas, second)
    await tick()
    expect(editor.getState().canUndo).toBe(false)
  })

  it('only the gesture own transform settles it, and only once', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 30, 0)
    canvas.fire('object:modified', { e: mouse(0), target: t.target }) // e.g. a text leaving its edit: no transform
    canvas.fire('object:modified', { e: mouse(0), target: t.target, transform: { ...t } }) // some other transform
    await tick()
    expect(editor.getState().canUndo).toBe(false)
    release(canvas, t)
    canvas.fire('object:modified', { e: mouse(0), target: t.target, transform: t, action: 'drag' }) // a duplicate
    await tick()
    expect(editor.getState().canUndo).toBe(true)
    editor.undo()
    expect(editor.getState().canUndo).toBe(false)
  })
})

describe('Esc and window blur cancel an unfinished gesture', () => {
  it('Esc mid-drag restores the board with no history; the late mouse-up changes nothing', async () => {
    const { editor, store, canvas, byId, live } = await setup()
    const before = live()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 200, 100)
    const event = key('Escape')
    editor.handleKeyDown(event)
    expect(event.defaultPrevented).toBe(true)
    expect(canvas.calls).toContain('endCurrentTransform')
    expect(canvas._currentTransform).toBeNull()
    expect(live()).toEqual(before)
    expect(editor.getState().canUndo).toBe(false)

    release(canvas, t) // the button comes up later: Fabric has no transform any more
    await tick()
    await flush()
    expect(live()).toEqual(before)
    expect(editor.getState().canUndo).toBe(false)
    expect(store.attempts).toHaveLength(0)
    editor.addText() // not stuck busy
    expect(editor.getState().editingText).toBe(true)
  })

  it('window blur mid-scale restores the board with no history', async () => {
    const { editor, store, canvas, byId } = await setup()
    const img = byId('img-1')
    const t = press(canvas, img, { action: 'scale', corner: 'br' })
    scaleBy(canvas, t, 3)
    window.dispatchEvent(new Event('blur'))
    expect(canvas.objects[0]).toMatchObject({ left: 10, top: 20, scaleX: 1, scaleY: 1 })
    expect(editor.getState().canUndo).toBe(false)
    release(canvas, t)
    await tick()
    await flush()
    expect(editor.getState().canUndo).toBe(false)
    expect(store.attempts).toHaveLength(0)
  })

  it('keeps the selection by id across the restore', async () => {
    const { editor, canvas, byId } = await setup()
    canvas.setActiveObject(byId('img-1'))
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 10, 10)
    editor.handleKeyDown(key('Escape'))
    expect(canvas.getActiveObject()).toBe(canvas.objects[0]) // the rebuilt image, selected again
    expect(editor.getState().selection?.kind).toBe('image')
  })

  it('does not touch Fabric when the transform is no longer Fabric current one', async () => {
    const { editor, canvas, byId, live } = await setup()
    const before = live()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 10, 10)
    canvas._currentTransform = null // Fabric already dropped it
    editor.handleKeyDown(key('Escape'))
    expect(canvas.calls).not.toContain('endCurrentTransform')
    expect(live()).toEqual(before)
  })

  it('Esc with no gesture keeps its ordinary meaning', async () => {
    const { editor, canvas, byId } = await setup()
    canvas.setActiveObject(byId('img-1'))
    editor.handleKeyDown(key('Escape'))
    expect(canvas.getActiveObject()).toBeNull()
    editor.setTool('text')
    editor.handleKeyDown(key('Escape'))
    expect(editor.getState().tool).toBe('select')
  })
})

describe('busy guard: commands and shortcuts wait for the gesture', () => {
  it('everything that edits is inert while a gesture is unsettled, and works after it', async () => {
    const { editor, store, canvas, byId, scene } = await setup()
    // One undo step to begin with, so undo/redo have something to do.
    const first = press(canvas, byId('txt-1'))
    dragBy(canvas, first, 5, 5)
    release(canvas, first)
    await tick()
    expect(editor.getState().canUndo).toBe(true)
    await flush()
    const saves = store.attempts.length

    canvas.setActiveObject(byId('img-1'))
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 50, 0)
    const picker = vi.fn()
    editor.setImagePicker(picker)
    const before = JSON.stringify(scene())
    const zoom = editor.getState().viewport.zoom

    editor.undo()
    editor.redo()
    editor.deleteSelection()
    editor.selectAll()
    editor.arrange('front')
    editor.setTool('text')
    editor.setTool('hand')
    editor.addText()
    editor.setFontSize(99)
    for (const k of ['Delete', 'Backspace', 't', 'h', 'v', 'i', ']', '[']) editor.handleKeyDown(key(k))
    for (const k of ['a', 'z', 'y', ']']) editor.handleKeyDown(key(k, { ctrlKey: true }))
    editor.handleKeyDown(key(' ', { code: 'Space' }))

    expect(canvas.objects).toHaveLength(2)
    expect(canvas.objects[0]).toMatchObject({ left: 60, top: 20 }) // the drag itself is untouched
    expect(canvas.getActiveObject()).toBe(byId('img-1'))
    expect(editor.getState().tool).toBe('select')
    expect(editor.getState().handActive).toBe(false)
    expect(editor.getState().canUndo).toBe(true)
    expect(editor.getState().canRedo).toBe(false)
    expect(JSON.stringify(scene())).toBe(before)
    expect(picker).not.toHaveBeenCalled()

    editor.handleKeyDown(key('=')) // zoom still works mid-gesture
    expect(editor.getState().viewport.zoom).toBeGreaterThan(zoom)

    release(canvas, t)
    await tick()
    await flush()
    expect(store.attempts.length).toBeGreaterThan(saves)
    editor.handleKeyDown(key('i'))
    expect(picker).toHaveBeenCalledTimes(1)
    editor.undo()
    expect(canvas.objects[0]).toMatchObject({ left: 10, top: 20 })
    editor.handleKeyDown(key('Delete'))
    expect(canvas.objects).toHaveLength(1)
  })

  it('the title stays editable during a gesture', async () => {
    const { editor, canvas, byId } = await setup()
    press(canvas, byId('img-1'))
    expect(editor.setTitle('Renamed mid-drag')).toBe('Renamed mid-drag')
    expect(editor.getState().title).toBe('Renamed mid-drag')
  })
})

describe('pointer buttons: only the primary button edits', () => {
  it('creates the canvas with other buttons and modifier scaling switched off', async () => {
    const { canvas } = await setup()
    expect(canvas.options).toMatchObject({ fireRightClick: false, fireMiddleClick: false, uniScaleKey: null, altActionKey: null })
  })

  it('a mouse:up from button 1 or 2 leaves an unperformed transform in place; the primary release clears it', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    release(canvas, t, 2)
    release(canvas, t, 1)
    await tick()
    editor.addText()
    expect(canvas.objects).toHaveLength(2) // still busy: the primary button is still down
    release(canvas, t, 0)
    await tick()
    editor.addText()
    expect(canvas.objects).toHaveLength(3)
    expect(editor.getState().canUndo).toBe(false) // the click itself recorded nothing
  })

  it('a mouse:up from another button does not settle or clear a performed drag', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 20, 0)
    release(canvas, t, 2)
    await tick()
    expect(editor.getState().canUndo).toBe(false)
    dragBy(canvas, t, 20, 0) // the drag is still live
    release(canvas, t, 0)
    await tick()
    expect(editor.getState().canUndo).toBe(true)
    expect(canvas.objects[0]).toMatchObject({ left: 50, top: 20 })
    editor.undo()
    expect(editor.getState().canUndo).toBe(false) // one step for the whole drag
  })

  describe('at DOM level', () => {
    const fabricSees = (canvas: Canvas) => {
      const seen: number[] = []
      canvas.upperCanvasEl.addEventListener('mousedown', (e) => seen.push(e.button)) // where Fabric listens for presses
      return seen
    }
    const documentSees = () => {
      const seen: number[] = []
      const fn = (e: MouseEvent) => seen.push(e.button)
      document.addEventListener('mouseup', fn) // where Fabric listens for releases during a drag
      return { seen, off: () => document.removeEventListener('mouseup', fn) }
    }
    const down = (canvas: Canvas, button: number) =>
      canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    const up = (button: number, target: EventTarget = document.body) => target.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true, cancelable: true }))
    const moveTo = (x: number, y: number) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))

    it('a non-primary mousedown never reaches the canvas element; a primary one does', async () => {
      const { canvas } = await setup()
      const seen = fabricSees(canvas)
      down(canvas, 2)
      down(canvas, 1)
      up(1)
      expect(seen).toEqual([])
      down(canvas, 0)
      expect(seen).toEqual([0])
      up(0)
    })

    it('a non-primary mouseup reaches the document only when no primary press is outstanding', async () => {
      const { canvas } = await setup()
      const doc = documentSees()
      try {
        up(2)
        up(1)
        expect(doc.seen).toEqual([2, 1]) // nothing held: harmless, Fabric is not listening

        down(canvas, 0) // primary press passed through to Fabric
        up(2)
        up(1)
        expect(doc.seen).toEqual([2, 1]) // swallowed, so Fabric keeps tracking the primary drag
        up(0)
        expect(doc.seen).toEqual([2, 1, 0]) // the primary release always gets through

        up(2)
        expect(doc.seen).toEqual([2, 1, 0, 2]) // and afterwards nothing is swallowed any more
      } finally {
        doc.off()
      }
    })

    it('a middle-button pan ends only on the middle release', async () => {
      const { editor, canvas } = await setup()
      const panX = () => editor.getState().viewport.panX
      down(canvas, 1)
      moveTo(40, 10)
      expect(panX()).toBe(30)
      up(2)
      up(0)
      moveTo(60, 10)
      expect(panX()).toBe(50) // still panning
      up(1)
      moveTo(100, 10)
      expect(panX()).toBe(50) // ended by its own button
    })

    it('a middle press during a primary drag starts no pan and is swallowed', async () => {
      const { editor, canvas } = await setup()
      const seen = fabricSees(canvas)
      down(canvas, 0)
      down(canvas, 1)
      moveTo(80, 10)
      expect(editor.getState().viewport.panX).toBe(0)
      expect(seen).toEqual([0])
      up(1)
      up(0)
    })

    it('a hand-tool pan started by the primary button ends on the primary release and never reaches Fabric', async () => {
      const { editor, canvas } = await setup()
      const seen = fabricSees(canvas)
      editor.setTool('hand')
      down(canvas, 0)
      moveTo(25, 10)
      expect(editor.getState().viewport.panX).toBe(15)
      up(2)
      moveTo(35, 10)
      expect(editor.getState().viewport.panX).toBe(25)
      up(0)
      moveTo(95, 10)
      expect(editor.getState().viewport.panX).toBe(25)
      expect(seen).toEqual([])
    })

    it('a window blur ends a pan whose release never arrived', async () => {
      const { editor, canvas } = await setup()
      down(canvas, 1)
      moveTo(30, 10)
      window.dispatchEvent(new Event('blur'))
      moveTo(90, 10)
      expect(editor.getState().viewport.panX).toBe(20)
    })
  })
})

describe('imports that finish during a gesture', () => {
  const png = () => new File([new Uint8Array([1, 2, 3])], 'drop.png', { type: 'image/png' })

  it('are applied after settlement as their own undo step', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 100, 0)
    await editor.addImageFiles([png()]) // decoding ends while the pointer is still held
    expect(canvas.objects).toHaveLength(2) // nothing touched the canvas mid-gesture
    expect(canvas.getActiveObject()).toBeNull()

    release(canvas, t)
    await tick()
    expect(canvas.objects).toHaveLength(3)
    expect(canvas.objects[0]).toMatchObject({ left: 110 })

    editor.undo() // first undo: the import only
    expect(canvas.objects).toHaveLength(2)
    expect(canvas.objects[0]).toMatchObject({ left: 110 })
    editor.undo() // second undo: the drag
    expect(canvas.objects[0]).toMatchObject({ left: 10 })
    expect(editor.getState().canUndo).toBe(false)
  })

  it('are applied after a click that performed nothing', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    await editor.addImageFiles([png()])
    expect(canvas.objects).toHaveLength(2)
    release(canvas, t)
    await tick()
    expect(canvas.objects).toHaveLength(3)
    editor.undo()
    expect(canvas.objects).toHaveLength(2)
    expect(editor.getState().canUndo).toBe(false)
  })

  it('are applied after a cancelled gesture too', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 100, 0)
    await editor.addImageFiles([png()])
    editor.handleKeyDown(key('Escape'))
    await tick()
    expect(canvas.objects).toHaveLength(3)
    expect(canvas.objects[0]).toMatchObject({ left: 10 })
    editor.undo()
    expect(canvas.objects).toHaveLength(2)
    expect(editor.getState().canUndo).toBe(false)
  })

  it('are dropped with a notice when the board became read-only meanwhile', async () => {
    const { editor, store, canvas, byId } = await setup()
    store.saveError = new BoardConflictError()
    editor.setTitle('This save will conflict')
    const t = press(canvas, byId('img-1'))
    dragBy(canvas, t, 100, 0)
    await editor.addImageFiles([png(), png()])
    await flush() // the conflicting save lands: read-only, gesture undone
    expect(editor.getState().readOnly).toBe(CONFLICT_MESSAGE)
    expect(editor.getState().notice).toMatchObject({ kind: 'error', message: expect.stringContaining('2 images were not added') })
    expect(canvas.objects).toHaveLength(2)
    expect(canvas.objects[0]).toMatchObject({ left: 10 }) // the unfinished drag was undone
    release(canvas, t)
    await tick()
    expect(canvas.objects).toHaveLength(2)
  })

  it('says so when it drops them', async () => {
    const { editor, canvas, byId } = await setup()
    const t = press(canvas, byId('img-1'))
    await editor.addImageFiles([png(), png()])
    ;(editor as unknown as { enterReadOnly: (m: string) => void }).enterReadOnly('gone read-only')
    expect(editor.getState().notice).toMatchObject({ kind: 'error', message: expect.stringContaining('2 images were not added') })
    release(canvas, t)
    await tick()
    expect(canvas.objects).toHaveLength(2)
  })
})

describe('one scale factor per gesture (single text)', () => {
  const big = (fontSize: number) => ({ ...createEmptyDoc(), objects: [text({ fontSize, width: 1000, left: 100, top: 100 })] })

  it('limits an enlargement by the pre-gesture font size and keeps the anchor fixed', async () => {
    const { editor, canvas } = await setup(big(300))
    const tb = canvas.objects[0] as Textbox
    const t = press(canvas, tb, { action: 'scale', corner: 'br' }) // anchor: top-left
    scaleBy(canvas, t, 2)
    release(canvas, t)
    await tick()
    expect(tb.fontSize).toBe(400) // 300 x 400/300, not 300 x 2 clamped per member
    expect(tb.width).toBeCloseTo((1000 * 400) / 300, 1)
    expect(tb).toMatchObject({ scaleX: 1, scaleY: 1, left: 100, top: 100 })
    editor.undo()
    expect(canvas.objects[0]).toMatchObject({ fontSize: 300, width: 1000, left: 100, top: 100 })
  })

  it('keeps the opposite corner fixed when the limit is re-applied from another handle', async () => {
    const { canvas } = await setup(big(300))
    const tb = canvas.objects[0] as Textbox
    const right = tb.left + tb.width
    const bottom = tb.top + tb.height
    const t = press(canvas, tb, { action: 'scale', corner: 'tl', originX: 'right', originY: 'bottom' })
    scaleBy(canvas, t, 2)
    release(canvas, t)
    await tick()
    expect(tb.fontSize).toBe(400)
    expect(tb.left + tb.width).toBeCloseTo(right, 1)
    expect(tb.top + tb.height * (400 / 300)).toBeCloseTo(bottom, 1) // the fake keeps its unscaled height
  })

  it('an out-of-range text may shrink toward the range and is never snapped into it', async () => {
    const { canvas } = await setup(big(500))
    const tb = canvas.objects[0] as Textbox
    let t = press(canvas, tb, { action: 'scale', corner: 'br' })
    scaleBy(canvas, t, 0.95)
    release(canvas, t)
    await tick()
    expect(tb.fontSize).toBe(475)
    expect(tb.width).toBe(950)

    t = press(canvas, tb, { action: 'scale', corner: 'br' })
    scaleBy(canvas, t, 1.2) // further out of range: not allowed at all
    release(canvas, t)
    await tick()
    expect(tb.fontSize).toBe(475) // unchanged, and not snapped to 400
    expect(tb.width).toBe(950)
  })

  it('a blocked scale is a no-op: no history entry and no save', async () => {
    const { editor, store, canvas } = await setup(big(500))
    const t = press(canvas, canvas.objects[0]!, { action: 'scale', corner: 'br' })
    scaleBy(canvas, t, 1.5)
    release(canvas, t)
    await tick()
    await flush()
    expect(editor.getState().canUndo).toBe(false)
    expect(store.attempts).toHaveLength(0)
  })

  it('a textbox scaled by a handle while it is being edited (no gesture) gets the same limit before folding', async () => {
    const { editor, canvas } = await setup(big(300))
    const tb = canvas.objects[0] as Textbox
    canvas.setActiveObject(tb)
    tb.enterEditing()
    const t = press(canvas, tb, { action: 'scale', corner: 'br' }) // ignored as a gesture: the text is being edited
    scaleBy(canvas, t, 2)
    release(canvas, t)
    expect(tb.fontSize).toBe(400)
    expect(tb).toMatchObject({ scaleX: 1, scaleY: 1, left: 100, top: 100 })
    expect(editor.getState().canUndo).toBe(true) // committed on the spot, as before
  })

  it('changing a text wrap width is not a scale and is not limited', async () => {
    const { canvas } = await setup(big(500))
    const tb = canvas.objects[0] as Textbox
    const t = press(canvas, tb, { action: 'resizing', corner: 'mr' })
    tb.width = 1400
    t.actionPerformed = true
    release(canvas, t)
    await tick()
    expect(tb).toMatchObject({ width: 1400, fontSize: 500 })
  })
})
