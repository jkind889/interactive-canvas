import { describe, expect, it, vi } from 'vitest'
import { parseDoc, serializeDoc, createEmptyDoc } from '../model/doc.ts'
import type { FrameRecord, ImageRecord, TextRecord } from '../model/types.ts'
import { FONT_STACKS } from './fonts.ts'
import {
  TEXT_COLOR,
  centerOf,
  createFrame,
  createObject,
  frameNameOf,
  idOf,
  isFrame,
  normalizeTextScale,
  ownerOf,
  reconcileTextFormatting,
  setFrameName,
  setOwner,
  setTextFontSize,
  toFrameRecord,
  toRecord,
} from './objects.ts'

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

describe('formatted text on the canvas', () => {
  type Styles = Record<number, Record<number, Record<string, unknown>>>
  type Tb = Loose & { styles: Styles; fontFamily: string; textAlign: string; fill: unknown; text: string }
  const tbOf = (o: unknown) => o as Tb
  const PLAIN_KEYS = ['id', 'left', 'top', 'angle', 'type', 'text', 'fontSize', 'width']

  it('a plain text is drawn as before and reads back with exactly the old keys', () => {
    const tb = tbOf(make(text()))
    expect(tb.fontFamily).toBe(FONT_STACKS.sans)
    expect(tb.fill).toBe(TEXT_COLOR)
    expect(tb.textAlign).toBe('left')
    expect(tb.styles).toEqual({})
    expect(Object.keys(toRecord(tb as never)!)).toEqual(PLAIN_KEYS)
    expect(Object.keys(toRecord(make(text({ frameId: 'f1' })))!)).toEqual([...PLAIN_KEYS, 'frameId'])
  })

  it('font, alignment and colour round-trip; defaults read back as no key', () => {
    for (const font of ['serif', 'mono', 'hand', 'display'] as const) expect(toRecord(make(text({ font })))).toEqual(text({ font }))
    expect(tbOf(make(text({ font: 'mono' }))).fontFamily).toBe(FONT_STACKS.mono)
    expect(toRecord(make(text({ align: 'center' })))).toEqual(text({ align: 'center' }))
    expect(toRecord(make(text({ align: 'right' })))).toEqual(text({ align: 'right' }))
    expect(tbOf(make(text({ color: '#c0392b' }))).fill).toBe('#c0392b')
    expect(toRecord(make(text({ color: '#c0392b' })))).toEqual(text({ color: '#c0392b' }))
    const odd = tbOf(make(text()))
    Object.assign(odd, { fontFamily: 'Papyrus', textAlign: 'justify', fill: 'rgb(1,2,3)' }) // nothing the app writes
    expect(Object.keys(toRecord(odd as never)!)).toEqual(PLAIN_KEYS)
  })

  it('marks become per-character styles and read back exactly, including after an emoji', () => {
    // "😀 bold it": the emoji is code units 0..2 but ONE character on the canvas.
    const rec = text({ text: '😀 bold it', spans: [{ start: 3, end: 7, bold: true, underline: true }, { start: 8, end: 10, italic: true, strike: true }] })
    const tb = tbOf(make(rec))
    const b = { fontWeight: 'bold', underline: true }
    const i = { fontStyle: 'italic', linethrough: true }
    expect(tb.styles).toEqual({ 0: { 2: b, 3: b, 4: b, 5: b, 7: i, 8: i } })
    expect(toRecord(tb as never)).toEqual(rec)
  })

  it('a span across a line break is keyed by paragraph, not by offset', () => {
    const rec = text({ text: 'ab\ncd', spans: [{ start: 1, end: 4, italic: true }] })
    const tb = tbOf(make(rec))
    expect(tb.styles).toEqual({ 0: { 1: { fontStyle: 'italic' } }, 1: { 0: { fontStyle: 'italic' } } })
    expect(toRecord(tb as never)).toEqual(rec)
  })

  it('headings: every character of the line, and a placeholder on an empty heading line, at the heading size and bold', () => {
    const rec = text({ text: 'Hi\n\nbody\nSub', headings: [1, 2, 0, 3], spans: [{ start: 4, end: 8, italic: true }] })
    const tb = tbOf(make(rec))
    const h = (size: number) => ({ fontSize: size, fontWeight: 'bold' })
    const ital = { fontStyle: 'italic' }
    expect(tb.styles).toEqual({
      0: { 0: h(48), 1: h(48) },
      1: { 0: h(36) }, // the empty line: Fabric takes its height, and the first typed character's style, from here
      2: { 0: ital, 1: ital, 2: ital, 3: ital },
      3: { 0: h(30), 1: h(30), 2: h(30) },
    })
    expect(toRecord(tb as never)).toEqual(rec)
  })

  it('an empty heading line at the end and a heading only on a later paragraph round-trip', () => {
    for (const rec of [text({ text: 'a\n', headings: [0, 1] }), text({ text: 'a\nb\nc', headings: [0, 0, 2] })]) {
      expect(toRecord(make(rec))).toEqual(rec)
    }
  })

  it('a font-size style that matches no heading level is not a heading; bold in a heading line is implied', () => {
    const tb = tbOf(make(text({ text: 'ab\ncd' })))
    const h1 = { fontSize: 48, fontWeight: 'bold' }
    tb.styles = { 0: { 0: { fontSize: 40 }, 1: { fontSize: 40 } }, 1: { 0: h1, 1: h1 } }
    expect(toRecord(tb as never)).toEqual(text({ text: 'ab\ncd', headings: [0, 1] }))
  })

  it('folding a scale and setting the font size redraw headings at their ratio and keep the record', () => {
    const rec = text({ text: 'Big\nsmall', headings: [2], spans: [{ start: 4, end: 9, bold: true }] })
    const tb = tbOf(make(rec))
    Object.assign(tb, { scaleX: 1.5, scaleY: 1.5 })
    expect(toRecord(tb as never)).toEqual({ ...rec, fontSize: 36, width: 300 }) // mid-gesture: read at the scale shown
    normalizeTextScale(tb as never)
    expect(tb.fontSize).toBe(36)
    const h2 = { fontSize: 54, fontWeight: 'bold' }
    expect(tb.styles[0]).toEqual({ 0: h2, 1: h2, 2: h2 })
    expect(toRecord(tb as never)).toEqual({ ...rec, fontSize: 36, width: 300 })

    setTextFontSize(tb as never, 10)
    expect(tb.styles[0]![0]).toEqual({ fontSize: 15, fontWeight: 'bold' })
    expect(toRecord(tb as never)).toEqual({ ...rec, fontSize: 10, width: 300 })
  })

  it('reconciling rewrites non-canonical styles (two sizes in one paragraph, stray entries) and nothing else', () => {
    const tb = tbOf(make(text({ text: 'Titlebody', headings: [1] })))
    // What Fabric leaves after Backspace merged a body line into a heading line, plus a stale entry past the end.
    const h1 = { fontSize: 48, fontWeight: 'bold' }
    tb.styles = { 0: { 0: h1, 1: h1, 2: h1, 3: h1, 4: h1, 12: { fontStyle: 'italic' } } }
    const before = { left: tb.left, top: tb.top, text: tb.text }
    expect(reconcileTextFormatting(tb as never)).toBe(true)
    expect(Object.keys(tb.styles[0]!)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8'])
    for (const st of Object.values(tb.styles[0]!)) expect(st).toEqual(h1)
    expect({ left: tb.left, top: tb.top, text: tb.text }).toEqual(before)
    expect(reconcileTextFormatting(tb as never)).toBe(false) // canonical now: nothing to do
    expect(reconcileTextFormatting(make(text()) as never)).toBe(false)
  })
})
