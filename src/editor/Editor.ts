import { ActiveSelection, Textbox } from 'fabric'
import type { FabricObject, Transform } from 'fabric'
import {
  DEFAULT_VIEWPORT,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clamp,
  normalizeFrameName,
  normalizeTitle,
  referencedAssetIds,
  round,
  roundPositive,
  sceneEqual,
} from '../model/doc.ts'
import {
  DEFAULT_FRAME_SCREEN,
  MIN_FRAME_SIZE,
  allowedScaleFactor,
  membersToRelease,
  minFrameSide,
  nextFrameName,
  ownerAfterManipulation,
  rectFromDrag,
} from '../model/frames.ts'
import type { Box } from '../model/frames.ts'
import { History } from '../model/history.ts'
import { canReorderLayered, reorderLayered } from '../model/layers.ts'
import type { LayerOp } from '../model/layers.ts'
import { DEFAULT_TITLE, DOC_VERSION } from '../model/types.ts'
import type { BoardDoc, FrameRecord, ImageRecord, SaveState, Scene, TextRecord, Viewport } from '../model/types.ts'
import { fitImageScale, fitViewport, screenToScene, zoomAround } from '../model/viewport.ts'
import type { Point, Rect } from '../model/viewport.ts'
import { Autosaver } from '../persistence/autosave.ts'
import { ABSENT } from '../persistence/boardStore.ts'
import type { BoardStore } from '../persistence/boardStore.ts'
import { hydrateBoard } from '../persistence/hydrate.ts'
import { isPanHoldKey, resolveShortcut } from '../input/shortcuts.ts'
import type { ShortcutAction } from '../input/shortcuts.ts'
import { AssetCache, isImageFile, readImageFile } from './assets.ts'
import { FrameCanvas } from './FrameCanvas.ts'
import type { AssetSource } from './assets.ts'
import {
  ACCENT,
  centerOf,
  createFrame,
  createObject,
  frameNameOf,
  hasResidualScale,
  idOf,
  isFrame,
  newId,
  normalizeTextScale,
  ownerOf,
  setFrameName,
  setOwner,
  toFrameRecord,
  toRecord,
} from './objects.ts'

export type Tool = 'select' | 'hand' | 'text' | 'frame'

export interface SelectionInfo {
  kind: 'image' | 'text' | 'frame' | 'multiple'
  count: number
  /** Only for a single text object. */
  fontSize: number | null
  /** Only for a single frame. */
  frameName: string | null
  /**
   * Only for a single frame: how many objects it owns. Ownership is not the same as
   * "what sits inside": an object the frame was moved over or drawn round is not owned.
   */
  memberCount: number | null
  layer: Record<LayerOp, boolean>
}

export interface Notice {
  id: number
  kind: 'error' | 'info'
  message: string
}

export interface EditorState {
  ready: boolean
  /**
   * Non-null when the board is shown read-only (it could not be loaded in full, so
   * nothing may be edited or saved). Holds the user-visible reason.
   */
  readOnly: string | null
  /** The read-only state is one that reloading gets out of (another tab changed the board). */
  reloadSuggested: boolean
  tool: Tool
  /** Hand tool is in effect (selected, or Space held). */
  handActive: boolean
  editingText: boolean
  selection: SelectionInfo | null
  viewport: Viewport
  objectCount: number
  canUndo: boolean
  canRedo: boolean
  save: SaveState
  title: string
  notice: Notice | null
}

/**
 * One pointer gesture on the canvas, from press to settlement. While it exists the
 * board is "busy": saves see `base` (the scene before the gesture), commands and
 * shortcuts are inert, and Esc or a window blur restores `base`.
 */
interface Gesture {
  /** Fresh per gesture, so a queued settlement can tell that it has been cancelled or replaced. */
  id: number
  kind: 'draft' | 'transform' | 'settling'
  base: Scene
  /** A press on an object: Fabric's own transform record, which identifies the gesture in Fabric's events. */
  transform?: Transform
  /** A drag: the unselected members of the frames being moved, which follow them. */
  carry?: Carry
  /** The Frame tool: the rectangle being drawn, in scene coordinates. */
  draft?: { start: Point; end: Point }
}

/**
 * Followers of a drag: content owned by a frame that is being moved, but which is not
 * itself in the moved selection. They follow moves only, exactly once, by the same delta.
 */
interface Carry {
  /** Where the dragged target started. */
  left: number
  top: number
  followers: Array<{ obj: FabricObject; left: number; top: number }>
}

/** A Frame-tool press that moves less than this many screen pixels is a click (default-sized frame). */
const DRAFT_CLICK_SLOP = 4
const NO_FRAMES: ReadonlySet<string> = new Set()

const ZOOM_STEP = 1.25
const MIN_SELECTION_FONT = MIN_FONT_SIZE
const ZOOM_ACTIONS: ReadonlySet<ShortcutAction> = new Set(['zoom-in', 'zoom-out', 'zoom-fit', 'zoom-reset'])
const EMPTY_SCENE: Scene = { frames: [], objects: [] }

/** Bit of `MouseEvent.buttons` for a `MouseEvent.button` (the two number the middle and right buttons differently). */
const buttonMask = (button: number): number => (button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 0)

/** Mouse events carry a button; touch events do not and count as the primary button. */
const isPrimary = (e: Event): boolean => {
  const button = (e as MouseEvent).button
  return button === undefined || button === 0
}

/**
 * Owns the Fabric canvas, history, assets and autosave. React never touches
 * Fabric objects: it renders `getState()` snapshots and calls the methods here.
 * Fabric is the live source of truth for objects; history stores serialized
 * snapshots (see model/) and restores them by rebuilding objects.
 *
 * Fabric event callbacks only record facts and queue one settlement. Nothing that
 * changes selection, objects or history runs inside a Fabric callback: settlement
 * runs in a microtask, after Fabric's own mouse-up handling has returned.
 */
export class Editor {
  private readonly canvas: FrameCanvas
  private readonly canvasEl: HTMLCanvasElement
  private readonly history = new History<Scene>(EMPTY_SCENE, { equals: sceneEqual })
  private readonly autosaver: Autosaver
  private readonly listeners = new Set<() => void>()
  private readonly cleanups: Array<() => void> = []
  private state: EditorState
  private applying = false
  private spaceHeld = false
  private disposed = false
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private noticeSeq = 0
  private gesture: Gesture | null = null
  private gestureSeq = 0
  /** Image batches that finished decoding while a gesture was in progress. */
  private stagedImports: ImageRecord[][] = []
  /** A primary-button press has been passed through to Fabric and not yet released. */
  private primaryDown = false
  private pan: { button: number; end: () => void } | null = null

