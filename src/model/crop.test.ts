import { describe, expect, it } from 'vitest'
import {
  MIN_CROP_SCENE,
  clampCrop,
  croppedPlacement,
  displayBox,
  dragCropRect,
  fillRecord,
  fitInsideScale,
  fitRecord,
  hitCropHandle,
  isWholeImage,
  largestCentredCrop,
  minCropSide,
  roundCrop,
  sceneToSource,
  sourceToScene,
  uncroppedPlacement,
} from './crop.ts'
import type { Placement } from './crop.ts'
import type { ImageRecord } from './types.ts'

const SIZE = { width: 400, height: 200 }
const img = (extra: Partial<ImageRecord> = {}): ImageRecord => ({ type: 'image', id: 'i', assetId: 'a', left: 100, top: 50, angle: 0, scaleX: 1, scaleY: 1, ...extra })
const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}

describe('source pixels and the board', () => {
  const placements: Placement[] = [
    { left: 10, top: 20, angle: 0, scaleX: 1, scaleY: 1 },
    { left: -5, top: 300, angle: 30, scaleX: 0.5, scaleY: 0.5 },
    { left: 77, top: -12, angle: -135, scaleX: 2, scaleY: 0.75 },
  ]
  it.each(placements)('sceneToSource inverts sourceToScene (%o)', (at) => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 400, y: 200 },
      { x: 123.4, y: 56.7 },
    ]) {
      close(sceneToSource(sourceToScene(p, at), at), p)
    }
  })

  it('source (0, 0) is the placement point, and a rotation turns the source axes', () => {
    const at: Placement = { left: 10, top: 20, angle: 90, scaleX: 2, scaleY: 2 }
    close(sourceToScene({ x: 0, y: 0 }, at), { x: 10, y: 20 })
    // Rotated 90° clockwise: the source x axis points down the board.
    close(sourceToScene({ x: 5, y: 0 }, at), { x: 10, y: 30 })
    close(sourceToScene({ x: 0, y: 5 }, at), { x: 0, y: 20 })
  })

  it('opening and applying a crop keep the kept pixels where they are, rotated and scaled', () => {
    const shown: Placement = { left: 200, top: 100, angle: 30, scaleX: 0.5, scaleY: 0.5 }
    const crop = { x: 40, y: 30 }
    const full = uncroppedPlacement(shown, crop)
    // The crop's corner in source pixels lands exactly on the displayed top-left.
    close(sourceToScene(crop, full), { x: shown.left, y: shown.top })
    // Any kept pixel: same scene point through either placement.
    const pixel = { x: 90, y: 70 }
    const viaShown = { x: shown.left, y: shown.top }
    const d = sourceToScene({ x: pixel.x - crop.x, y: pixel.y - crop.y }, { ...shown, left: 0, top: 0 })
    close(sourceToScene(pixel, full), { x: viaShown.x + d.x, y: viaShown.y + d.y })
    // And back.
    const again = croppedPlacement(full, crop)
    close({ x: again.left, y: again.top }, { x: shown.left, y: shown.top })
    expect(again).toMatchObject({ angle: 30, scaleX: 0.5, scaleY: 0.5 })
  })
})

