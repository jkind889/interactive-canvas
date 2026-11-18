/**
 * Minimal stand-in for the parts of Fabric.js that Editor/objects use, so the real
 * Editor can be driven deterministically in jsdom (which has no canvas). Only for tests.
 *
 * It models state machines, not geometry: there is no rotation, no group transform
 * and no real event ordering. Anything about hit testing, multi-selection geometry
 * or Fabric's finalization order is only accepted on real-browser (Playwright) evidence.
 */

type Handler = (e: never) => void
type Origin = 'left' | 'center' | 'right' | 'top' | 'bottom'
const originFactor = (o: Origin) => (o === 'center' ? 0.5 : o === 'right' || o === 'bottom' ? 1 : 0)

export class FakeObject {
  left = 0
  top = 0
  angle = 0
  scaleX = 1
  scaleY = 1
  width = 0
  height = 0
  isEditing = false
  group: unknown = null
  canvas: Canvas | null = null
  constructor(opts: Record<string, unknown> = {}) {
    Object.assign(this, opts)
  }
  set(patch: Record<string, unknown>) {
    Object.assign(this, patch)
    return this
  }
  setCoords() {}
  setControlsVisibility() {}
  calcTransformMatrix() {
    const sx = this.scaleX
    const sy = this.scaleY
    return [sx, 0, 0, sy, this.left + (this.width * sx) / 2, this.top + (this.height * sy) / 2]
  }
  getCoords() {
    return [
      { x: this.left, y: this.top },
      { x: this.left + this.width * this.scaleX, y: this.top },
      { x: this.left + this.width * this.scaleX, y: this.top + this.height * this.scaleY },
      { x: this.left, y: this.top + this.height * this.scaleY },
    ]
  }
  getCenterPoint() {
    return { x: this.left + (this.width * this.scaleX) / 2, y: this.top + (this.height * this.scaleY) / 2 }
  }
  /** The point of the (unrotated, left/top-origin) box named by an origin pair, given its centre. */
  translateToOriginPoint(center: { x: number; y: number }, originX: Origin, originY: Origin) {
    return {
      x: center.x + (originFactor(originX) - 0.5) * this.width * this.scaleX,
      y: center.y + (originFactor(originY) - 0.5) * this.height * this.scaleY,
    }
  }
  setPositionByOrigin(pos: { x: number; y: number }, originX: Origin, originY: Origin) {
    this.left = pos.x - originFactor(originX) * this.width * this.scaleX
    this.top = pos.y - originFactor(originY) * this.height * this.scaleY
  }
}

export class Textbox extends FakeObject {
  text: string
  fontSize = 24
  constructor(text: string, opts: Record<string, unknown> = {}) {
    super(opts)
    Object.assign(this, opts) // field initializers above ran after super(): apply the options again
    this.text = text
    this.height = this.fontSize * 1.25
  }
  private textBeforeEdit = ''
  enterEditing() {
    if (this.isEditing) return
    this.isEditing = true
    this.textBeforeEdit = this.text
    this.canvas?.fire('text:editing:entered', { target: this })
  }
  /** Same order as Fabric: the exit event first, then `object:modified` if the text changed. */
  exitEditing() {
    if (!this.isEditing) return
    this.isEditing = false
    const changed = this.textBeforeEdit !== this.text
    this.canvas?.fire('text:editing:exited', { target: this })
    if (changed) this.canvas?.fire('object:modified', { target: this })
  }
  /** Test helper: what typing does. */
  type(text: string) {
    this.text = text
    this.canvas?.fire('text:changed', { target: this })
  }
}

export class FabricImage extends FakeObject {
  constructor(el: { naturalWidth?: number; naturalHeight?: number }, opts: Record<string, unknown> = {}) {
    super(opts)
    this.width = el.naturalWidth ?? 100
    this.height = el.naturalHeight ?? 100
  }
}

export class Rect extends FakeObject {}

export class ActiveSelection extends FakeObject {
  private members: FakeObject[]
  constructor(members: FakeObject[]) {
    super()
    this.members = members
  }
  getObjects() {
    return this.members
  }
}

/** The fields of Fabric's transform record that the editor reads. */
export interface FakeTransform {
  target: FakeObject
  action: string
  actionPerformed: boolean
  corner: string
  originX: Origin
  originY: Origin
  original: { scaleX: number; scaleY: number; left: number; top: number }
}

