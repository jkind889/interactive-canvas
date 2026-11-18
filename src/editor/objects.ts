import { FabricImage, Rect, Textbox, util } from 'fabric'
import type { FabricObject } from 'fabric'
import { round, roundPositive } from '../model/doc.ts'
import type { FrameRecord, ImageRecord, ObjectRecord, TextRecord } from '../model/types.ts'
import type { Point } from '../model/viewport.ts'

export const ACCENT = '#6c7bf2'
export const TEXT_COLOR = '#1d2230'
export const FRAME_FILL = '#ffffff'
export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

interface Meta {
  id: string
  kind: 'image' | 'text' | 'frame'
  assetId?: string
  /** Content only: the frame that owns it. */
  frameId?: string
  /** Frames only. */
  name?: string
}

/** Fabric objects are plain; our identity lives beside them, not on them. */
const meta = new WeakMap<FabricObject, Meta>()

export const idOf = (obj: FabricObject): string | undefined => meta.get(obj)?.id
export const isFrame = (obj: FabricObject): boolean => meta.get(obj)?.kind === 'frame'
export const ownerOf = (obj: FabricObject): string | undefined => meta.get(obj)?.frameId
export const frameNameOf = (obj: FabricObject): string | undefined => meta.get(obj)?.name

/** Sets or clears the owner of a piece of content. Frames have no owner. */
export function setOwner(obj: FabricObject, frameId: string | undefined) {
  const m = meta.get(obj)
  if (!m || m.kind === 'frame') return
  if (frameId === undefined) delete m.frameId
  else m.frameId = frameId
}

export function setFrameName(obj: FabricObject, name: string) {
  const m = meta.get(obj)
  if (m?.kind === 'frame') m.name = name
}

export { newId } from '../model/id.ts'

const SELECTION_STYLE = {
  originX: 'left',
  originY: 'top',
  borderColor: ACCENT,
  cornerColor: '#ffffff',
  cornerStrokeColor: ACCENT,
  cornerStyle: 'rect',
  cornerSize: 9,
  transparentCorners: false,
  borderScaleFactor: 1.5,
  lockScalingFlip: true,
  padding: 2,
  // Fabric's default stroke width of 1 is part of an object's transformed size,
  // which would make center<->top-left conversion drift by half a pixel per round trip.
  strokeWidth: 0,
} as const

export function createObject(rec: ObjectRecord, getImage: (assetId: string) => HTMLImageElement | undefined): FabricObject | null {
  if (rec.type === 'image') {
    const el = getImage(rec.assetId)
    if (!el) return null
    const img = new FabricImage(el, {
      ...SELECTION_STYLE,
      left: rec.left,
      top: rec.top,
      angle: rec.angle,
      scaleX: rec.scaleX,
      scaleY: rec.scaleY,
    })
    // Images keep their aspect ratio: corner handles only.
    img.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false })
    meta.set(img, { id: rec.id, kind: 'image', assetId: rec.assetId, ...(rec.frameId !== undefined && { frameId: rec.frameId }) })
    return img
  }
  const tb = new Textbox(rec.text, {
    ...SELECTION_STYLE,
    left: rec.left,
    top: rec.top,
    angle: rec.angle,
    width: rec.width,
    fontSize: rec.fontSize,
    fontFamily: FONT_FAMILY,
    fill: TEXT_COLOR,
    lineHeight: 1.25,
  })
  tb.setControlsVisibility({ mt: false, mb: false })
  meta.set(tb, { id: rec.id, kind: 'text', ...(rec.frameId !== undefined && { frameId: rec.frameId }) })
  return tb
}

/**
 * A frame is an unrotated white rectangle that sits behind all content. Its outline
 * and label are drawn over the canvas separately (in screen pixels), so the rectangle
 * itself has no stroke and its size is exactly the frame's size.
 */
