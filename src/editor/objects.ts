import { FabricImage, Textbox, util } from 'fabric'
import type { FabricObject } from 'fabric'
import { MAX_FONT_SIZE, MIN_FONT_SIZE, clamp } from '../model/doc.ts'
import type { ImageRecord, ObjectRecord, TextRecord } from '../model/types.ts'

export const ACCENT = '#6c7bf2'
export const TEXT_COLOR = '#1d2230'
export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/** Fabric objects are plain; our identity lives beside them, not on them. */
const meta = new WeakMap<FabricObject, { id: string; assetId?: string }>()

export const idOf = (obj: FabricObject): string | undefined => meta.get(obj)?.id

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
    meta.set(img, { id: rec.id, assetId: rec.assetId })
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
  meta.set(tb, { id: rec.id })
  return tb
}

function rotate(x: number, y: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [x * c - y * s, x * s + y * c]
}

/**
 * Reads an object's absolute state. Goes through the full transform matrix so
 * objects that are members of a multi-selection (whose own left/top are
 * relative to the selection) serialize to scene coordinates.
 */
export function toRecord(obj: FabricObject): ObjectRecord | null {
  const m = meta.get(obj)
  if (!m) return null
  const d = util.qrDecompose(obj.calcTransformMatrix())
  const sx = Math.abs(d.scaleX)
  const sy = Math.abs(d.scaleY)
  // translateX/Y is the object's centre; convert to its (unrotated) top-left.
  const [ox, oy] = rotate((obj.width * sx) / 2, (obj.height * sy) / 2, d.angle)
  const base = { id: m.id, left: round(d.translateX - ox), top: round(d.translateY - oy), angle: round(d.angle) }
  if (obj instanceof Textbox) {
    const s = (sx + sy) / 2
    const rec: TextRecord = {
      ...base,
      type: 'text',
      text: obj.text,
      fontSize: round(clamp(obj.fontSize * s, MIN_FONT_SIZE, MAX_FONT_SIZE), 2),
      width: round(obj.width * sx),
    }
    return rec
  }
  if (m.assetId === undefined) return null
  const rec: ImageRecord = { ...base, type: 'image', assetId: m.assetId, scaleX: round(sx, 5), scaleY: round(sy, 5) }
  return rec
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits
  const r = Math.round(n * f) / f
  return Object.is(r, -0) ? 0 : r
}

/** Folds any residual scale on a text object into fontSize/width. */
export function normalizeTextScale(tb: Textbox): boolean {
  const sx = Math.abs(tb.scaleX)
  const sy = Math.abs(tb.scaleY)
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return false
  const s = (sx + sy) / 2
  tb.set({
    fontSize: round(clamp(tb.fontSize * s, MIN_FONT_SIZE, MAX_FONT_SIZE), 1),
    width: tb.width * sx,
    scaleX: 1,
    scaleY: 1,
  })
  tb.setCoords()
  return true
}
