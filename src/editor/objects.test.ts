import { describe, expect, it, vi } from 'vitest'
import { parseDoc, serializeDoc, createEmptyDoc } from '../model/doc.ts'
import type { FrameRecord, ImageRecord, TextRecord } from '../model/types.ts'
import { centerOf, createFrame, createObject, frameNameOf, idOf, imageSizeOf, isFrame, isLocked, normalizeTextScale, ownerOf, setFrameName, setImageCrop, setLocked, setOwner, toFrameRecord, toRecord } from './objects.ts'

vi.mock('fabric', () => import('./testing/fakeFabric.ts'))

type Loose = { scaleX: number; scaleY: number; left: number; top: number; width: number; height: number; fontSize: number }
const loose = (o: unknown) => o as Loose

const el = { naturalWidth: 200, naturalHeight: 100 } as HTMLImageElement
const image = (patch: Partial<ImageRecord> = {}): ImageRecord => ({ type: 'image', id: 'i1', left: 5, top: 6, angle: 0, assetId: 'a1', scaleX: 0.5, scaleY: 0.5, ...patch })
const text = (patch: Partial<TextRecord> = {}): TextRecord => ({ type: 'text', id: 't1', left: 1, top: 2, angle: 0, text: 'hi', fontSize: 24, width: 200, ...patch })
const frame: FrameRecord = { id: 'f1', name: 'Cover', left: -10, top: -20, width: 640, height: 480 }
const make = (rec: ImageRecord | TextRecord) => createObject(rec, () => el)!

describe('records round-trip through canvas objects', () => {
  it('content keeps its geometry and, when it has one, its owner', () => {
    expect(toRecord(make(image()))).toEqual(image())
    expect(toRecord(make(text()))).toEqual(text())
    expect(toRecord(make(image({ frameId: 'f1' })))).toEqual(image({ frameId: 'f1' }))
    expect(toRecord(make(text({ frameId: 'f1' })))).toEqual(text({ frameId: 'f1' }))
  })

  it('a loose object has no frameId key at all', () => {
    expect(toRecord(make(image()))).not.toHaveProperty('frameId')
    expect(ownerOf(make(text()))).toBeUndefined()
  })

  it('frames keep their id, name and rectangle, and are told apart from content', () => {
    const obj = createFrame(frame)
    expect(toFrameRecord(obj)).toEqual(frame)
    expect(isFrame(obj)).toBe(true)
    expect(idOf(obj)).toBe('f1')
    expect(frameNameOf(obj)).toBe('Cover')
    expect(toRecord(obj)).toBeNull() // a frame is never content
    expect(toFrameRecord(make(image()))).toBeNull()
    expect(isFrame(make(text()))).toBe(false)
  })

  it('a frame scale is folded into its size (frames are stored at scale 1)', () => {
    const obj = createFrame(frame)
    Object.assign(loose(obj), { scaleX: 0.5, scaleY: 2 })
    expect(toFrameRecord(obj)).toEqual({ ...frame, width: 320, height: 960 })
  })

  it('owner and name can be changed without touching anything else', () => {
    const img = make(image())
    setOwner(img, 'f9')
    expect(toRecord(img)).toEqual(image({ frameId: 'f9' }))
    setOwner(img, undefined)
    expect(toRecord(img)).toEqual(image())
    expect(toRecord(img)).not.toHaveProperty('frameId')

    const f = createFrame(frame)
    setFrameName(f, 'Back')
    expect(toFrameRecord(f)?.name).toBe('Back')
    setOwner(f, 'f2') // frames are never owned
    expect(ownerOf(f)).toBeUndefined()
    setFrameName(img, 'nope') // content has no name
    expect(frameNameOf(img)).toBeUndefined()
  })

  it('reports the scene-space centre', () => {
    expect(centerOf(make(image({ left: 100, top: 50, scaleX: 1, scaleY: 1 })))).toEqual({ x: 200, y: 100 })
    expect(centerOf(createFrame(frame))).toEqual({ x: 310, y: 220 })
  })
})