  constructor(
    private readonly host: HTMLElement,
    private readonly store: BoardStore,
    private readonly assets: AssetSource = new AssetCache(),
  ) {
    this.canvasEl = document.createElement('canvas')
    host.appendChild(this.canvasEl)
    const { width, height } = host.getBoundingClientRect()
    this.canvas = new FrameCanvas(this.canvasEl, {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      preserveObjectStacking: true,
      stopContextMenu: true,
      // Only the primary button edits. Other buttons are also kept from Fabric at DOM level (bindDomEvents).
      fireRightClick: false,
      fireMiddleClick: false,
      // Every scale is proportional: no Shift free-scaling and no Shift skewing, which the document could not store.
      uniScaleKey: null,
      altActionKey: null,
      selectionColor: 'rgba(108, 123, 242, 0.08)',
      selectionBorderColor: ACCENT,
      selectionLineWidth: 1,
    })

    this.state = {
      ready: false,
      readOnly: null,
      reloadSuggested: false,
      tool: 'select',
      handActive: false,
      editingText: false,
      selection: null,
      viewport: { ...DEFAULT_VIEWPORT },
      objectCount: 0,
      canUndo: false,
      canRedo: false,
      save: { kind: 'loading' },
      title: DEFAULT_TITLE,
      notice: null,
    }

    this.autosaver = new Autosaver({
      store,
      getDoc: () => this.getDoc(),
      bytes: (id) => this.assets.bytes(id),
      onConflict: (message) => this.enterReadOnly(message, true),
      onStatus: (save) => {
        const failedNow = save.kind === 'error' && this.state.save.kind !== 'error'
        this.setState({ save })
        if (failedNow) this.notify('error', `Couldn’t save to this device: ${save.message}`)
      },
    })

    this.bindCanvasEvents()
    this.bindDomEvents()
    this.applyToolState()
  }

  // ---- external store for React -------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): EditorState => this.state

  private setState(patch: Partial<EditorState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  // ---- lifecycle ------------------------------------------------------------

  /** True once hydration has finished. Until then the board accepts no edits and nothing is saved. */
  private get live(): boolean {
    return this.state.ready && !this.disposed
  }

  /** Hydrated and not read-only: the only state in which the board may change. */
  private get editable(): boolean {
    return this.live && this.state.readOnly === null
  }

  /** A pointer gesture is in progress or being settled: commands and shortcuts wait. */
  private get busy(): boolean {
    return this.gesture !== null
  }

  async init(): Promise<void> {
    const outcome = await hydrateBoard(this.store, (asset) => this.assets.load(asset))
    if (this.disposed) return

    switch (outcome.kind) {
      case 'empty':
        this.autosaver.markLoaded(ABSENT)
        break
      case 'restored':
        this.showStoredBoard(outcome.doc) // ownership is restored exactly as stored, never recomputed
        this.autosaver.markLoaded(outcome.token)
        // Only after a complete, successful restore: drop bytes the stored board never referenced.
        // The store re-checks the token, so a prune that arrives after the board changed does nothing.
        void this.store.pruneAssets(referencedAssetIds(outcome.doc.objects), outcome.token).catch(() => {
          /* cleanup only; unreferenced bytes are harmless */
        })
        break
      case 'blocked':
        // Fail closed: show what could be shown, but never write or prune anything.
        if (outcome.partial) this.showStoredBoard(outcome.partial)
        this.enterReadOnly(outcome.message) // surfaced by a persistent banner
        break
    }
    this.history.reset(this.snapshot())
    this.setState({ ready: true })
    this.applyToolState()
    this.syncState()
  }

  /**
   * Makes the session read-only for good (a board that could not be loaded in full, or
   * one another tab has changed since this tab's last save). Nothing is written from
   * here on. An unfinished gesture is undone, images still being imported are dropped,
   * and any text being typed stays visible but is not committed.
   */
  private enterReadOnly(message: string, reloadSuggested = false) {
    if (this.disposed) return
    this.autosaver.disable(message)
    this.cancelGesture()
    this.setState({ readOnly: message, reloadSuggested, tool: 'hand' }) // not editable from here on, so leaving the edit below commits nothing
    this.dropStagedImports()
    this.finishEditing()
    this.canvas.discardActiveObject()
    this.applyToolState()
    this.syncState()
  }

  private showStoredBoard(doc: BoardDoc) {
    this.applyRecords(doc)
    this.setState({ title: doc.title })
    this.setViewport(doc.viewport, false)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.gesture = null // invalidates any queued settlement
    this.stagedImports = []
    this.pan?.end()
    for (const c of this.cleanups.splice(0)) c()
    this.autosaver.dispose()
    this.listeners.clear()
    this.assets.dispose()
    void this.canvas.dispose()
    this.host.replaceChildren()
  }

  // ---- document ---------------------------------------------------------------

  /** Everything on the canvas as records: frames and content, each back to front. */
  private snapshot(): Scene {
    const frames: FrameRecord[] = []
    const objects: Scene['objects'] = []
    for (const obj of this.canvas.getObjects()) {
      const frame = toFrameRecord(obj)
      if (frame) {
        frames.push(frame)
        continue
      }
      // A blank text is not content: it exists on the canvas only while it is being typed
      // into, and is discarded when that edit ends. Keeping it out of the scene means no
      // save (whatever triggered it: typing, a pan, a title edit) and no history step can
      // ever hold one.
      if (obj instanceof Textbox && obj.text.trim() === '') continue
      const rec = toRecord(obj)
      if (rec) objects.push(rec)
    }
    return { frames, objects }
  }

  /**
   * What a save should store right now. A save never sees an unfinished gesture: while
   * one exists the scene is the one from before it. Title and viewport are always live.
   */
  private getDoc(): BoardDoc {
    const scene = this.gesture ? this.gesture.base : this.snapshot()
    return { version: DOC_VERSION, title: this.state.title, frames: scene.frames, objects: scene.objects, viewport: this.getViewport() }
  }

  /**
   * Records the live board as a history step. A no-op when nothing changed: no history
   * entry and no save. Never changes ownership or anything else on the canvas.
   */
  private commit(coalesceKey?: string) {
    if (this.applying || !this.editable || this.gesture) return
    if (this.history.push(this.snapshot(), coalesceKey)) this.autosaver.markDirty()
    this.syncState()
  }

  /** Rebuilds the canvas from records (frames behind content), preserving selection by id. */
  private applyRecords(scene: Scene) {
    this.applying = true
    try {
      const selected = new Set(this.selectedIds())
      this.canvas.discardActiveObject()
      const existing = this.canvas.getObjects()
      if (existing.length) this.canvas.remove(...existing)
      const built: FabricObject[] = scene.frames.map((rec) => createFrame(rec))
      for (const rec of scene.objects) {
        if (rec.type === 'text' && rec.text.trim() === '') continue // an old board may still store a blank text: invisible, so not shown
        const obj = createObject(rec, (id) => this.assets.get(id))
        if (obj) built.push(obj)
      }
      if (built.length) this.canvas.add(...built)
      this.selectByIds(built.filter((o) => selected.has(idOf(o) ?? '')))
    } finally {
      this.applying = false
    }
    this.canvas.requestRenderAll()
  }

  private selectByIds(objs: FabricObject[]) {
    if (objs.length === 0) return
    if (objs.length === 1) this.canvas.setActiveObject(objs[0] as FabricObject)
    else this.canvas.setActiveObject(new ActiveSelection(objs, { canvas: this.canvas }))
  }

  private selectedIds(): string[] {
    return this.canvas
      .getActiveObjects()
      .map(idOf)
      .filter((id): id is string => id !== undefined)
  }

  /** Every frame as a record, back to front. */
  private frameRecords(): FrameRecord[] {
    const out: FrameRecord[] = []
    for (const o of this.canvas.getObjects()) {
      const rec = toFrameRecord(o)
      if (rec) out.push(rec)
    }
    return out
  }

  /** Rule O4: content that has just been created belongs to the front-most frame its centre is inside. */
  private ownerForNew(obj: FabricObject): string | undefined {
    return ownerAfterManipulation(undefined, centerOf(obj), this.frameRecords(), NO_FRAMES)
  }

  /** Canvas ids split into the two z-bands, each back to front. */
  private layeredOrder(): { frames: string[]; objects: string[] } {
    const frames: string[] = []
    const objects: string[] = []
    for (const o of this.canvas.getObjects()) (isFrame(o) ? frames : objects).push(idOf(o) ?? '')
    return { frames, objects }
  }

  // ---- state derived from the canvas -----------------------------------------

  private computeSelection(): SelectionInfo | null {
    const objs = this.canvas.getActiveObjects()
    if (objs.length === 0) return null
    const ids = new Set(this.selectedIds())
    const order = this.layeredOrder()
    const first = objs[0]
    const single = objs.length === 1 ? first : undefined
    const frame = single && isFrame(single) ? single : undefined
    const frameId = frame ? idOf(frame) : undefined
    return {
      kind: objs.length > 1 ? 'multiple' : frame ? 'frame' : single instanceof Textbox ? 'text' : 'image',
      count: objs.length,
      fontSize: single instanceof Textbox ? Math.max(MIN_SELECTION_FONT, Math.round(single.fontSize * 10) / 10) : null,
      frameName: frame ? (frameNameOf(frame) ?? '') : null,
      memberCount: frame ? this.canvas.getObjects().filter((o) => ownerOf(o) === frameId).length : null,
      layer: {
        front: canReorderLayered(order, ids, 'front'),
        forward: canReorderLayered(order, ids, 'forward'),
        backward: canReorderLayered(order, ids, 'backward'),
        back: canReorderLayered(order, ids, 'back'),
      },
    }
  }

  private syncState() {
    const active = this.canvas.getActiveObject()
    this.setState({
      selection: this.computeSelection(),
      objectCount: this.canvas.getObjects().length,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      editingText: active instanceof Textbox && active.isEditing === true,
    })
  }

  // ---- canvas events -----------------------------------------------------------

  private bindCanvasEvents() {
    const c = this.canvas
    const onSelection = () => {
      const active = c.getActiveObject()
      if (active instanceof ActiveSelection) {
        // Frames have no angle, so a selection that contains one cannot be rotated. A
        // content-only selection can. (Set both ways: Shift-click changes a selection in place.)
        const hasFrame = active.getObjects().some(isFrame)
        active.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, mtr: !hasFrame })
        active.set({
          borderColor: ACCENT,
          cornerColor: '#ffffff',
          cornerStrokeColor: ACCENT,
          cornerStyle: 'rect',
          cornerSize: 9,
          transparentCorners: false,
          borderScaleFactor: 1.5,
          lockScalingFlip: true,
          lockRotation: hasFrame,
        })
      }
      // A selection that already was rotated when a frame joined it (Shift-click) would keep
      // its turned box, with rotation now locked. Re-form it upright; nothing on the board
      // moves, the members keep their own angles. After Fabric's own handling has returned.
      if (active instanceof ActiveSelection && active.angle !== 0 && active.getObjects().some(isFrame)) {
        queueMicrotask(() => {
          if (this.disposed || this.gesture || c.getActiveObject() !== active || c._currentTransform) return
          const members = active.getObjects().slice()
          c.discardActiveObject()
          this.selectByIds(members)
          c.requestRenderAll()
        })
      }
      // A frame on its own is a container and resizes freely; everything else, including any
      // multi-selection, scales proportionally.
      c.uniformScaling = !(!!active && !(active instanceof ActiveSelection) && isFrame(active))
      this.syncState()
    }
    c.on('selection:created', onSelection)
    c.on('selection:updated', onSelection)
    c.on('selection:cleared', onSelection)

