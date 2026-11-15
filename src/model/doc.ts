import { DEFAULT_TITLE, DOC_VERSION } from './types.ts'
import type { BoardDoc, ObjectRecord, Viewport } from './types.ts'

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8
export const MIN_FONT_SIZE = 6
export const MAX_FONT_SIZE = 400

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 }

export function createEmptyDoc(): BoardDoc {
  return { version: DOC_VERSION, title: DEFAULT_TITLE, objects: [], viewport: { ...DEFAULT_VIEWPORT } }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function parseObject(raw: unknown): ObjectRecord | null {
  if (!isRecord(raw)) return null
  const { id, type, left, top, angle } = raw
  if (!isStr(id) || id === '' || !isNum(left) || !isNum(top) || !isNum(angle)) return null
  if (type === 'image') {
    const { assetId, scaleX, scaleY } = raw
    if (!isStr(assetId) || !isNum(scaleX) || !isNum(scaleY) || scaleX === 0 || scaleY === 0) return null
    return { type, id, left, top, angle, assetId, scaleX, scaleY }
  }
  if (type === 'text') {
    const { text, fontSize, width } = raw
    if (!isStr(text) || !isNum(fontSize) || !isNum(width) || fontSize <= 0 || width <= 0) return null
    return { type, id, left, top, angle, text, fontSize, width }
  }
  return null
}

/**
 * Validates untrusted stored data. Returns null when the shape is wrong or the
 * version is unknown; callers must not overwrite the stored value in that case.
 */
export function parseDoc(raw: unknown): BoardDoc | null {
  if (!isRecord(raw) || raw.version !== DOC_VERSION || !Array.isArray(raw.objects)) return null
  const objects: ObjectRecord[] = []
  const seen = new Set<string>()
  for (const o of raw.objects) {
    const rec = parseObject(o)
    if (!rec || seen.has(rec.id)) return null
    seen.add(rec.id)
    objects.push(rec)
  }
  const title = isStr(raw.title) && raw.title.trim() !== '' ? raw.title : DEFAULT_TITLE
  let viewport = { ...DEFAULT_VIEWPORT }
  if (isRecord(raw.viewport)) {
    const { zoom, panX, panY } = raw.viewport
    if (isNum(zoom) && isNum(panX) && isNum(panY) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM) {
      viewport = { zoom, panX, panY }
    }
  }
  return { version: DOC_VERSION, title, objects, viewport }
}

export function referencedAssetIds(objects: readonly ObjectRecord[]): Set<string> {
  const ids = new Set<string>()
  for (const o of objects) if (o.type === 'image') ids.add(o.assetId)
  return ids
}

export function objectsEqual(a: readonly ObjectRecord[], b: readonly ObjectRecord[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeTitle(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  return t === '' ? DEFAULT_TITLE : t.slice(0, 120)
}