describe('no legacy clamp in the transform and serialization path', () => {
  it('folding a 500px text at 0.95 yields 475 and width x 0.95', () => {
    const tb = make(text({ fontSize: 500, width: 1000 }))
    Object.assign(loose(tb), { scaleX: 0.95, scaleY: 0.95 })
    expect(normalizeTextScale(tb as never)).toBe(true)
    expect(loose(tb)).toMatchObject({ fontSize: 475, width: 950, scaleX: 1, scaleY: 1 })
  })

  it('folding never pulls an out-of-range font size back into range', () => {
    const big = make(text({ fontSize: 500, width: 1000 }))
    Object.assign(loose(big), { scaleX: 1.2, scaleY: 1.2 })
    normalizeTextScale(big as never)
    expect(loose(big).fontSize).toBe(600)

    const tiny = make(text({ fontSize: 8, width: 100 }))
    Object.assign(loose(tiny), { scaleX: 0.25, scaleY: 0.25 })
    normalizeTextScale(tiny as never)
    expect(loose(tiny).fontSize).toBe(2)
  })

  it('toRecord of a 500px text returns 500, and of a 2px text returns 2', () => {
    expect((toRecord(make(text({ fontSize: 500 }))) as TextRecord).fontSize).toBe(500)
    expect((toRecord(make(text({ fontSize: 2 }))) as TextRecord).fontSize).toBe(2)
  })

  it('toRecord reports an unfolded scale as the font size it shows, unclamped', () => {
    const tb = make(text({ fontSize: 300, width: 600 }))
    Object.assign(loose(tb), { scaleX: 2, scaleY: 2 })
    expect(toRecord(tb)).toMatchObject({ fontSize: 600, width: 1200 })
  })

  it('leaves a text without residual scale alone', () => {
    const tb = make(text())
    expect(normalizeTextScale(tb as never)).toBe(false)
    expect(loose(tb)).toMatchObject({ fontSize: 24, width: 200 })
  })
})

describe('positive values survive serialization', () => {
  it('a tiny image scale is stored as a positive number that the document parser accepts', () => {
    const img = make(image({ scaleX: 0.00001, scaleY: 0.00001 }))
    Object.assign(loose(img), { scaleX: 0.00001 * 0.4, scaleY: 0.00001 * 0.4 })
    const rec = toRecord(img) as ImageRecord
    expect(rec.scaleX).toBe(0.000004) // plain 5-decimal rounding would have stored 0
    expect(rec.scaleY).toBe(0.000004)
    const doc = { ...createEmptyDoc(), objects: [rec] }
    expect(parseDoc(JSON.parse(JSON.stringify(serializeDoc(doc))))).toEqual(doc)
  })

  it('tiny text and frame sizes stay positive too', () => {
    const tb = make(text({ fontSize: 0.001, width: 0.001 }))
    const rec = toRecord(tb) as TextRecord
    expect(rec.fontSize).toBeGreaterThan(0)
    expect(rec.width).toBeGreaterThan(0)
    const f = createFrame({ ...frame, width: 0.0001, height: 0.0001 })
    expect(toFrameRecord(f)!.width).toBeGreaterThan(0)
    expect(toFrameRecord(f)!.height).toBeGreaterThan(0)
  })

  it('ordinary values serialize exactly as before', () => {
    const img = make(image({ scaleX: 0.123456789, scaleY: 0.123456789, left: 1.005, top: 2.004 }))
    expect(toRecord(img)).toMatchObject({ scaleX: 0.12346, scaleY: 0.12346 })
  })
})

describe('locking', () => {
  type Flags = Record<string, unknown>
  const flags = (o: unknown) => {
    const f = o as Flags
    const keys = ['evented', 'selectable', 'hasControls', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'editable']
    return Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]))
  }
  const LOCKED = { evented: false, selectable: false, hasControls: false, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true }
  const OPEN = { evented: true, selectable: true, hasControls: true, lockMovementX: false, lockMovementY: false, lockScalingX: false, lockScalingY: false }

  it('a locked record creates a locked object (not a target, not selectable, no handles, nothing movable, text not editable), and back', () => {
    const img = make(image({ locked: true }))
    expect(isLocked(img)).toBe(true)
    expect(flags(img)).toEqual(LOCKED)
    const tb = make(text({ locked: true }))
    expect(flags(tb)).toEqual({ ...LOCKED, editable: false })
    const fr = createFrame({ ...frame, locked: true })
    expect(flags(fr)).toEqual(LOCKED)
    expect(toRecord(img)).toEqual(image({ locked: true }))
    expect(toRecord(tb)).toEqual(text({ locked: true }))
    expect(toFrameRecord(fr)).toEqual({ ...frame, locked: true })
  })

  it('unlocking restores exactly what creation sets, including a frame’s rotation lock; locking again matches a locked record', () => {
    const kinds = [(locked?: true) => make(image({ locked })), (locked?: true) => make(text({ locked })), (locked?: true) => createFrame({ ...frame, locked })]
    for (const build of kinds) {
      const wasLocked = build(true)
      setLocked(wasLocked, false)
      expect(isLocked(wasLocked)).toBe(false)
      expect(flags(wasLocked)).toEqual(flags(build()))
      const wasOpen = build()
      setLocked(wasOpen, true)
      expect(isLocked(wasOpen)).toBe(true)
      expect(flags(wasOpen)).toEqual(flags(build(true)))
    }
    expect(flags(createFrame(frame))).toEqual({ ...OPEN, lockRotation: true })
    expect(flags(make(image()))).toEqual({ ...OPEN, lockRotation: false })
    expect(flags(make(text()))).toEqual({ ...OPEN, lockRotation: false, editable: true })
  })

  it('an unlocked object has no locked key at all; locking changes nothing else in its record', () => {
    const img = make(image({ frameId: 'f1' }))
    expect(toRecord(img)).not.toHaveProperty('locked')
    expect(toFrameRecord(createFrame(frame))).not.toHaveProperty('locked')
    setLocked(img, true)
    expect(toRecord(img)).toEqual(image({ frameId: 'f1', locked: true }))
    setLocked(img, false)
    expect(toRecord(img)).toEqual(image({ frameId: 'f1' }))
    expect(Object.keys(toRecord(img)!)).not.toContain('locked')
  })

  it('a locked record survives the stored document both ways', () => {
    const doc = { ...createEmptyDoc(), objects: [toRecord(make(image({ locked: true })))!] }
    expect(parseDoc(JSON.parse(JSON.stringify(serializeDoc(doc))))?.objects[0]).toEqual(image({ locked: true }))
  })
})

