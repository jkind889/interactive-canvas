/**
 * Drives the fake Fabric canvas the way real Fabric drives the editor: the same events,
 * with the same payload fields, in the same order as Fabric 7.4's mouse handlers. Only for tests.
 */
import type { Editor } from '../Editor.ts'
import type { Canvas, FakeObject, FakeTransform } from './fakeFabric.ts'

export const canvasOf = (editor: Editor): Canvas => (editor as unknown as { canvas: Canvas }).canvas

export const mouse = (button = 0, x = 0, y = 0) => ({ button, clientX: x, clientY: y })

/** Lets queued microtasks (settlement, idle) run. */
export async function tick() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

export interface PressOptions {
  action?: string
  corner?: string
  originX?: FakeTransform['originX']
  originY?: FakeTransform['originY']
}

/** Primary press on an object: Fabric sets up its transform and fires `before:transform`. */
export function press(canvas: Canvas, target: FakeObject, opts: PressOptions = {}): FakeTransform {
  const transform: FakeTransform = {
    target,
    action: opts.action ?? 'drag',
    actionPerformed: false,
    corner: opts.corner ?? '',
    originX: opts.originX ?? 'left',
    originY: opts.originY ?? 'top',
    original: { scaleX: target.scaleX, scaleY: target.scaleY, left: target.left, top: target.top },
  }
  canvas._currentTransform = transform
  canvas.fire('before:transform', { e: mouse(0), transform })
  canvas.fire('mouse:down', { e: mouse(0), target })
  return transform
}

/** Pointer movement during a drag. */
export function dragBy(canvas: Canvas, transform: FakeTransform, dx: number, dy: number) {
  transform.target.left += dx
  transform.target.top += dy
  transform.actionPerformed = true
  canvas.fire('object:moving', { e: mouse(0), target: transform.target, transform })
}

/** Pointer movement on a corner handle: scales about the transform's anchor, as Fabric does. */
export function scaleBy(canvas: Canvas, transform: FakeTransform, factor: number) {
  const t = transform.target
  const anchor = t.translateToOriginPoint(t.getCenterPoint(), transform.originX, transform.originY)
  t.scaleX = transform.original.scaleX * factor
  t.scaleY = transform.original.scaleY * factor
  t.setPositionByOrigin(anchor, transform.originX, transform.originY)
  transform.actionPerformed = true
  canvas.fire('object:scaling', { e: mouse(0), target: t, transform })
}

/**
 * Button release. For the primary button this is Fabric's `__onMouseUp`: finalize the
 * transform (`object:modified` only if it did anything), fire `mouse:up`, then forget
 * the transform. Any other button only fires `mouse:up` (which Fabric itself would not
 * even do with fireRightClick/fireMiddleClick off; the editor must cope anyway).
 */
export function release(canvas: Canvas, transform: FakeTransform | null, button = 0) {
  if (button !== 0) {
    canvas.fire('mouse:up', { e: mouse(button), isClick: false })
    return
  }
  const current = transform !== null && canvas._currentTransform === transform ? transform : null
  if (current?.actionPerformed) {
    canvas.fire('object:modified', { e: mouse(0), target: current.target, transform: current, action: current.action })
  }
  canvas.fire('mouse:up', { e: mouse(0), isClick: !transform?.actionPerformed, target: transform?.target })
  canvas._currentTransform = null
}
