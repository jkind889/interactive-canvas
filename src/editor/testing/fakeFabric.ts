/**
 * Minimal stand-in for the parts of Fabric.js that Editor/objects use, so the real
 * Editor can be driven deterministically in jsdom (which has no canvas). Only for tests.
 */

type Handler = (e: never) => void

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
      { x: this.left + this.width * this.scaleX, y: this.top + this.height * this.scaleY },
    ]
  }
}

export class Textbox extends FakeObject {
  text: string
  fontSize = 24
  constructor(text: string, opts: Record<string, unknown> = {}) {
    super(opts)
    this.text = text
    this.height = this.fontSize * 1.25
  }
  enterEditing() {
    this.isEditing = true
  }
  exitEditing() {
    this.isEditing = false
  }
}

export class FabricImage extends FakeObject {
  constructor(el: { naturalWidth?: number; naturalHeight?: number }, opts: Record<string, unknown> = {}) {
    super(opts)
    this.width = el.naturalWidth ?? 100
    this.height = el.naturalHeight ?? 100
  }
}

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
  private width: number
  private height: number
  private handlers = new Map<string, Handler[]>()

  constructor(
    _el: unknown,
    opts: { width: number; height: number },
  ) {
    this.width = opts.width
    this.height = opts.height
  }
  on(name: string, fn: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn])
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
    this.active = o
  }
  discardActiveObject() {
    this.active = null
    return true
  }
  add(...objs: FakeObject[]) {
    this.objects.push(...objs)
  }
  remove(...objs: FakeObject[]) {
    this.objects = this.objects.filter((o) => !objs.includes(o))
  }
  moveObjectTo(o: FakeObject, index: number) {
    this.objects = this.objects.filter((x) => x !== o)
    this.objects.splice(index, 0, o)
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
  setViewportTransform(v: number[]) {
    this.viewportTransform = v
  }
  getScenePoint() {
    return { x: 0, y: 0 }
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