describe('cropped images', () => {
  // The fake element is 200x100 source pixels.
  const crop = { x: 20, y: 10, width: 100, height: 60 }

  it('a crop round-trips: Fabric shows only that part, and the record keeps it', () => {
    const img = make(image({ crop }))
    expect(img).toMatchObject({ cropX: 20, cropY: 10, width: 100, height: 60 })
    expect(toRecord(img)).toEqual(image({ crop }))
  })

  it('left/top are the displayed box: the centre is the centre of the cropped box', () => {
    const img = make(image({ crop, left: 0, top: 0, scaleX: 2, scaleY: 2 }))
    expect(centerOf(img)).toEqual({ x: 100, y: 60 })
  })

  it('emits a fresh crop object every time, never shared between snapshots', () => {
    const rec = image({ crop })
    const img = make(rec)
    const a = toRecord(img) as ImageRecord
    const b = toRecord(img) as ImageRecord
    expect(a.crop).toEqual(b.crop)
    expect(a.crop).not.toBe(b.crop)
    expect(a.crop).not.toBe(rec.crop)
  })

  it('an uncropped image, or a crop equal to the whole image, has no crop key', () => {
    expect(toRecord(make(image()))).not.toHaveProperty('crop')
    const whole = make(image({ crop: { x: 0, y: 0, width: 200, height: 100 } }))
    expect(toRecord(whole)).not.toHaveProperty('crop')
    expect(toRecord(whole)).toEqual(image())
  })

  it('reads the crop from Fabric, rounded like other stored numbers', () => {
    const img = make(image())
    Object.assign(img, { cropX: 1.23456, cropY: 0.5, width: 50.004999, height: 20 })
    expect((toRecord(img) as ImageRecord).crop).toEqual({ x: 1.23, y: 0.5, width: 50, height: 20 })
  })

  it('a stored crop reaching outside the decoded image is clamped to it (C5); nothing left shows the image whole', () => {
    const clamped = make(image({ crop: { x: 150, y: 50, width: 400, height: 400 } }))
    expect(clamped).toMatchObject({ cropX: 150, cropY: 50, width: 50, height: 50 })
    expect((toRecord(clamped) as ImageRecord).crop).toEqual({ x: 150, y: 50, width: 50, height: 50 })
    const outside = make(image({ crop: { x: 500, y: 500, width: 10, height: 10 } }))
    expect(outside).toMatchObject({ cropX: 0, cropY: 0, width: 200, height: 100 })
    expect(toRecord(outside)).toEqual(image()) // same top-left and scale, shown whole
  })

  it('setImageCrop changes only what is shown; undefined shows the whole image', () => {
    const img = make(image({ crop }))
    setImageCrop(img as never, { x: 0, y: 0, width: 50, height: 50 })
    expect(toRecord(img)).toEqual(image({ crop: { x: 0, y: 0, width: 50, height: 50 } }))
    setImageCrop(img as never, undefined)
    expect(toRecord(img)).toEqual(image())
    expect(imageSizeOf(img as never)).toEqual({ width: 200, height: 100 })
  })

  it('survives a full save and load', () => {
    const doc = { ...createEmptyDoc(), objects: [toRecord(make(image({ crop })))!] }
    const loaded = parseDoc(JSON.parse(JSON.stringify(serializeDoc(doc))))
    expect(loaded?.objects).toEqual([image({ crop })])
  })
})