describe('the whole image, clamping and rounding', () => {
  it('a crop within the tolerance of every edge is the whole image', () => {
    expect(isWholeImage(undefined, SIZE)).toBe(true)
    expect(isWholeImage({ x: 0, y: 0, width: 400, height: 200 }, SIZE)).toBe(true)
    expect(isWholeImage({ x: 0.005, y: 0, width: 399.995, height: 200.004 }, SIZE)).toBe(true)
    expect(isWholeImage({ x: 0.1, y: 0, width: 399.9, height: 200 }, SIZE)).toBe(false)
    expect(isWholeImage({ x: 0, y: 0, width: 400, height: 199 }, SIZE)).toBe(false)
  })

  it('clamps a stored crop to the decoded image; nothing left, or the whole image, is no crop', () => {
    expect(clampCrop(undefined, SIZE)).toBeUndefined()
    expect(clampCrop({ x: 10, y: 10, width: 100, height: 50 }, SIZE)).toEqual({ x: 10, y: 10, width: 100, height: 50 })
    expect(clampCrop({ x: 300, y: 150, width: 500, height: 500 }, SIZE)).toEqual({ x: 300, y: 150, width: 100, height: 50 })
    expect(clampCrop({ x: 400, y: 0, width: 10, height: 10 }, SIZE)).toBeUndefined()
    expect(clampCrop({ x: 900, y: 900, width: 10, height: 10 }, SIZE)).toBeUndefined()
    expect(clampCrop({ x: 0, y: 0, width: 1000, height: 1000 }, SIZE)).toBeUndefined()
  })

  it('rounds positions to 2 decimals and keeps sizes positive', () => {
    expect(roundCrop({ x: 1.23456, y: 0.004, width: 10.005001, height: 0.001 })).toEqual({ x: 1.23, y: 0, width: 10.01, height: 0.001 })
  })
})

describe('handles', () => {
  const rect = { x: 100, y: 50, width: 200, height: 100 }
  it('finds corners first, then sides along the border, then the inside', () => {
    expect(hitCropHandle({ x: 103, y: 47 }, rect, 8, 8)).toBe('tl')
    expect(hitCropHandle({ x: 300, y: 150 }, rect, 8, 8)).toBe('br')
    expect(hitCropHandle({ x: 297, y: 55 }, rect, 8, 8)).toBe('tr')
    expect(hitCropHandle({ x: 100, y: 150 }, rect, 8, 8)).toBe('bl')
    expect(hitCropHandle({ x: 200, y: 52 }, rect, 8, 8)).toBe('t')
    expect(hitCropHandle({ x: 150, y: 146 }, rect, 8, 8)).toBe('b')
    expect(hitCropHandle({ x: 94, y: 100 }, rect, 8, 8)).toBe('l')
    expect(hitCropHandle({ x: 306, y: 120 }, rect, 8, 8)).toBe('r')
    expect(hitCropHandle({ x: 200, y: 100 }, rect, 8, 8)).toBe('move')
    expect(hitCropHandle({ x: 50, y: 100 }, rect, 8, 8)).toBeNull()
    expect(hitCropHandle({ x: 200, y: 170 }, rect, 8, 8)).toBeNull()
    // Beyond the border band along an axis: not a side.
    expect(hitCropHandle({ x: 320, y: 100 }, rect, 8, 8)).toBeNull()
  })

  it('uses a separate tolerance per axis (a fixed screen distance at a non-uniform scale)', () => {
    expect(hitCropHandle({ x: 100 - 15, y: 100 }, rect, 20, 2)).toBe('l')
    expect(hitCropHandle({ x: 200, y: 50 - 15 }, rect, 20, 2)).toBeNull()
  })

  it('a box smaller than the tolerance still gives the nearer edge', () => {
    const tiny = { x: 10, y: 10, width: 4, height: 4 }
    expect(hitCropHandle({ x: 10.5, y: 10.5 }, tiny, 8, 8)).toBe('tl')
    expect(hitCropHandle({ x: 13.5, y: 13.5 }, tiny, 8, 8)).toBe('br')
  })
})