    // A press on an object (Fabric fires this for every such press, moved or not).
    c.on('before:transform', ({ transform }) => {
      if (!this.editable) return
      const target = transform.target
      // Caret and text-selection presses inside an editing textbox stay on the text path.
      if (target instanceof Textbox && target.isEditing) return
      const g: Gesture = { id: ++this.gestureSeq, kind: 'transform', base: this.snapshot(), transform }
      if (transform.action === 'drag') g.carry = this.collectFollowers(target)
      this.gesture = g
    })

    // Members of a moved frame that are not themselves selected follow it, by the same delta.
    c.on('object:moving', ({ transform }) => {
      const g = this.gesture
      if (g?.kind === 'transform' && g.carry && g.transform === transform) this.placeFollowers(g.carry, transform.target)
    })

    // The Frame tool: a primary press starts drawing a frame. Only facts are recorded here.
    c.on('mouse:down', (opt) => {
      if (!this.editable || this.state.tool !== 'frame' || this.state.handActive || !isPrimary(opt.e)) return
      const p = c.getScenePoint(opt.e)
      const start = { x: p.x, y: p.y }
      this.gesture = { id: ++this.gestureSeq, kind: 'draft', base: this.snapshot(), draft: { start, end: start } }
    })
    c.on('mouse:move', (opt) => {
      const g = this.gesture
      if (g?.kind !== 'draft' || !g.draft) return
      const p = c.getScenePoint(opt.e)
      g.draft.end = { x: p.x, y: p.y }
      c.draft = rectFromDrag(g.draft.start, g.draft.end) // drawing only; nothing on the board changes
      c.requestRenderAll()
    })

    c.on('object:modified', ({ target, transform }) => {
      if (this.applying || !this.editable) return
      const g = this.gesture
      if (g) {
        // Only the release of this gesture's own transform settles it, and only once.
        if (transform !== undefined && transform === g.transform && g.kind === 'transform') {
          g.kind = 'settling'
          const id = g.id
          queueMicrotask(() => this.settle(id))
        }
        return
      }
      // No gesture: a text left its edit with changes, or an editing textbox was resized by
      // a handle. (Fabric 7.4 hides an editing textbox's handles, so the second case is not
      // reachable today; the limit is applied anyway so that it can never bypass it.)
      if (target instanceof Textbox) {
        if (transform && isScaleAction(transform)) this.limitScale(transform, [], [{ fontSize: target.fontSize }])
        normalizeTextScale(target)
      }
      this.commit()
    })

