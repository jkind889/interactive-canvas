import { ActiveSelection, Canvas, Textbox } from 'fabric'
import type { FabricObject } from 'fabric'
import { DEFAULT_VIEWPORT, MAX_FONT_SIZE, MIN_FONT_SIZE, clamp, normalizeTitle, objectsEqual, referencedAssetIds } from '../model/doc.ts'
import { History } from '../model/history.ts'
import { canReorder, reorder } from '../model/layers.ts'
import type { LayerOp } from '../model/layers.ts'
import { DEFAULT_TITLE, DOC_VERSION } from '../model/types.ts'
import type { BoardDoc, ObjectRecord, SaveState, TextRecord, Viewport } from '../model/types.ts'
import { fitImageScale, fitViewport, screenToScene, zoomAround } from '../model/viewport.ts'
import type { Point, Rect } from '../model/viewport.ts'
import { Autosaver } from '../persistence/autosave.ts'
import type { BoardStore } from '../persistence/boardStore.ts'
import { hydrateBoard } from '../persistence/hydrate.ts'
import { isPanHoldKey, resolveShortcut } from '../input/shortcuts.ts'
import type { ShortcutAction } from '../input/shortcuts.ts'
import { AssetCache, isImageFile, readImageFile } from './assets.ts'
import type { AssetSource } from './assets.ts'
import { ACCENT, createObject, idOf, newId, normalizeTextScale, toRecord } from './objects.ts'

export type Tool = 'select' | 'hand' | 'text'

export interface SelectionInfo {
  kind: 'image' | 'text' | 'multiple'
  count: number
  /** Only for a single text object. */
  fontSize: number | null
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

const ZOOM_STEP = 1.25
const MIN_SELECTION_FONT = MIN_FONT_SIZE

/**
 * Owns the Fabric canvas, history, assets and autosave. React never touches
 * Fabric objects: it renders `getState()` snapshots and calls the methods here.
 * Fabric is the live source of truth for objects; history stores serialized
 * snapshots (see model/) and restores them by rebuilding objects.
 */
export class Editor {
  private readonly canvas: Canvas
  private readonly canvasEl: HTMLCanvasElement
  private readonly history = new History<ObjectRecord[]>([], { equals: objectsEqual })
  private readonly autosaver: Autosaver
  private readonly listeners = new Set<() => void>()
  private readonly cleanups: Array<() => void> = []
  private state: EditorState
  private applying = false
  private spaceHeld = false
  private disposed = false
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private noticeSeq = 0

