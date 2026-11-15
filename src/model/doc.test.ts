import { describe, expect, it } from 'vitest'
import { createEmptyDoc, normalizeTitle, objectsEqual, parseDoc, referencedAssetIds } from './doc.ts'
import type { BoardDoc, ObjectRecord } from './types.ts'

const text: ObjectRecord = { type: 'text', id: 't1', left: 1, top: 2, angle: 0, text: 'hi', fontSize: 24, width: 200 }
const image: ObjectRecord = { type: 'image', id: 'i1', left: 5, top: 6, angle: 15, assetId: 'asset-1', scaleX: 0.5, scaleY: 0.5 }
const good = (): BoardDoc => ({ ...createEmptyDoc(), title: 'Mine', objects: [image, text], viewport: { zoom: 2, panX: 10, panY: -4 } })

describe('parseDoc', () => {
  it('round-trips a valid document through JSON', () => {
    const doc = good()
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('rejects non-objects, wrong versions and bad object lists', () => {
    expect(parseDoc(null)).toBeNull()
    expect(parseDoc('x')).toBeNull()
    expect(parseDoc([])).toBeNull()
    expect(parseDoc({ ...good(), version: 2 })).toBeNull()
    expect(parseDoc({ ...good(), objects: 'nope' })).toBeNull()
  })

  it('rejects the whole document when any object is malformed (never partially loads)', () => {
    expect(parseDoc({ ...good(), objects: [text, { ...image, assetId: 5 }] })).toBeNull()
    expect(parseDoc({ ...good(), objects: [{ ...text, fontSize: 0 }] })).toBeNull()
    expect(parseDoc({ ...good(), objects: [{ ...text, left: Number.NaN }] })).toBeNull()
    expect(parseDoc({ ...good(), objects: [{ ...text, type: 'blob' }] })).toBeNull()
    expect(parseDoc({ ...good(), objects: [text, { ...image, id: 't1' }] })).toBeNull()
  })

  it('strips unknown fields', () => {
    const parsed = parseDoc({ ...good(), objects: [{ ...text, evil: '<script>' }] })
    expect(parsed?.objects[0]).not.toHaveProperty('evil')
  })

  it('falls back to defaults for a bad title or viewport', () => {
    const parsed = parseDoc({ ...good(), title: '   ', viewport: { zoom: 1000, panX: 0, panY: 0 } })
    expect(parsed?.title).toBe('Untitled board')
    expect(parsed?.viewport).toEqual({ zoom: 1, panX: 0, panY: 0 })
    expect(parseDoc({ ...good(), viewport: undefined })?.viewport.zoom).toBe(1)
  })
})

describe('helpers', () => {
  it('collects referenced asset ids', () => {
    expect([...referencedAssetIds([image, text, { ...image, id: 'i2' }])]).toEqual(['asset-1'])
  })

  it('compares object lists structurally', () => {
    expect(objectsEqual([text], [{ ...text }])).toBe(true)
    expect(objectsEqual([text], [{ ...text, left: 2 }])).toBe(false)
    expect(objectsEqual([text, image], [image, text])).toBe(false)
  })

  it('normalizes titles', () => {
    expect(normalizeTitle('  My   board ')).toBe('My board')
    expect(normalizeTitle('')).toBe('Untitled board')
    expect(normalizeTitle('x'.repeat(500))).toHaveLength(120)
  })
})