describe('dragging the crop rectangle', () => {
  const start = { x: 100, y: 50, width: 200, height: 100 }
  it('moves the whole box, clamped inside the image', () => {
    expect(dragCropRect(start, 'move', 30, -20, SIZE, 8, 8)).toEqual({ x: 130, y: 30, width: 200, height: 100 })
    expect(dragCropRect(start, 'move', 1000, 1000, SIZE, 8, 8)).toEqual({ x: 200, y: 100, width: 200, height: 100 })
    expect(dragCropRect(start, 'move', -1000, -1000, SIZE, 8, 8)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })

  it('a side moves only its own edge; a corner moves two; free aspect', () => {
    expect(dragCropRect(start, 'l', 20, 999, SIZE, 8, 8)).toEqual({ x: 120, y: 50, width: 180, height: 100 })
    expect(dragCropRect(start, 'r', 40, 0, SIZE, 8, 8)).toEqual({ x: 100, y: 50, width: 240, height: 100 })
    expect(dragCropRect(start, 't', 0, -30, SIZE, 8, 8)).toEqual({ x: 100, y: 20, width: 200, height: 130 })
    expect(dragCropRect(start, 'b', 0, 10, SIZE, 8, 8)).toEqual({ x: 100, y: 50, width: 200, height: 110 })
    expect(dragCropRect(start, 'tl', -10, 20, SIZE, 8, 8)).toEqual({ x: 90, y: 70, width: 210, height: 80 })
    expect(dragCropRect(start, 'br', -50, 30, SIZE, 8, 8)).toEqual({ x: 100, y: 50, width: 150, height: 130 })
  })

  it('never leaves the image', () => {
    expect(dragCropRect(start, 'tl', -500, -500, SIZE, 8, 8)).toEqual({ x: 0, y: 0, width: 300, height: 150 })
    expect(dragCropRect(start, 'br', 500, 500, SIZE, 8, 8)).toEqual({ x: 100, y: 50, width: 300, height: 150 })
  })

  it('never flips and keeps the minimum size, whichever way a handle is dragged past its anchor', () => {
    expect(dragCropRect(start, 'l', 500, 0, SIZE, 8, 6)).toEqual({ x: 292, y: 50, width: 8, height: 100 })
    expect(dragCropRect(start, 'r', -500, 0, SIZE, 8, 6)).toEqual({ x: 100, y: 50, width: 8, height: 100 })
    expect(dragCropRect(start, 't', 0, 500, SIZE, 8, 6)).toEqual({ x: 100, y: 144, width: 200, height: 6 })
    expect(dragCropRect(start, 'b', 0, -500, SIZE, 8, 6)).toEqual({ x: 100, y: 50, width: 200, height: 6 })
    expect(dragCropRect(start, 'br', -999, -999, SIZE, 8, 6)).toEqual({ x: 100, y: 50, width: 8, height: 6 })
  })

  it('the minimum side is 8 scene units as displayed, at least one source pixel, capped by the image and the starting side', () => {
    expect(minCropSide(1, 400, 200)).toBe(MIN_CROP_SCENE)
    expect(minCropSide(0.5, 400, 200)).toBe(16) // a half-size image: 16 source pixels show as 8 units
    expect(minCropSide(4, 400, 200)).toBe(2)
    expect(minCropSide(100, 400, 200)).toBe(1)
    expect(minCropSide(0.01, 400, 200)).toBe(200) // never more than the side was
    expect(minCropSide(0.01, 300, 400)).toBe(300) // nor more than the image
    expect(minCropSide(-0.5, 400, 200)).toBe(16)
  })
})

describe('Fit and Fill maths', () => {
  it('largest centred crop for an aspect ratio', () => {
    expect(largestCentredCrop(SIZE, 1)).toEqual({ x: 100, y: 0, width: 200, height: 200 })
    expect(largestCentredCrop(SIZE, 4)).toEqual({ x: 0, y: 50, width: 400, height: 100 })
    expect(largestCentredCrop(SIZE, 2)).toEqual({ x: 0, y: 0, width: 400, height: 200 })
    expect(largestCentredCrop(SIZE, 0)).toEqual({ x: 0, y: 0, width: 400, height: 200 })
  })

  it('fit-inside scale', () => {
    expect(fitInsideScale(SIZE, { width: 200, height: 200 })).toBe(0.5)
    expect(fitInsideScale(SIZE, { width: 800, height: 100 })).toBe(0.5)
  })

  it('the displayed box of a record, cropped and rotated', () => {
    expect(displayBox(img(), SIZE)).toEqual({ centre: { x: 300, y: 150 }, width: 400, height: 200, angle: 0 })
    const b = displayBox(img({ crop: { x: 10, y: 10, width: 100, height: 60 }, scaleX: 2, scaleY: 2 }), SIZE)
    expect(b).toMatchObject({ width: 200, height: 120 })
    expect(b.centre).toEqual({ x: 200, y: 110 })
    const r = displayBox(img({ angle: 90 }), SIZE)
    close(r.centre, { x: 0, y: 250 })
  })

  it('Fill keeps the box exactly and covers it with the largest centred crop at one scale', () => {
    // An off-centre square crop of a 400x200 image, shown at 0.5: a 50x50 box.
    const rec = img({ crop: { x: 0, y: 0, width: 100, height: 100 }, scaleX: 0.5, scaleY: 0.5 })
    const out = fillRecord(rec, SIZE)
    expect(out.crop).toEqual({ x: 100, y: 0, width: 200, height: 200 })
    expect(out.scaleX).toBe(0.25)
    expect(out.scaleY).toBe(0.25)
    expect(displayBox(out, SIZE)).toEqual(displayBox(rec, SIZE))
    expect(out).toMatchObject({ id: 'i', assetId: 'a', angle: 0 })
  })

  it('Fill makes a non-uniform scale uniform and keeps a rotated box exactly', () => {
    const rec = img({ angle: 30, scaleX: 1, scaleY: 0.5 }) // shown 400x100
    const out = fillRecord(rec, SIZE)
    expect(out.crop).toEqual({ x: 0, y: 50, width: 400, height: 100 })
    expect(out.scaleX).toBe(1)
    expect(out.scaleY).toBe(1)
    const a = displayBox(rec, SIZE)
    const b = displayBox(out, SIZE)
    close(b.centre, a.centre, 2)
    expect(b.width).toBeCloseTo(a.width, 6)
    expect(b.height).toBeCloseTo(a.height, 6)
  })

  it('Fill of an uncropped image at a uniform scale changes nothing (no crop key)', () => {
    const rec = img({ scaleX: 0.3, scaleY: 0.3 })
    const out = fillRecord(rec, SIZE)
    expect(out).toEqual(rec)
    expect(out).not.toHaveProperty('crop')
  })

  it('Fit shows the whole image inside the box, centred, same angle, and removes the crop', () => {
    const rec = img({ crop: { x: 100, y: 0, width: 200, height: 200 }, scaleX: 1, scaleY: 1 }) // a 200x200 box
    const out = fitRecord(rec, SIZE)
    expect(out).not.toHaveProperty('crop')
    expect(out.scaleX).toBe(0.5)
    expect(out.scaleY).toBe(0.5)
    const before = displayBox(rec, SIZE)
    const after = displayBox(out, SIZE)
    expect(after.centre).toEqual(before.centre)
    expect(after).toMatchObject({ width: 200, height: 100, angle: 0 })
    expect(out.left).toBe(100)
    expect(out.top).toBe(100)
  })

  it('Fit keeps a rotated box centred', () => {
    const rec = img({ angle: 30, crop: { x: 100, y: 0, width: 200, height: 200 } })
    const out = fitRecord(rec, SIZE)
    close(displayBox(out, SIZE).centre, displayBox(rec, SIZE).centre, 2)
    expect(out.angle).toBe(30)
  })

  it('Fit of an uncropped image at a uniform scale changes nothing', () => {
    expect(fitRecord(img({ scaleX: 0.3, scaleY: 0.3 }), SIZE)).toEqual(img({ scaleX: 0.3, scaleY: 0.3 }))
  })

  it('does not change the record it is given', () => {
    const rec = img({ crop: { x: 0, y: 0, width: 100, height: 100 } })
    const copy = structuredClone(rec)
    fillRecord(rec, SIZE)
    fitRecord(rec, SIZE)
    expect(rec).toEqual(copy)
  })
})