  constructor(
    private readonly host: HTMLElement,
    private readonly store: BoardStore,
    private readonly assets: AssetSource = new AssetCache(),
  ) {
    this.canvasEl = document.createElement('canvas')
    host.appendChild(this.canvasEl)
    const { width, height } = host.getBoundingClientRect()
    this.canvas = new Canvas(this.canvasEl, {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      preserveObjectStacking: true,
      stopContextMenu: true,
      selectionColor: 'rgba(108, 123, 242, 0.08)',
      selectionBorderColor: ACCENT,
      selectionLineWidth: 1,
    })

    this.state = {
      ready: false,
      readOnly: null,
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

  async init(): Promise<void> {
    const outcome = await hydrateBoard(this.store, (asset) => this.assets.load(asset))
    if (this.disposed) return

    switch (outcome.kind) {
      case 'empty':
        this.autosaver.markLoaded(false)
        break
      case 'restored':
        this.showStoredBoard(outcome.doc)
        this.autosaver.markLoaded(true)
        // Only after a complete, successful restore: drop bytes the stored board never referenced.
        void this.store.pruneAssets(referencedAssetIds(outcome.doc.objects)).catch(() => {
          /* cleanup only; unreferenced bytes are harmless */
        })
        break
      case 'blocked':
        // Fail closed: show what could be shown, but never write or prune anything.
        if (outcome.partial) this.showStoredBoard(outcome.partial)
        this.autosaver.disable(outcome.message)
        this.setState({ readOnly: outcome.message, tool: 'hand' }) // surfaced by a persistent banner
        break
    }
    this.history.reset(this.snapshot())
    this.setState({ ready: true })
    this.applyToolState()
    this.syncState()
  }

  private showStoredBoard(doc: BoardDoc) {
    this.applyRecords(doc.objects)
    this.setState({ title: doc.title })
    this.setViewport(doc.viewport, false)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.endPan?.()
    for (const c of this.cleanups.splice(0)) c()
    this.autosaver.dispose()
    this.listeners.clear()
    this.assets.dispose()
    void this.canvas.dispose()
    this.host.replaceChildren()
  }

  // ---- document ---------------------------------------------------------------

  private snapshot(): ObjectRecord[] {
    const out: ObjectRecord[] = []
    for (const obj of this.canvas.getObjects()) {
      const rec = toRecord(obj)
      if (rec) out.push(rec)
    }
    return out
  }

  private getDoc(): BoardDoc {
    return { version: DOC_VERSION, title: this.state.title, frames: [], objects: this.snapshot(), viewport: this.getViewport() }
  }

  /** Records the live board as a history step (no-op when nothing changed). */
  private commit(coalesceKey?: string) {
    if (this.applying || !this.editable) return
    if (this.history.push(this.snapshot(), coalesceKey)) this.autosaver.markDirty()
    this.syncState()
  }

  /** Rebuilds the canvas objects from records, preserving selection by id. */
  private applyRecords(records: readonly ObjectRecord[]) {
    this.applying = true
    try {
      const selected = new Set(this.selectedIds())
      this.canvas.discardActiveObject()
      const existing = this.canvas.getObjects()
      if (existing.length) this.canvas.remove(...existing)
      const built: FabricObject[] = []
      for (const rec of records) {
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

  // ---- state derived from the canvas -----------------------------------------

  private computeSelection(): SelectionInfo | null {
    const objs = this.canvas.getActiveObjects()
    if (objs.length === 0) return null
    const ids = new Set(this.selectedIds())
    const order = this.canvas.getObjects().map((o) => idOf(o) ?? '')
    const first = objs[0]
    const single = objs.length === 1 ? first : undefined
    return {
      kind: objs.length > 1 ? 'multiple' : single instanceof Textbox ? 'text' : 'image',
      count: objs.length,
      fontSize: single instanceof Textbox ? Math.max(MIN_SELECTION_FONT, Math.round(single.fontSize * 10) / 10) : null,
      layer: {
        front: canReorder(order, ids, 'front'),
        forward: canReorder(order, ids, 'forward'),
        backward: canReorder(order, ids, 'backward'),
        back: canReorder(order, ids, 'back'),
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
        active.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false })
        active.set({
          borderColor: ACCENT,
          cornerColor: '#ffffff',
          cornerStrokeColor: ACCENT,
          cornerStyle: 'rect',
          cornerSize: 9,
          transparentCorners: false,
          borderScaleFactor: 1.5,
          lockScalingFlip: true,
        })
      }
      this.syncState()
    }
    c.on('selection:created', onSelection)
    c.on('selection:updated', onSelection)
    c.on('selection:cleared', onSelection)

    c.on('object:modified', ({ target }) => {
      if (this.applying || !this.editable) return
      if (target instanceof ActiveSelection) {
        const members = target.getObjects()
        const scaled = Math.abs(target.scaleX - 1) > 0.001 || Math.abs(target.scaleY - 1) > 0.001
        if (scaled && members.some((o) => o instanceof Textbox)) {
          // Fold the group's scale into member text (font size/width), which means
          // dissolving and re-forming the selection. Discarding inside this event
          // would re-enter Fabric's transform finalization (and recurse), so wait
          // until it has finished.
          queueMicrotask(() => {
            if (this.disposed) return
            const keep = members.slice()
            c.discardActiveObject()
            for (const o of keep) if (o instanceof Textbox) normalizeTextScale(o)
            this.selectByIds(keep)
            c.requestRenderAll()
            this.commit()
          })
          return
        }
      } else if (target instanceof Textbox) {
        normalizeTextScale(target)
      }
      this.commit()
    })

    c.on('text:editing:entered', () => this.syncState())
    c.on('text:changed', () => {
      if (!this.applying && this.editable) this.autosaver.markDirty() // keep typing durable; history commits on exit
    })
    c.on('text:editing:exited', ({ target }) => {
      if (this.applying || !this.editable) return
      if (target instanceof Textbox && target.text.trim() === '') {
        c.remove(target)
        c.requestRenderAll()
      }
      this.commit()
    })

    c.on('mouse:up', (opt) => {
      if (!this.editable || this.state.tool !== 'text' || this.state.handActive || opt.target || !opt.isClick) return
      if ((opt.e as MouseEvent).button !== 0) return
      const p = c.getScenePoint(opt.e)
      this.addTextAt({ x: p.x, y: p.y }, 'top-left')
    })
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

    // Panning: swallow the gesture before Fabric sees it.
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
        const wantsPan = e.button === 1 || (e.button === 0 && this.state.handActive)
        if (!wantsPan) return
        e.preventDefault()
        e.stopPropagation()
        this.finishEditing()
        this.beginPan(e)
      },
      { capture: true },
    )

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

  private endPan: (() => void) | null = null

  private beginPan(start: MouseEvent) {
    this.endPan?.()
    let last = { x: start.clientX, y: start.clientY }
    this.canvas.upperCanvasEl.style.cursor = 'grabbing'
    const move = (e: MouseEvent) => {
      const vp = this.getViewport()
      this.setViewport({ ...vp, panX: vp.panX + (e.clientX - last.x), panY: vp.panY + (e.clientY - last.y) })
      last = { x: e.clientX, y: e.clientY }
    }
    const end = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
      this.canvas.upperCanvasEl.style.cursor = ''
      this.endPan = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    this.endPan = end
  }

  handleKeyDown(e: KeyboardEvent) {
    if (!this.live) return
    const ctx = { editingText: this.state.editingText }
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
      case 'add-image':
        return this.editable ? this.imagePicker?.() : undefined
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

  // ---- tools ----------------------------------------------------------------------

  setTool(tool: Tool) {
    if (!this.live) return
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
    this.canvas.skipTargetFind = hand || !editable
    this.canvas.defaultCursor = hand ? 'grab' : tool === 'text' ? 'text' : 'default'
    this.canvas.hoverCursor = hand ? 'grab' : tool === 'text' ? 'text' : 'move'
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
    if (!this.editable) return
    this.addTextAt(this.viewCenterScene(), 'center')
  }

  private addTextAt(at: Point, anchor: 'center' | 'top-left') {
    if (!this.editable) return
    // Placement is single-use. Switch tools first: setTool() ends any editing.
    if (this.state.tool !== 'select') this.setTool('select')
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
    this.canvas.setActiveObject(obj)
    obj.enterEditing()
    this.canvas.requestRenderAll()
    this.syncState()
  }

  /** `at` is in client (screen) coordinates, e.g. a drop position. */
  async addImageFiles(files: readonly File[], at?: { clientX: number; clientY: number }) {
    if (!this.editable) {
      if (this.live) this.notify('error', `This board is read-only. ${this.state.readOnly ?? ''}`.trim())
      else if (!this.disposed) this.notify('info', 'The board is still loading. Try again in a moment.')
      return
    }
    const images = files.filter(isImageFile)
    const skipped = files.length - images.length
    const failed: string[] = []
    const added: FabricObject[] = []
    const rect = this.host.getBoundingClientRect()
    const center = at ? screenToScene(this.getViewport(), { x: at.clientX - rect.left, y: at.clientY - rect.top }) : this.viewCenterScene()
    const maxSide = 480 / this.getViewport().zoom

    for (const file of images) {
      try {
        const asset = await readImageFile(file)
        const el = await this.assets.load(asset)
        if (this.disposed) return
        const scale = fitImageScale(el.naturalWidth, el.naturalHeight, maxSide)
        const offset = added.length * (24 / this.getViewport().zoom)
        const obj = createObject(
          {
            id: newId(),
            type: 'image',
            assetId: asset.id,
            angle: 0,
            scaleX: scale,
            scaleY: scale,
            left: center.x - (el.naturalWidth * scale) / 2 + offset,
            top: center.y - (el.naturalHeight * scale) / 2 + offset,
          },
          (id) => this.assets.get(id),
        )
        if (!obj) throw new Error('Could not create image.')
        this.canvas.add(obj)
        this.autosaver.addAsset(asset)
        added.push(obj)
      } catch {
        failed.push(file.name || 'image')
      }
    }

    if (added.length > 0) {
      this.finishEditing()
      this.canvas.discardActiveObject()
      this.selectByIds(added.slice(-1))
      this.canvas.requestRenderAll()
      this.commit()
    }
    const problems: string[] = []
    if (skipped > 0) problems.push(`${skipped} file${skipped === 1 ? ' is' : 's are'} not an image`)
    if (failed.length > 0) problems.push(`could not read ${failed.join(', ')}`)
    if (problems.length > 0) {
      const text = problems.join('; ')
      this.notify('error', `${text.charAt(0).toUpperCase()}${text.slice(1)}.`)
    }
  }

  // ---- editing ----------------------------------------------------------------------------

  deleteSelection() {
    if (!this.editable) return
    this.finishEditing()
    const objs = this.canvas.getActiveObjects()
    if (objs.length === 0) return
    this.canvas.discardActiveObject()
    this.canvas.remove(...objs)
    this.canvas.requestRenderAll()
    this.commit()
  }

  selectAll() {
    if (!this.editable) return
    const objs = this.canvas.getObjects()
    this.finishEditing()
    this.canvas.discardActiveObject()
    this.selectByIds(objs)
    this.canvas.requestRenderAll()
  }

  setFontSize(size: number) {
    if (!this.editable) return
    const active = this.canvas.getActiveObject()
    if (!(active instanceof Textbox) || !Number.isFinite(size)) return
    active.set({ fontSize: clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE) })
    active.setCoords()
    this.canvas.requestRenderAll()
    this.commit(`font-size:${idOf(active) ?? ''}`)
  }

  arrange(op: LayerOp) {
    if (!this.editable) return
    this.finishEditing()
    const objs = this.canvas.getActiveObjects()
    if (objs.length === 0) return
    const all = this.canvas.getObjects()
    const byId = new Map(all.map((o) => [idOf(o) ?? '', o] as const))
    const next = reorder(
      all.map((o) => idOf(o) ?? ''),
      new Set(this.selectedIds()),
      op,
    )
    this.canvas.discardActiveObject()
    next.forEach((id, index) => {
      const o = byId.get(id)
      if (o) this.canvas.moveObjectTo(o, index)
    })
    this.selectByIds(objs.filter((o) => this.canvas.getObjects().includes(o)))
    this.canvas.requestRenderAll()
    this.commit()
  }

  undo() {
    if (!this.editable) return
    this.finishEditing()
    const rec = this.history.undo()
    if (rec) this.restoreHistory(rec)
  }

  redo() {
    if (!this.editable) return
    this.finishEditing()
    const rec = this.history.redo()
    if (rec) this.restoreHistory(rec)
  }

  private restoreHistory(records: ObjectRecord[]) {
    this.applyRecords(records)
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