export class Canvas {
  objects: FakeObject[] = []
  active: FakeObject | null = null
  viewportTransform = [1, 0, 0, 1, 0, 0]
  wrapperEl = document.createElement('div')
  upperCanvasEl = document.createElement('canvas')
  selection = false
  skipTargetFind = false
  defaultCursor = ''
  hoverCursor = ''
  uniformScaling = true
  _currentTransform: FakeTransform | null = null
  /** Every option the editor passed, so tests can assert on canvas configuration. */
  readonly options: Record<string, unknown>
  /** Names of Fabric calls made, for tests that must prove something was NOT called. */
  readonly calls: string[] = []
  private width: number
  private height: number
  private handlers = new Map<string, Handler[]>()

  constructor(el: unknown, opts: { width: number; height: number } & Record<string, unknown>) {
    this.options = opts
    this.width = opts.width
    this.height = opts.height
    // Like Fabric: the wrapper takes the element's place and holds the interactive canvas.
    const parent = (el as HTMLElement | null)?.parentNode
    if (parent) parent.appendChild(this.wrapperEl)
    this.wrapperEl.appendChild(this.upperCanvasEl)
  }
  on(name: string, fn: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn])
  }
  /** Fires a canvas event at the editor's handlers, as Fabric would. */
  fire(name: string, payload: unknown = {}) {
    for (const fn of this.handlers.get(name) ?? []) (fn as (e: unknown) => void)(payload)
  }
  getObjects() {
    return [...this.objects]
  }
  getActiveObject() {
    return this.active
  }
  getActiveObjects() {
    if (!this.active) return []
    return this.active instanceof ActiveSelection ? this.active.getObjects() : [this.active]
  }
  setActiveObject(o: FakeObject) {
    this.calls.push('setActiveObject')
    const had = this.active !== null
    this.active = o
    this.fire(had ? 'selection:updated' : 'selection:created', {})
  }
  discardActiveObject() {
    this.calls.push('discardActiveObject')
    const had = this.active
    if (had instanceof Textbox && had.isEditing) had.exitEditing()
    this.active = null
    if (had) this.fire('selection:cleared', {})
    return true
  }
  add(...objs: FakeObject[]) {
    this.calls.push('add')
    for (const o of objs) o.canvas = this
    this.objects.push(...objs)
  }
  insertAt(index: number, ...objs: FakeObject[]) {
    this.calls.push('insertAt')
    for (const o of objs) o.canvas = this
    this.objects.splice(index, 0, ...objs)
  }
  remove(...objs: FakeObject[]) {
    this.calls.push('remove')
    this.objects = this.objects.filter((o) => !objs.includes(o))
    if (this.active && objs.includes(this.active)) this.active = null
  }
  moveObjectTo(o: FakeObject, index: number) {
    this.objects = this.objects.filter((x) => x !== o)
    this.objects.splice(index, 0, o)
  }
  /** Like Fabric: finalizes the transform (firing `object:modified` if it did anything) and forgets it. */
  endCurrentTransform() {
    this.calls.push('endCurrentTransform')
    const transform = this._currentTransform
    if (transform?.actionPerformed) this.fire('object:modified', { target: transform.target, transform, action: transform.action })
    this._currentTransform = null
  }
  requestRenderAll() {}
  setDimensions(d: { width: number; height: number }) {
    this.width = d.width
    this.height = d.height
  }
  getWidth() {
    return this.width
  }
  getHeight() {
    return this.height
  }
  getZoom() {
    return this.viewportTransform[0] ?? 1
  }
  getContext() {
    return null
  }
  setViewportTransform(v: number[]) {
    this.viewportTransform = v
  }
  /** Scene point of a mouse event: tests put scene coordinates straight into clientX/clientY. */
  getScenePoint(e?: { clientX?: number; clientY?: number }) {
    return { x: e?.clientX ?? 0, y: e?.clientY ?? 0 }
  }
  async dispose() {
    return true
  }
}

export const util = {
  qrDecompose(m: number[]) {
    return { angle: 0, scaleX: m[0] ?? 1, scaleY: m[3] ?? 1, translateX: m[4] ?? 0, translateY: m[5] ?? 0 }
  },
}