    c.on('text:editing:entered', () => this.syncState())
    c.on('text:changed', () => {
      if (!this.applying && this.editable) this.autosaver.markDirty() // keep typing durable; history commits on exit
    })
    c.on('text:editing:exited', ({ target }) => {
      // A press inside the text may still be held (it started no gesture, and the text could
      // not move while it was being edited). End it, or the text would now be dragged with
      // no gesture: visible to saves half-way and impossible to cancel.
      if (c._currentTransform?.target === target) c.endCurrentTransform()
      if (this.applying || !this.editable) return
      if (target instanceof Textbox && target.text.trim() === '') {
        // A blank text is discarded. It is already out of the scene (see snapshot), so the
        // commit below records its removal now. The object itself is taken off the canvas
        // only after Fabric has finished leaving the edit: Fabric still fires events on the
        // text after this callback, and they fail on a text that has no canvas any more.
        queueMicrotask(() => {
          if (this.disposed || target.isEditing || target.text.trim() !== '' || !c.getObjects().includes(target)) return
          // Shift-clicking another object leaves the edit AND puts this text into a new
          // multi-selection. Take it out again, or the selection would keep a member that is
          // no longer on the canvas.
          const active = c.getActiveObject()
          if (active instanceof ActiveSelection && active.getObjects().includes(target) && !c._currentTransform) {
            const rest = active.getObjects().filter((o) => o !== target)
            c.discardActiveObject()
            c.remove(target)
            this.selectByIds(rest)
          } else {
            c.remove(target)
          }
          c.requestRenderAll()
          this.syncState()
        })
      } else if (target instanceof Textbox && !this.history.current.objects.some((o) => o.id === idOf(target))) {
        // A NEW text (history has never held it): its box grew while it was typed, so its
        // owner is decided once more from where it ended up. Re-editing an existing text
        // never changes its owner, whatever the typing does to its size.
        setOwner(target, ownerAfterManipulation(ownerOf(target), centerOf(target), this.frameRecords(), NO_FRAMES))
      }
      this.commit()
    })

    // Double-clicking a frame's label (or outline) is "rename": the UI puts the cursor in the
    // name field. Deferred, like everything else that follows from a canvas event.
    c.on('mouse:dblclick', (opt) => {
      const target = opt.target
      if (!this.editable || this.busy || !target || !isFrame(target)) return
      queueMicrotask(() => {
        if (this.editable && !this.busy && c.getActiveObject() === target) this.frameRenamer?.()
      })
    })