export function createFrame(rec: FrameRecord): FabricObject {
  const rect = new Rect({
    ...SELECTION_STYLE,
    padding: 0,
    left: rec.left,
    top: rec.top,
    width: rec.width,
    height: rec.height,
    fill: FRAME_FILL,
    lockRotation: true,
    lockSkewingX: true,
    lockSkewingY: true,
    objectCaching: false,
  })
  rect.setControlsVisibility({ mtr: false })
  meta.set(rect, { id: rec.id, kind: 'frame', name: rec.name })
  return rect
}

function rotate(x: number, y: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [x * c - y * s, x * s + y * c]
}

/** The object's centre in scene coordinates, whether or not it is inside a multi-selection. */
export function centerOf(obj: FabricObject): Point {
  const d = util.qrDecompose(obj.calcTransformMatrix())
  return { x: d.translateX, y: d.translateY }
}

/**
 * Reads a content object's absolute state. Goes through the full transform matrix so
 * objects that are members of a multi-selection (whose own left/top are
 * relative to the selection) serialize to scene coordinates. Returns null for frames.
 *
 * Nothing is clamped here: a value is whatever the canvas shows. Quantities that must
 * be positive are rounded so that they can never become zero.
 */
export function toRecord(obj: FabricObject): ObjectRecord | null {
  const m = meta.get(obj)
  if (!m || m.kind === 'frame') return null
  const d = util.qrDecompose(obj.calcTransformMatrix())
  const sx = Math.abs(d.scaleX)
  const sy = Math.abs(d.scaleY)
  // translateX/Y is the object's centre; convert to its (unrotated) top-left.
  const [ox, oy] = rotate((obj.width * sx) / 2, (obj.height * sy) / 2, d.angle)
  const base = { id: m.id, left: round(d.translateX - ox), top: round(d.translateY - oy), angle: round(d.angle) }
  const owner = m.frameId !== undefined ? { frameId: m.frameId } : {}
  if (obj instanceof Textbox) {
    const s = (sx + sy) / 2
    const rec: TextRecord = {
      ...base,
      type: 'text',
      text: obj.text,
      fontSize: roundPositive(obj.fontSize * s, 2),
      width: roundPositive(obj.width * sx),
      ...owner,
    }
    return rec
  }
  if (m.assetId === undefined) return null
  const rec: ImageRecord = { ...base, type: 'image', assetId: m.assetId, scaleX: roundPositive(sx, 5), scaleY: roundPositive(sy, 5), ...owner }
  return rec
}

/** Reads a frame's absolute rectangle (any scale is folded into its size). Returns null for content. */
export function toFrameRecord(obj: FabricObject): FrameRecord | null {
  const m = meta.get(obj)
  if (!m || m.kind !== 'frame') return null
  const d = util.qrDecompose(obj.calcTransformMatrix())
  const width = obj.width * Math.abs(d.scaleX)
  const height = obj.height * Math.abs(d.scaleY)
  return {
    id: m.id,
    name: m.name ?? '',
    left: round(d.translateX - width / 2),
    top: round(d.translateY - height / 2),
    width: roundPositive(width),
    height: roundPositive(height),
  }
}

/** True when the object's absolute scale (its own times its selection's) is not 1. */
export function hasResidualScale(obj: FabricObject): boolean {
  const d = util.qrDecompose(obj.calcTransformMatrix())
  return Math.abs(Math.abs(d.scaleX) - 1) > 0.001 || Math.abs(Math.abs(d.scaleY) - 1) > 0.001
}

/**
 * Folds any residual scale on a text object into fontSize/width, with no limit of its
 * own: limits are decided once per gesture, before this runs.
 */
export function normalizeTextScale(tb: Textbox): boolean {
  const sx = Math.abs(tb.scaleX)
  const sy = Math.abs(tb.scaleY)
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return false
  const s = (sx + sy) / 2
  tb.set({
    fontSize: roundPositive(tb.fontSize * s, 2),
    width: roundPositive(tb.width * sx, 2),
    scaleX: 1,
    scaleY: 1,
  })
  tb.setCoords()
  return true
}