    c.on('mouse:up', (opt) => {
      if (!isPrimary(opt.e)) return // other buttons never start, finish or clear anything
      const g = this.gesture
      if (g?.kind === 'transform') {
        // A press that never moved: Fabric fired no `object:modified`. Nothing changed, so
        // nothing is normalized, reconciled, recorded or saved.
        this.gesture = null
      } else if (g?.kind === 'draft' && g.draft) {
        const end = c.getScenePoint(opt.e)
        g.draft.end = { x: end.x, y: end.y }
        g.kind = 'settling'
        const id = g.id
        queueMicrotask(() => this.settle(id))
      }
      if (this.editable && !this.gesture && this.state.tool === 'text' && !this.state.handActive && !opt.target && opt.isClick) {
        const p = c.getScenePoint(opt.e)
        const at = { x: p.x, y: p.y }
        queueMicrotask(() => {
          if (this.editable && !this.gesture && this.state.tool === 'text') this.addTextAt(at, 'top-left')
        })
      }
      this.queueIdle()
    })
  }

  // ---- gestures ----------------------------------------------------------------------

  /**
   * Finishes a performed gesture. Runs in a microtask queued from `object:modified` (or
   * from the release that ends a frame draft), i.e. after Fabric has finished its own
   * mouse-up handling, so dissolving and re-forming a selection here cannot re-enter
   * Fabric's transform finalization.
   */
  private settle(id: number) {
    const g = this.gesture
    if (!g || g.id !== id) return // cancelled or replaced since it was queued
    if (!this.editable) {
      this.gesture = null
      return
    }
    try {
      if (g.draft) this.settleDraft(g.draft)
      else if (g.transform) this.settleTransform(g, g.transform)
    } finally {
      // Whatever happened, the gesture is over: the board must never stay busy.
      this.gesture = null
      this.canvas.requestRenderAll()
      this.commit()
      this.idle()
    }
  }

  /** The Frame tool's release: one new frame, selected, and back to the Select tool. A new frame owns nothing (rule O5). */
  private settleDraft(draft: { start: Point; end: Point }) {
    this.canvas.draft = null
    const { start, end } = draft
    const zoom = this.getViewport().zoom
    const dragged = Math.hypot(end.x - start.x, end.y - start.y) * zoom >= DRAFT_CLICK_SLOP
    let box: Box
    if (dragged) {
      // At least the minimum size, growing away from the press point in the drag's direction.
      const width = Math.max(Math.abs(end.x - start.x), MIN_FRAME_SIZE)
      const height = Math.max(Math.abs(end.y - start.y), MIN_FRAME_SIZE)
      box = { left: end.x < start.x ? start.x - width : start.x, top: end.y < start.y ? start.y - height : start.y, width, height }
    } else {
      // A plain click: a default frame of a fixed size on screen, its corner at the click.
      box = { left: start.x, top: start.y, width: DEFAULT_FRAME_SCREEN.width / zoom, height: DEFAULT_FRAME_SCREEN.height / zoom }
    }
    this.switchTool('select') // the tool is single-use
    this.insertFrame(box)
  }

  /** Adds a frame in front of every other frame and behind all content, and selects it. */
  private insertFrame(box: Box): FabricObject {
    const frames = this.frameRecords()
    const obj = createFrame({
      id: newId(),
      name: nextFrameName(frames.map((f) => f.name)),
      left: round(box.left),
      top: round(box.top),
      width: roundPositive(box.width),
      height: roundPositive(box.height),
    })
    this.canvas.insertAt(frames.length, obj)
    this.canvas.discardActiveObject()
    this.canvas.setActiveObject(obj)
    this.canvas.requestRenderAll()
    return obj
  }

  /** A performed transform: followers, the scale limit with folding and baking, then ownership. */
  private settleTransform(g: Gesture, transform: Transform) {
    const target = transform.target
    // Taken before anything is dissolved: these objects are "the transformed set".
    const members = target instanceof ActiveSelection ? target.getObjects().slice() : [target]
    if (g.carry) this.placeFollowers(g.carry, target)
    this.settleScale(g.base, transform, members)
    this.applyOwnership(g.base, members)
  }

  /** Unselected members of the frames being dragged, with where they and the target started. */
  private collectFollowers(target: FabricObject): Carry {
    const moved = new Set<FabricObject>(target instanceof ActiveSelection ? target.getObjects() : [target])
    const movedFrames = new Set<string>()
    for (const o of moved) if (isFrame(o)) movedFrames.add(idOf(o) ?? '')
    const followers: Carry['followers'] = []
    if (movedFrames.size > 0) {
      for (const o of this.canvas.getObjects()) {
        const owner = ownerOf(o)
        // A selected member moves through the selection; carrying it too would move it twice.
        if (owner !== undefined && movedFrames.has(owner) && !moved.has(o)) followers.push({ obj: o, left: o.left, top: o.top })
      }
    }
    return { left: target.left, top: target.top, followers }
  }

  private placeFollowers(carry: Carry, target: FabricObject) {
    const dx = target.left - carry.left
    const dy = target.top - carry.top
    for (const f of carry.followers) {
      f.obj.set({ left: f.left + dx, top: f.top + dy })
      f.obj.setCoords()
    }
  }

  /**
   * Ownership follows what the user manipulated. Evaluated from final scene-space centres
   * and frame rectangles, and only when the gesture changed something.
   *  - O1, content in the transformed set: keeps an owner that was transformed with it;
   *    else keeps an owner that still contains it; else joins the front-most frame that
   *    contains it and was NOT transformed in this gesture, or becomes loose.
   *  - O3, a frame in the transformed set whose size changed: members it no longer contains
   *    (and that were not transformed with it) become loose. They are never transferred.
   * A frame never gains a member by being moved, resized or drawn. Followers and
   * everything stationary keep their owner.
   */
  private applyOwnership(base: Scene, members: readonly FabricObject[]) {
    const now = this.snapshot()
    if (sceneEqual(now, base)) return
    const transformed = new Set(members)
    const coTransformed = new Set<string>()
    for (const m of members) if (isFrame(m)) coTransformed.add(idOf(m) ?? '')

    for (const m of members) {
      if (!isFrame(m)) setOwner(m, ownerAfterManipulation(ownerOf(m), centerOf(m), now.frames, coTransformed))
    }
    for (const id of coTransformed) {
      const before = base.frames.find((f) => f.id === id)
      const after = now.frames.find((f) => f.id === id)
      if (!before || !after || (before.width === after.width && before.height === after.height)) continue
      const rest = this.canvas.getObjects().filter((o) => ownerOf(o) === id && !transformed.has(o))
      const released = new Set(membersToRelease(after, rest.map((o) => ({ id: idOf(o) ?? '', centre: centerOf(o) }))))
      for (const o of rest) if (released.has(idOf(o) ?? '')) setOwner(o, undefined)
    }
  }

  /**
   * A proportional scale is limited by one common factor for everything it transforms,
   * computed from pre-gesture values, and only then folded into the members. Folding
   * and baking apply no further limit, so proportions are exact. A frame resized on its
   * own is not proportional and is limited per axis instead.
   */
  private settleScale(base: Scene, transform: Transform, members: readonly FabricObject[]) {
    if (!isScaleAction(transform)) return
    const target = transform.target
    if (!(target instanceof ActiveSelection) && isFrame(target)) {
      this.bakeFrameAlone(base, transform)
      return
    }
    const baseTexts: Array<{ fontSize: number }> = []
    const baseFrames: FrameRecord[] = []
    for (const m of members) {
      const id = idOf(m)
      if (isFrame(m)) {
        const rec = base.frames.find((f) => f.id === id)
        if (rec) baseFrames.push(rec)
      } else if (m instanceof Textbox) {
        const rec = base.objects.find((o) => o.id === id)
        if (rec?.type === 'text') baseTexts.push({ fontSize: rec.fontSize })
      }
    }
    this.limitScale(transform, baseFrames, baseTexts)

    if (target instanceof ActiveSelection) {
      // Judged per member, on its absolute scale: a selection that returns to scale 1 can
      // still leave a member scaled (one that joined while the selection was scaled).
      if (members.some((o) => (o instanceof Textbox || isFrame(o)) && hasResidualScale(o))) {
        // Fold the scale into member text (font size/width) and bake it into member frames
        // (which are stored at scale 1), which means dissolving and re-forming the selection.
        const keep = members.slice()
        this.canvas.discardActiveObject()
        for (const o of keep) {
          if (o instanceof Textbox) normalizeTextScale(o)
          else if (isFrame(o)) bakeFrame(o)
        }
        this.selectByIds(keep)
      }
    } else if (target instanceof Textbox) {
      normalizeTextScale(target)
    }
  }

  /**
   * A frame resized on its own: its scale becomes its size. Each side may not go below
   * the minimum, or below its own pre-gesture length if that was already smaller (it may
   * grow, and is never snapped up). The edge opposite the dragged handle stays fixed.
   */
  private bakeFrameAlone(base: Scene, transform: Transform) {
    const frame = transform.target
    const before = base.frames.find((f) => f.id === idOf(frame))
    const anchor = frame.translateToOriginPoint(frame.getCenterPoint(), transform.originX, transform.originY)
    let width = frame.width * Math.abs(frame.scaleX)
    let height = frame.height * Math.abs(frame.scaleY)
    if (before) {
      width = Math.max(width, minFrameSide(before.width))
      height = Math.max(height, minFrameSide(before.height))
    }
    frame.set({ width: roundPositive(width), height: roundPositive(height), scaleX: 1, scaleY: 1 })
    frame.setPositionByOrigin(anchor, transform.originX, transform.originY)
    frame.setCoords()
  }

  /**
   * Replaces the requested scale factor of a finished scale gesture by the allowed one,
   * keeping the gesture's own anchor (the corner opposite the dragged handle) fixed.
   */
  private limitScale(transform: Transform, baseFrames: readonly FrameRecord[], baseTexts: ReadonlyArray<{ fontSize: number }>) {
    const target = transform.target
    const original = transform.original
    if (!original.scaleX || !original.scaleY) return
    const requested = target.scaleX / original.scaleX
    const allowed = allowedScaleFactor(requested, baseFrames, baseTexts)
    if (Math.abs(allowed - requested) <= 1e-9) return
    const anchor = target.translateToOriginPoint(target.getCenterPoint(), transform.originX, transform.originY)
    target.set({ scaleX: original.scaleX * allowed, scaleY: original.scaleY * allowed })
    target.setPositionByOrigin(anchor, transform.originX, transform.originY)
    target.setCoords()
  }

  /**
   * Abandons the gesture in progress (Esc, window blur, going read-only) and restores
   * the board from before it. No history entry and no save. Returns false when there
   * was nothing to cancel.
   */
  private cancelGesture(): boolean {
    const g = this.gesture
    if (!g) return false
    if (g.draft) {
      // Nothing on the board has changed yet: just drop the rectangle being drawn.
      this.gesture = null
      this.canvas.draft = null
      this.canvas.requestRenderAll()
      return true
    }
    this.applying = true // Fabric may fire `object:modified` while its transform is ended; it must not settle
    try {
      if (g.transform && this.canvas._currentTransform === g.transform) this.canvas.endCurrentTransform()
    } finally {
      this.applying = false
    }
    this.applyRecords(g.base)
    this.gesture = null // also invalidates a queued settlement
    this.syncState()
    return true
  }

  private queueIdle() {
    queueMicrotask(() => this.idle())
  }

  /** The board is at rest: apply what had to wait for a gesture to end. */
  private idle() {
    if (this.gesture || !this.editable || this.stagedImports.length === 0) return
    for (const batch of this.stagedImports.splice(0)) this.applyImport(batch)
  }

  private dropStagedImports() {
    const dropped = this.stagedImports.reduce((n, batch) => n + batch.length, 0)
    this.stagedImports = []
    if (dropped > 0) this.notify('error', `${dropped} image${dropped === 1 ? ' was' : 's were'} not added because the board became read-only.`)
  }

  private bindDomEvents() {
    const wrapper = this.canvas.wrapperEl
    const listen = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, opts)
      this.cleanups.push(() => el.removeEventListener(type, fn, opts))
    }

    // Runs before Fabric (capture phase): decides which presses Fabric may see at all.
    listen(
      wrapper,
      'mousedown',
      (e) => {
        if (!this.live) {
          // Still hydrating: the board is inert.
          e.preventDefault()
          e.stopPropagation()
          return
        }
        this.healPrimaryDown(e)
        if (e.button !== 0) {
          // Fabric must never observe a non-primary button: its handlers would drop the
          // document listeners of a primary drag that is still in progress.
          e.preventDefault()
          e.stopPropagation()
          if (e.button === 1 && !this.primaryDown) {
            this.finishEditing()
            this.beginPan(e)
          }
          return
        }
        if (this.state.handActive) {
          e.preventDefault()
          e.stopPropagation()
          this.finishEditing()
          this.beginPan(e)
          return
        }
        this.primaryDown = true
      },
      { capture: true },
    )

    // One permanent release listener. Capture on window runs before Fabric's own
    // (bubble-phase, document) listener, so it can keep non-primary releases from it.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.primaryDown = false
        if (this.pan?.button === 0) this.pan.end()
        return // Fabric finishes its drag with this event
      }
      if (this.pan?.button === e.button) this.pan.end()
      this.healPrimaryDown(e)
      // A primary drag is in progress: this release is not Fabric's business, and letting
      // it through would end Fabric's tracking of the drag.
      if (this.primaryDown) e.stopPropagation()
    }
    // A native drag (e.g. dragging selected text) ends with `dragend` and no `mouseup` at all.
    const onDragEnd = () => {
      this.primaryDown = false
    }
    window.addEventListener('mouseup', onMouseUp, { capture: true })
    window.addEventListener('dragend', onDragEnd, { capture: true })
    this.cleanups.push(() => {
      window.removeEventListener('mouseup', onMouseUp, { capture: true })
      window.removeEventListener('dragend', onDragEnd, { capture: true })
    })

    listen(
      wrapper,
      'wheel',
      (e) => {
        e.preventDefault()
        if (!this.live) return
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.host.clientHeight : 1
        if (e.ctrlKey || e.metaKey) {
          const rect = this.host.getBoundingClientRect()
          const at = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          this.setViewport(zoomAround(this.getViewport(), at, this.getViewport().zoom * Math.exp((-e.deltaY * unit) / 300)))
        } else {
          const vp = this.getViewport()
          const dx = (e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX) * unit
          const dy = (e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY) * unit
          this.setViewport({ ...vp, panX: vp.panX - dx, panY: vp.panY - dy })
        }
      },
      { passive: false },
    )

    const ro = new ResizeObserver(() => {
      const { width, height } = this.host.getBoundingClientRect()
      if (width > 0 && height > 0) {
        this.canvas.setDimensions({ width: Math.floor(width), height: Math.floor(height) })
        this.canvas.requestRenderAll()
      }
    })
    ro.observe(this.host)
    this.cleanups.push(() => ro.disconnect())

    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e)
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && this.spaceHeld) {
        this.spaceHeld = false
        this.applyToolState()
      }
    }
    const onBlur = () => {
      if (this.spaceHeld) {
        this.spaceHeld = false
        this.applyToolState()
      }
      // The release of whatever was held may never arrive: undo the unfinished gesture.
      this.pan?.end()
      if (this.cancelGesture()) this.queueIdle()
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') void this.autosaver.flush()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (this.autosaver.hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    this.cleanups.push(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    })
  }

  /**
   * The primary release can be lost (it went to another window, or a native drag ended
   * without one). Every later mouse event says which buttons are really held, so the flag
   * corrects itself instead of swallowing non-primary releases indefinitely.
   */
  private healPrimaryDown(e: MouseEvent) {
    if (this.primaryDown && (e.buttons & 1) === 0) this.primaryDown = false
  }

  /**
   * Starts a pan owned by the button that started it. That button's release ends it (or a
   * blur, or a move that shows the button is no longer held, in case the release was lost).
   */
  private beginPan(start: MouseEvent) {
    this.pan?.end()
    let last = { x: start.clientX, y: start.clientY }
    const held = buttonMask(start.button)
    this.canvas.upperCanvasEl.style.cursor = 'grabbing'
    const move = (e: MouseEvent) => {
      if ((e.buttons & held) === 0) {
        end()
        return
      }
      const vp = this.getViewport()
      this.setViewport({ ...vp, panX: vp.panX + (e.clientX - last.x), panY: vp.panY + (e.clientY - last.y) })
      last = { x: e.clientX, y: e.clientY }
    }
    const end = () => {
      window.removeEventListener('mousemove', move)
      this.canvas.upperCanvasEl.style.cursor = ''
      this.pan = null
    }
    window.addEventListener('mousemove', move)
    this.pan = { button: start.button, end }
  }

  handleKeyDown(e: KeyboardEvent) {
    if (!this.live) return
    const ctx = { editingText: this.state.editingText }
    if (this.busy) {
      // Mid-gesture: Esc cancels it, zoom still works, everything else waits.
      const action = resolveShortcut(e, ctx)
      if (action === 'escape') {
        e.preventDefault()
        const drawing = this.gesture?.draft !== undefined
        this.cancelGesture()
        if (drawing) this.switchTool('select') // Esc while drawing a frame also leaves the Frame tool
        this.queueIdle()
      } else if (action && ZOOM_ACTIONS.has(action)) {
        e.preventDefault()
        this.run(action)
      }
      return
    }
    if (isPanHoldKey(e, ctx)) {
      e.preventDefault()
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.applyToolState()
      }
      return
    }
    const action = resolveShortcut(e, ctx)
    if (!action) return
    e.preventDefault()
    this.run(action)
  }

  /** Single dispatch point for shortcuts; UI buttons call the methods directly. */
  run(action: ShortcutAction) {
    switch (action) {
      case 'undo':
        return this.undo()
      case 'redo':
        return this.redo()
      case 'delete':
        return this.deleteSelection()
      case 'select-all':
        return this.selectAll()
      case 'tool-select':
        return this.setTool('select')
      case 'tool-hand':
        return this.setTool('hand')
      case 'tool-text':
        return this.setTool('text')
      case 'tool-frame':
        return this.setTool('frame')
      case 'add-image':
        return this.editable && !this.busy ? this.imagePicker?.() : undefined
      case 'zoom-in':
        return this.zoomBy(ZOOM_STEP)
      case 'zoom-out':
        return this.zoomBy(1 / ZOOM_STEP)
      case 'zoom-fit':
        return this.fit()
      case 'zoom-reset':
        return this.resetZoom()
      case 'layer-forward':
        return this.arrange('forward')
      case 'layer-backward':
        return this.arrange('backward')
      case 'layer-front':
        return this.arrange('front')
      case 'layer-back':
        return this.arrange('back')
      case 'escape':
        if (this.busy) return
        if (this.state.tool !== 'select') this.setTool('select')
        else {
          this.canvas.discardActiveObject()
          this.canvas.requestRenderAll()
        }
    }
  }

  private imagePicker: (() => void) | null = null

  /** The UI registers the file picker it owns so the `i` shortcut can open it. */
  setImagePicker(open: (() => void) | null) {
    this.imagePicker = open
  }

  private frameRenamer: (() => void) | null = null

  /** The UI registers how to put the cursor in the selected frame's name field (double-click on a label). */
  setFrameRenamer(focus: (() => void) | null) {
    this.frameRenamer = focus
  }

  // ---- tools ----------------------------------------------------------------------

  setTool(tool: Tool) {
    if (!this.live || this.busy) return
    this.switchTool(tool)
  }

  /** Unguarded tool change, for the editor's own use (it never runs while a gesture is unsettled). */
  private switchTool(tool: Tool) {
    if (tool !== 'hand' && !this.editable) tool = 'hand' // read-only boards can only be panned and zoomed
    this.finishEditing()
    this.setState({ tool })
    this.applyToolState()
  }

  private applyToolState() {
    const { tool } = this.state
    const hand = tool === 'hand' || this.spaceHeld
    const editable = this.state.ready && this.state.readOnly === null
    this.canvas.selection = editable && tool === 'select' && !hand
    // The Frame tool draws over whatever is there: it must not grab or select anything.
    this.canvas.skipTargetFind = hand || !editable || tool === 'frame'
    this.canvas.defaultCursor = hand ? 'grab' : tool === 'text' ? 'text' : tool === 'frame' ? 'crosshair' : 'default'
    this.canvas.hoverCursor = hand ? 'grab' : tool === 'text' ? 'text' : tool === 'frame' ? 'crosshair' : 'move'
    this.canvas.requestRenderAll()
    this.setState({ handActive: hand })
  }

  private finishEditing() {
    const active = this.canvas.getActiveObject()
    if (active instanceof Textbox && active.isEditing) active.exitEditing()
  }

  // ---- adding content ----------------------------------------------------------------

  private viewCenterScene(): Point {
    return screenToScene(this.getViewport(), { x: this.canvas.getWidth() / 2, y: this.canvas.getHeight() / 2 })
  }

  addText() {
    if (!this.editable || this.busy) return
    this.addTextAt(this.viewCenterScene(), 'center')
  }

  private addTextAt(at: Point, anchor: 'center' | 'top-left') {
    if (!this.editable || this.busy) return
    // Placement is single-use. Switch tools first: switching ends any editing.
    if (this.state.tool !== 'select') this.switchTool('select')
    this.finishEditing()
    const zoom = this.getViewport().zoom
    const fontSize = Math.round(clamp(24 / zoom, 12, 160))
    const width = fontSize * 10
    const rec: TextRecord = {
      id: newId(),
      type: 'text',
      text: '',
      fontSize,
      width,
      angle: 0,
      left: anchor === 'center' ? at.x - width / 2 : at.x,
      top: anchor === 'center' ? at.y - fontSize * 0.625 : at.y,
    }
    const obj = createObject(rec, () => undefined)
    if (!(obj instanceof Textbox)) return
    this.canvas.add(obj)
    // Owner first, in the same step that adds it: typing is saved as it happens, so no
    // save may ever see this text without its owner. (Touches no history.)
    setOwner(obj, this.ownerForNew(obj))
    this.canvas.setActiveObject(obj)
    obj.enterEditing()
    this.canvas.requestRenderAll()
    this.syncState()
  }

  /**
   * Decodes the files into image records without touching the canvas, then adds them:
   * at once when the board is at rest, otherwise as soon as the gesture in progress
   * has settled. `at` is in client (screen) coordinates, e.g. a drop position.
   */
  async addImageFiles(files: readonly File[], at?: { clientX: number; clientY: number }) {
    if (!this.editable) {
      if (this.live) this.notify('error', `This board is read-only. ${this.state.readOnly ?? ''}`.trim())
      else if (!this.disposed) this.notify('info', 'The board is still loading. Try again in a moment.')
      return
    }
    const images = files.filter(isImageFile)
    const skipped = files.length - images.length
    const failed: string[] = []
    const prepared: ImageRecord[] = []
    const rect = this.host.getBoundingClientRect()
    const zoom = this.getViewport().zoom
    const center = at ? screenToScene(this.getViewport(), { x: at.clientX - rect.left, y: at.clientY - rect.top }) : this.viewCenterScene()
    const maxSide = 480 / zoom

    for (const file of images) {
      try {
        const asset = await readImageFile(file)
        const el = await this.assets.load(asset) // the cache keeps the bytes; the save stores any that are not stored yet
        if (this.disposed) return
        const scale = fitImageScale(el.naturalWidth, el.naturalHeight, maxSide)
        const offset = prepared.length * (24 / zoom)
        prepared.push({
          id: newId(),
          type: 'image',
          assetId: asset.id,
          angle: 0,
          scaleX: scale,
          scaleY: scale,
          left: center.x - (el.naturalWidth * scale) / 2 + offset,
          top: center.y - (el.naturalHeight * scale) / 2 + offset,
        })
      } catch {
        failed.push(file.name || 'image')
      }
    }
    if (this.disposed) return

    if (prepared.length > 0) {
      if (!this.editable) {
        // The board became read-only while the files were being read.
        this.stagedImports.push(prepared)
        this.dropStagedImports()
      } else if (this.busy) {
        this.stagedImports.push(prepared) // applied by idle() once the gesture has settled
      } else {
        this.applyImport(prepared)
      }
    }
    const problems: string[] = []
    if (skipped > 0) problems.push(`${skipped} file${skipped === 1 ? ' is' : 's are'} not an image`)
    if (failed.length > 0) problems.push(`could not read ${failed.join(', ')}`)
    if (problems.length > 0) {
      const text = problems.join('; ')
      this.notify('error', `${text.charAt(0).toUpperCase()}${text.slice(1)}.`)
    }
  }

  /** Adds one imported batch as its own history step. Never called from a Fabric callback. */
  private applyImport(records: readonly ImageRecord[]) {
    if (!this.editable || this.busy) return
    this.finishEditing() // first, so that text being typed is committed as its own step
    const added: FabricObject[] = []
    for (const rec of records) {
      const obj = createObject(rec, (id) => this.assets.get(id))
      if (!obj) continue
      this.canvas.add(obj)
      setOwner(obj, this.ownerForNew(obj)) // same synchronous step as the add and the commit
      added.push(obj)
    }
    if (added.length === 0) return
    this.canvas.discardActiveObject()
    this.selectByIds(added.slice(-1))
    this.canvas.requestRenderAll()
    this.commit()
  }

  // ---- editing ----------------------------------------------------------------------------

  /** Adds a default-sized frame in the middle of the view (the Frame tool draws one instead). */
  addFrame() {
    if (!this.editable || this.busy) return
    this.finishEditing()
    if (this.state.tool !== 'select') this.switchTool('select')
    const zoom = this.getViewport().zoom
    const width = DEFAULT_FRAME_SCREEN.width / zoom
    const height = DEFAULT_FRAME_SCREEN.height / zoom
    const centre = this.viewCenterScene()
    this.insertFrame({ left: centre.x - width / 2, top: centre.y - height / 2, width, height })
    this.commit()
  }

  /** Renames the selected frame. Returns the name actually set, or null when no single frame is selected. */
  renameFrame(raw: string): string | null {
    if (!this.editable || this.busy) return null
    const active = this.canvas.getActiveObject()
    if (!active || active instanceof ActiveSelection || !isFrame(active)) return null
    const name = normalizeFrameName(raw)
    if (name === frameNameOf(active)) return name
    setFrameName(active, name)
    this.canvas.requestRenderAll()
    this.commit(`frame-name:${idOf(active) ?? ''}`)
    return name
  }

  /**
   * Replaces the selection by the selected frames plus everything they own, so that
   * frame and contents can be moved or scaled together as one multi-selection. Changes
   * nothing on the board and records no history.
   */
  selectFrameContents() {
    if (!this.editable || this.busy) return
    const frames = new Set<string>()
    for (const o of this.canvas.getActiveObjects()) if (isFrame(o)) frames.add(idOf(o) ?? '')
    if (frames.size === 0) return
    this.finishEditing()
    const objs = this.canvas.getObjects().filter((o) => frames.has(idOf(o) ?? '') || frames.has(ownerOf(o) ?? '\u0000'))
    this.canvas.discardActiveObject()
    this.selectByIds(objs)
    this.canvas.requestRenderAll()
  }

  deleteSelection() {
    if (!this.editable || this.busy) return
    this.finishEditing()
    const objs = this.canvas.getActiveObjects()
    if (objs.length === 0) return
    // Deleting a frame keeps its contents: they become loose (rule O6).
    const doomed = new Set<FabricObject>(objs)
    const deletedFrames = new Set<string>()
    for (const o of objs) if (isFrame(o)) deletedFrames.add(idOf(o) ?? '')
    if (deletedFrames.size > 0) {
      for (const o of this.canvas.getObjects()) {
        const owner = ownerOf(o)
        if (owner !== undefined && deletedFrames.has(owner) && !doomed.has(o)) setOwner(o, undefined)
      }
    }
    this.canvas.discardActiveObject()
    this.canvas.remove(...objs)
    this.canvas.requestRenderAll()
    this.commit()
  }

  selectAll() {
    if (!this.editable || this.busy) return
    const objs = this.canvas.getObjects()
    this.finishEditing()
    this.canvas.discardActiveObject()
    this.selectByIds(objs)
    this.canvas.requestRenderAll()
  }

  setFontSize(size: number) {
    if (!this.editable || this.busy) return
    const active = this.canvas.getActiveObject()
    if (!(active instanceof Textbox) || !Number.isFinite(size)) return
    active.set({ fontSize: clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE) })
    active.setCoords()
    this.canvas.requestRenderAll()
    // A text that is blank right now (emptied in the middle of an edit) is not in the scene:
    // committing would record "text removed" while it is still being typed into.
    if (active.text.trim() === '') return
    this.commit(`font-size:${idOf(active) ?? ''}`)
  }

  arrange(op: LayerOp) {
    if (!this.editable || this.busy) return
    this.finishEditing()
    const objs = this.canvas.getActiveObjects()
    if (objs.length === 0) return
    const all = this.canvas.getObjects()
    const byId = new Map(all.map((o) => [idOf(o) ?? '', o] as const))
    // Frames and content are reordered within their own bands: a frame never rises above content.
    const next = reorderLayered(this.layeredOrder(), new Set(this.selectedIds()), op)
    this.canvas.discardActiveObject()
    ;[...next.frames, ...next.objects].forEach((id, index) => {
      const o = byId.get(id)
      if (o) this.canvas.moveObjectTo(o, index)
    })
    this.selectByIds(objs.filter((o) => this.canvas.getObjects().includes(o)))
    this.canvas.requestRenderAll()
    this.commit()
  }

  undo() {
    if (!this.editable || this.busy) return
    this.finishEditing()
    const scene = this.history.undo()
    if (scene) this.restoreHistory(scene)
  }

  redo() {
    if (!this.editable || this.busy) return
    this.finishEditing()
    const scene = this.history.redo()
    if (scene) this.restoreHistory(scene)
  }

  private restoreHistory(scene: Scene) {
    this.applyRecords(scene)
    this.autosaver.markDirty()
    this.syncState()
  }

  setTitle(raw: string) {
    if (!this.editable) return this.state.title
    const title = normalizeTitle(raw)
    if (title === this.state.title) return title
    this.setState({ title })
    this.autosaver.markDirty()
    return title
  }

  // ---- viewport ------------------------------------------------------------------------------

  getViewport(): Viewport {
    const v = this.canvas.viewportTransform
    return { zoom: v[0], panX: v[4], panY: v[5] }
  }

  private setViewport(vp: Viewport, persist = true) {
    this.canvas.setViewportTransform([vp.zoom, 0, 0, vp.zoom, vp.panX, vp.panY])
    this.canvas.requestRenderAll()
    this.setState({ viewport: vp })
    if (persist && this.state.ready) this.autosaver.markDirty()
  }

  zoomBy(factor: number) {
    if (!this.live) return
    const vp = this.getViewport()
    const center = { x: this.canvas.getWidth() / 2, y: this.canvas.getHeight() / 2 }
    this.setViewport(zoomAround(vp, center, vp.zoom * factor))
  }

  resetZoom() {
    if (!this.live) return
    const center = { x: this.canvas.getWidth() / 2, y: this.canvas.getHeight() / 2 }
    this.setViewport(zoomAround(this.getViewport(), center, 1))
  }

  fit() {
    if (!this.live) return
    let bounds: Rect | null = null
    for (const obj of this.canvas.getObjects()) {
      for (const p of obj.getCoords()) {
        bounds = bounds
          ? { left: Math.min(bounds.left, p.x), top: Math.min(bounds.top, p.y), right: Math.max(bounds.right, p.x), bottom: Math.max(bounds.bottom, p.y) }
          : { left: p.x, top: p.y, right: p.x, bottom: p.y }
      }
    }
    this.setViewport(fitViewport(bounds, { width: this.canvas.getWidth(), height: this.canvas.getHeight() }))
  }

  // ---- save / notices ---------------------------------------------------------------------------

  retrySave() {
    void this.autosaver.retry()
  }

  notify(kind: Notice['kind'], message: string) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    const id = ++this.noticeSeq
    this.setState({ notice: { id, kind, message } })
    this.noticeTimer = setTimeout(() => {
      if (this.state.notice?.id === id) this.setState({ notice: null })
    }, kind === 'error' ? 10000 : 5000)
  }

  dismissNotice() {
    this.setState({ notice: null })
  }

  /** True when `files` is a drag payload we can import. */
  static hasFiles(dt: DataTransfer | null): boolean {
    return !!dt && Array.from(dt.types ?? []).includes('Files')
  }
}

/** Folds a frame's scale into its size: frames are always at scale 1 between gestures. */
function bakeFrame(frame: FabricObject) {
  frame.set({
    width: roundPositive(frame.width * Math.abs(frame.scaleX)),
    height: roundPositive(frame.height * Math.abs(frame.scaleY)),
    scaleX: 1,
    scaleY: 1,
  })
  frame.setCoords()
}

/** Corner (and side) scaling, as opposed to moving, rotating or changing a text's wrap width. */
function isScaleAction(transform: Transform): boolean {
  return transform.action === 'scale' || transform.action === 'scaleX' || transform.action === 'scaleY'
}
