/**
 * Real-browser tests (real Fabric, real IndexedDB) for frames.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  AUTOSAVE_QUIET_MS,
  dbVersion,
  drag,
  openApp,
  openBlank,
  redoButton,
  sceneToPage,
  seedMilestone1,
  seedRaw,
  snapshotIdb,
  status,
  storedDoc,
  undoButton,
  waitSaved,
} from './helpers.ts'
import type { StoredBoard, View } from './helpers.ts'

const FRAME = { id: 'f1', name: 'Cover', left: 100, top: 100, width: 400, height: 300 }

/** RGBA of one pixel of the scene canvas, at a position given in canvas (CSS) pixels. */
function pixel(page: Page, x: number, y: number): Promise<[number, number, number, number]> {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas.lower-canvas')
      if (!canvas) throw new Error('scene canvas not found')
      const scale = canvas.width / canvas.clientWidth // device pixel ratio
      const d = canvas.getContext('2d')!.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data
      return [d[0]!, d[1]!, d[2]!, d[3]!] as [number, number, number, number]
    },
    { x, y },
  )
}

/** Counts pixels in a canvas-pixel rectangle that are neither transparent nor white (i.e. drawn chrome). */
function inkIn(page: Page, left: number, top: number, width: number, height: number): Promise<number> {
  return page.evaluate(
    ({ left, top, width, height }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas.lower-canvas')
      if (!canvas) throw new Error('scene canvas not found')
      const scale = canvas.width / canvas.clientWidth
      const d = canvas.getContext('2d')!.getImageData(left * scale, top * scale, width * scale, height * scale).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 40 && (d[i]! < 235 || d[i + 1]! < 235 || d[i + 2]! < 235)) n++
      return n
    },
    { left, top, width, height },
  )
}

test.describe('drawing a stored frame', () => {
  for (const view of [
    { zoom: 1, panX: 0, panY: 0 },
    { zoom: 0.5, panX: 200, panY: 100 },
    { zoom: 2, panX: -150, panY: -120 },
  ] satisfies View[]) {
    test(`white paper, outline and label follow the frame at zoom ${view.zoom}`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await openBlank(page)
      await seedRaw(page, 2, { version: 2, title: 'Framed', frames: [FRAME], objects: [], viewport: view })
      await page.goto('/')
      await expect(page.locator('.toolbar')).toBeVisible()

      const x = (sceneX: number) => sceneX * view.zoom + view.panX
      const y = (sceneY: number) => sceneY * view.zoom + view.panY
      const left = x(FRAME.left)
      const top = y(FRAME.top)
      const right = x(FRAME.left + FRAME.width)
      const bottom = y(FRAME.top + FRAME.height)
      const midX = (left + right) / 2
      const midY = (top + bottom) / 2

      await expect.poll(() => pixel(page, midX, midY)).toEqual([255, 255, 255, 255]) // paper
      expect((await pixel(page, left - 12, midY))[3]).toBe(0) // nothing outside the frame
      expect((await pixel(page, midX, bottom + 12))[3]).toBe(0)

      // A one-pixel outline exactly on each edge of the frame, whatever the zoom.
      for (const [px, py] of [
        [midX, top],
        [midX, bottom],
        [left, midY],
        [right, midY],
      ] as const) {
        const [r, g, b, a] = await pixel(page, px, py)
        expect(a, `edge at ${px},${py}`).toBeGreaterThan(200)
        expect(r + g + b, `edge at ${px},${py}`).toBeLessThan(720) // not paper white
      }
      expect(await pixel(page, midX, top + 2)).toEqual([255, 255, 255, 255]) // and only one pixel thick
      expect(await pixel(page, left + 2, midY)).toEqual([255, 255, 255, 255])
      expect((await pixel(page, midX, top - 2))[3]).toBe(0)
      expect((await pixel(page, left - 2, midY))[3]).toBe(0)

      // The label sits just above the top-left corner, at a fixed screen size.
      expect(await inkIn(page, Math.round(left), Math.round(top) - 24, 60, 20)).toBeGreaterThan(20)
      expect(await inkIn(page, Math.round(left) + 120, Math.round(top) - 24, 60, 20)).toBe(0) // nothing beside it
      expect(errors).toEqual([])
    })
  }
})

// =================================================================================================
// Editing frames
// =================================================================================================

const PIC = { id: 'a1', name: 'pic.png', width: 200, height: 120 }
const image = (id: string, left: number, top: number, extra: Record<string, unknown> = {}) => ({
  type: 'image',
  id,
  left,
  top,
  angle: 0,
  assetId: 'a1',
  scaleX: 1,
  scaleY: 1,
  ...extra,
})
const frameRec = (id: string, left: number, top: number, width: number, height: number, name = id) => ({ id, name, left, top, width, height })
const UNIT: View = { zoom: 1, panX: 0, panY: 0 }

interface Opened {
  errors: string[]
  /** Scene coordinates -> page coordinates. */
  at: (x: number, y: number) => { x: number; y: number }
}

/** Opens the app on a seeded board with frames (a version 2 database). */
async function openFramed(page: Page, frames: unknown[], objects: unknown[], view: View = UNIT): Promise<Opened> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openBlank(page)
  await seedRaw(page, 2, { version: 2, title: 'Frames', frames, objects, viewport: view }, [PIC])
  await openApp(page)
  return { errors, at: await sceneToPage(page, view) }
}

/** Opens the app on a board written by the frozen milestone 1 store (version 1 database, no frames). */
async function openLegacy(page: Page, objects: unknown[], view: View = UNIT): Promise<Opened> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openBlank(page)
  await seedMilestone1(page, { version: 1, title: 'Legacy', objects, viewport: view }, [PIC])
  await openApp(page)
  return { errors, at: await sceneToPage(page, view) }
}

/** A point on a frame's label: just above its top-left corner, in screen pixels. */
const labelOf = (o: Opened, f: { left: number; top: number }) => {
  const corner = o.at(f.left, f.top)
  return { x: corner.x + 10, y: corner.y - 14 }
}
const title = (page: Page) => page.locator('.inspector-title')
const obj = (doc: StoredBoard, id: string) => {
  const found = doc.objects.find((o) => o.id === id)
  if (!found) throw new Error(`no stored object ${id}`)
  return found
}
const frameOf = (doc: StoredBoard, id: string) => {
  const found = (doc.frames ?? []).find((f) => f.id === id)
  if (!found) throw new Error(`no stored frame ${id}`)
  return found
}
/** Waits until the stored board satisfies `check`, then returns it. */
async function storedWhen(page: Page, check: (doc: StoredBoard) => boolean): Promise<StoredBoard> {
  await expect.poll(async () => check(await storedDoc(page)), { timeout: 5000 }).toBe(true)
  return storedDoc(page)
}

test.describe('drawing a frame with the Frame tool', () => {
  test('a frame drawn round images owns nothing; moving the images afterwards makes them members; reload is identical', async ({ page }) => {
    const o = await openLegacy(page, [image('i1', 300, 200), image('i2', 560, 260)])
    expect(await dbVersion(page)).toBe(1)

    await page.keyboard.press('f')
    await drag(page, o.at(250, 150), o.at(820, 450))
    await expect(title(page)).toHaveText('Frame') // created, selected, back in the Select tool
    await waitSaved(page)
    const drawn = await storedWhen(page, (d) => (d.frames ?? []).length === 1)
    expect(drawn.version).toBe(2)
    expect(await dbVersion(page)).toBe(2) // the first framed save promoted the database
    expect(drawn.frames![0]).toMatchObject({ name: 'Frame 1', left: 250, top: 150, width: 570, height: 300 })
    expect(drawn.objects.map((x) => x.frameId)).toEqual([undefined, undefined]) // drawing a frame adopts nothing
    expect(drawn.objects.map((x) => x.id)).toEqual(['i1', 'i2']) // and the frame is not among the content

    // Marquee the two images (the selected frame's interior is click-through) and nudge them.
    await drag(page, o.at(262, 162), o.at(800, 440))
    await expect(title(page)).toHaveText('2 objects')
    await drag(page, o.at(400, 260), o.at(410, 268))
    const frameId = drawn.frames![0]!.id
    const owned = await storedWhen(page, (d) => d.objects.every((x) => x.frameId === frameId))
    expect(obj(owned, 'i1')).toMatchObject({ left: 310, top: 208 })
    expect(obj(owned, 'i2')).toMatchObject({ left: 570, top: 268 })
    await waitSaved(page)

    const before = await snapshotIdb(page)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await snapshotIdb(page)).toEqual(before) // loading rewrote nothing
    await expect(undoButton(page)).toBeDisabled()
    expect(o.errors).toEqual([])
  })

  test('Esc mid-draft: no frame, nothing stored, Undo stays disabled, and a new draft then works', async ({ page }) => {
    const o = await openLegacy(page, [image('i1', 300, 200)])
    const before = await snapshotIdb(page)
    await page.keyboard.press('f')
    await drag(page, o.at(600, 150), o.at(900, 400), { hold: true })
    await page.keyboard.press('Escape')
    await page.mouse.move(o.at(950, 450).x, o.at(950, 450).y, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await snapshotIdb(page)).toEqual(before)
    expect(await dbVersion(page)).toBe(1)
    await expect(undoButton(page)).toBeDisabled()
    await expect(page.locator('.inspector')).toHaveCount(0)

    await page.keyboard.press('f')
    await drag(page, o.at(600, 150), o.at(900, 400))
    await expect(title(page)).toHaveText('Frame')
    const doc = await storedWhen(page, (d) => (d.frames ?? []).length === 1)
    expect(doc.frames![0]).toMatchObject({ left: 600, top: 150, width: 300, height: 250 })
    expect(o.errors).toEqual([])
  })

  test('F then the right button, clicked or dragged, creates nothing and writes nothing; a primary drag then draws', async ({ page }) => {
    const o = await openLegacy(page, [image('i1', 300, 200)])
    const before = await snapshotIdb(page)
    await page.keyboard.press('f')
    const p = o.at(650, 200)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down({ button: 'right' }) // press and release
    await page.mouse.up({ button: 'right' })
    await page.mouse.down({ button: 'right' }) // a right-button drag
    await page.mouse.move(p.x + 200, p.y + 150, { steps: 5 })
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    const after = await snapshotIdb(page)
    expect(after).toEqual(before) // byte-equal document, same updatedAt, same assets
    expect(await dbVersion(page)).toBe(1)
    await expect(undoButton(page)).toBeDisabled()
    expect(JSON.parse(after.doc).frames).toBeUndefined()

    await drag(page, p, { x: p.x + 200, y: p.y + 150 }) // the tool is still armed for the primary button
    await expect(title(page)).toHaveText('Frame')
    await storedWhen(page, (d) => (d.frames ?? []).length === 1)
    expect(o.errors).toEqual([])
  })

  test('a plain click with the Frame tool makes a default frame of 640 x 480 screen pixels', async ({ page }) => {
    const view: View = { zoom: 0.5, panX: 100, panY: 60 }
    const o = await openLegacy(page, [image('i1', 100, 100)], view)
    await page.keyboard.press('f')
    const p = o.at(600, 300)
    await page.mouse.click(p.x, p.y)
    const doc = await storedWhen(page, (d) => (d.frames ?? []).length === 1)
    expect(doc.frames![0]).toMatchObject({ left: 600, top: 300, width: 1280, height: 960 })
  })
})

test.describe('hit testing and selection precedence', () => {
  // Zoomed out and panned, so nothing here is at default coordinates.
  const view: View = { zoom: 0.5, panX: 100, panY: 60 }
  const A = frameRec('A', 200, 200, 800, 600)
  const B = frameRec('B', 1400, 200, 400, 300)
  const C = frameRec('C', 1400, 800, 300, 200)
  const D = frameRec('D', 1400, 800, 300, 200) // exactly on top of C, and in front of it
  const scene = (): [unknown[], unknown[]] => [
    [A, B, C, D],
    [
      image('bleed', 100, 100, { scaleX: 6, scaleY: 6 }), // 1200 x 720: covers all of A and its label
      image('small', 1500, 300, { scaleX: 0.5, scaleY: 0.5 }), // 100 x 60, inside B
    ],
  ]

  test('label and edge win over a full-bleed image on top; the interior belongs to the image', async ({ page }) => {
    const o = await openFramed(page, ...scene(), view)
    const label = labelOf(o, A)
    await page.mouse.click(label.x, label.y)
    await expect(title(page)).toHaveText('Frame')
    await page.keyboard.press('Escape')

    for (const edge of [o.at(600, 200), o.at(1000, 500), o.at(600, 800), o.at(200, 500)]) {
      await page.mouse.click(edge.x, edge.y) // top, right, bottom, left edges, all under the image
      await expect(title(page)).toHaveText('Frame')
      await page.keyboard.press('Escape')
      await expect(page.locator('.inspector')).toHaveCount(0)
    }
    const band = o.at(600, 200)
    await page.mouse.click(band.x, band.y + 5) // 5 screen pixels inside the edge: still the frame
    await expect(title(page)).toHaveText('Frame')
    await page.keyboard.press('Escape')
    await page.mouse.click(band.x, band.y + 9) // 9 screen pixels inside: the image
    await expect(title(page)).toHaveText('Image')
    await page.keyboard.press('Escape')

    const inside = o.at(600, 500)
    await page.mouse.click(inside.x, inside.y)
    await expect(title(page)).toHaveText('Image')
    expect(o.errors).toEqual([])
  })

  test('a selected frame is still click-through: content inside it can be grabbed', async ({ page }) => {
    const o = await openFramed(page, ...scene(), view)
    const label = labelOf(o, B)
    await page.mouse.click(label.x, label.y)
    await expect(title(page)).toHaveText('Frame')
    const small = o.at(1550, 330)
    await page.mouse.click(small.x, small.y)
    await expect(title(page)).toHaveText('Image')
  })

  test('empty interior starts a marquee; a partial marquee excludes the frame, full enclosure includes it', async ({ page }) => {
    const o = await openFramed(page, ...scene(), view)
    // Starts and ends inside B, well clear of its edges, and encloses the small image.
    await drag(page, o.at(1430, 230), o.at(1770, 470))
    await expect(title(page)).toHaveText('Image')
    await page.keyboard.press('Escape')
    await expect(page.locator('.inspector')).toHaveCount(0)

    // Crossing B's edge without enclosing B: still only the image.
    await drag(page, o.at(1350, 280), o.at(1700, 420))
    await expect(title(page)).toHaveText('Image')
    await page.keyboard.press('Escape')

    // Enclosing all of B: the frame is taken too.
    await drag(page, o.at(1360, 130), o.at(1830, 540))
    await expect(title(page)).toHaveText('2 objects')
    await page.keyboard.press('Delete')
    const doc = await storedWhen(page, (d) => d.objects.length === 1)
    expect((doc.frames ?? []).map((f) => f.id)).toEqual(['A', 'C', 'D']) // B went, with the image inside it
    expect(o.errors).toEqual([])
  })

  test('where two frames coincide the front-most one is grabbed', async ({ page }) => {
    const o = await openFramed(page, ...scene(), view)
    const label = labelOf(o, D)
    await page.mouse.click(label.x, label.y)
    await expect(title(page)).toHaveText('Frame')
    await page.keyboard.press('Delete')
    const doc = await storedWhen(page, (d) => (d.frames ?? []).length === 3)
    expect(doc.frames!.map((f) => f.id)).toEqual(['A', 'B', 'C']) // D, the one in front, was the one selected
  })

  test('Shift-click on a label lying over a selected object toggles the frame, not the object', async ({ page }) => {
    const F1 = frameRec('F1', 300, 300, 400, 300)
    // p1 lies over the frame's label (which is at y 276..296) and over its top-left corner.
    const o = await openFramed(page, [F1], [image('p1', 250, 200), image('p2', 800, 500)])
    const p1 = o.at(270, 220)
    const p2 = o.at(900, 560)
    const label = labelOf(o, F1)

    await page.mouse.click(p1.x, p1.y)
    await expect(title(page)).toHaveText('Image')
    await page.keyboard.down('Shift')
    await page.mouse.click(p2.x, p2.y)
    await expect(title(page)).toHaveText('2 objects')
    await page.mouse.click(label.x, label.y) // inside the multi-selection's box, on the frame's label
    await expect(title(page)).toHaveText('3 objects') // the frame was added; both images stay selected
    await page.mouse.click(label.x, label.y)
    await expect(title(page)).toHaveText('2 objects') // and removed again, alone
    await page.keyboard.up('Shift')

    await page.keyboard.press('Delete') // proves WHICH two are left: the images
    const doc = await storedWhen(page, (d) => d.objects.length === 0)
    expect((doc.frames ?? []).map((f) => f.id)).toEqual(['F1'])
    expect(o.errors).toEqual([])
  })
})

test.describe('moving and resizing frames', () => {
  const A = frameRec('A', 300, 200, 400, 300)

  test('dragging a frame by its label moves it and its members by one delta; one undo, one redo', async ({ page }) => {
    const o = await openFramed(page, [A], [image('member', 350, 250, { frameId: 'A' }), image('loose', 800, 500)])
    const before = await storedDoc(page)
    const label = labelOf(o, A)
    await drag(page, label, { x: label.x + 120, y: label.y + 80 })
    const moved = await storedWhen(page, (d) => frameOf(d, 'A').left === 420)
    expect(frameOf(moved, 'A')).toMatchObject({ left: 420, top: 280, width: 400, height: 300 })
    expect(obj(moved, 'member')).toMatchObject({ left: 470, top: 330, frameId: 'A' }) // carried, exactly once
    expect(obj(moved, 'loose')).toEqual(obj(before, 'loose'))

    await undoButton(page).click()
    await expect(undoButton(page)).toBeDisabled() // one step for the frame and everything it carried
    const undone = await storedWhen(page, (d) => frameOf(d, 'A').left === 300)
    expect(undone.frames).toEqual(before.frames)
    expect(undone.objects).toEqual(before.objects)

    await redoButton(page).click()
    const redone = await storedWhen(page, (d) => frameOf(d, 'A').left === 420)
    expect(redone.objects).toEqual(moved.objects)
    expect(o.errors).toEqual([])
  })

  test('a frame selected together with one member: the member moves once, an unselected member is carried once', async ({ page }) => {
    const o = await openFramed(page, [A], [image('picked', 350, 250, { frameId: 'A' }), image('carried', 460, 360, { frameId: 'A', scaleX: 0.5, scaleY: 0.5 })])
    const label = labelOf(o, A)
    await page.mouse.click(label.x, label.y)
    await expect(title(page)).toHaveText('Frame')
    await page.keyboard.down('Shift')
    const picked = o.at(400, 290)
    await page.mouse.click(picked.x, picked.y)
    await page.keyboard.up('Shift')
    await expect(title(page)).toHaveText('2 objects')

    // Dragged by the selected member (inside the selection's box).
    await drag(page, picked, { x: picked.x + 50, y: picked.y + 30 })
    let doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 350)
    expect(frameOf(doc, 'A')).toMatchObject({ left: 350, top: 230 })
    expect(obj(doc, 'picked')).toMatchObject({ left: 400, top: 280, frameId: 'A' }) // once, not twice
    expect(obj(doc, 'carried')).toMatchObject({ left: 510, top: 390, frameId: 'A' }) // carried once
    await expect(title(page)).toHaveText('2 objects')

    // Dragged by the frame's label, which lies outside the selection's box: still the whole selection.
    const moved = { x: label.x + 50, y: label.y + 30 }
    await drag(page, moved, { x: moved.x + 40, y: moved.y + 20 })
    doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 390)
    expect(frameOf(doc, 'A')).toMatchObject({ left: 390, top: 250 })
    expect(obj(doc, 'picked')).toMatchObject({ left: 440, top: 300, frameId: 'A' })
    expect(obj(doc, 'carried')).toMatchObject({ left: 550, top: 410, frameId: 'A' })
    await expect(title(page)).toHaveText('2 objects') // the press on the label did not collapse the selection

    await undoButton(page).click()
    await undoButton(page).click()
    await expect(undoButton(page)).toBeDisabled() // two drags, two steps
    doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 300)
    expect(obj(doc, 'picked')).toMatchObject({ left: 350, top: 250 })
    expect(obj(doc, 'carried')).toMatchObject({ left: 460, top: 360 })
    expect(o.errors).toEqual([])
  })

  test('a frame moved over a loose image does not adopt it; moving the image itself does; reload keeps both states', async ({ page }) => {
    const small = frameRec('A', 100, 200, 300, 250)
    const o = await openFramed(page, [small], [image('pic', 600, 250)]) // centre (700, 310)
    let label = labelOf(o, small)
    await drag(page, label, { x: label.x + 500, y: label.y }) // A is now 600..900 x 200..450: over the image
    let doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 600)
    expect(obj(doc, 'pic')).not.toHaveProperty('frameId')

    label = { x: label.x + 500, y: label.y }
    await drag(page, label, { x: label.x + 20, y: label.y + 20 }) // moved again: the image stays put
    doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 620)
    expect(obj(doc, 'pic')).toMatchObject({ left: 600, top: 250 })
    expect(obj(doc, 'pic')).not.toHaveProperty('frameId')
    await waitSaved(page)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    expect(obj(await storedDoc(page), 'pic')).not.toHaveProperty('frameId') // still loose after a reload

    // Dragging the image a little, inside the frame, is what makes it a member.
    await drag(page, o.at(700, 310), o.at(710, 320))
    doc = await storedWhen(page, (d) => obj(d, 'pic').frameId === 'A')
    expect(obj(doc, 'pic')).toMatchObject({ left: 610, top: 260 })

    label = { x: label.x + 20, y: label.y + 20 }
    await drag(page, label, { x: label.x - 200, y: label.y }) // and now it travels with the frame
    doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 420)
    expect(obj(doc, 'pic')).toMatchObject({ left: 410, top: 260, frameId: 'A' })
    await waitSaved(page)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    expect(obj(await storedDoc(page), 'pic')).toMatchObject({ left: 410, top: 260, frameId: 'A' })
    expect(o.errors).toEqual([])
  })

  test('an owner is sticky: a member in two overlapping frames keeps the back frame through reload, move and undo', async ({ page }) => {
    const back = frameRec('back', 100, 100, 400, 300)
    const front = frameRec('front', 300, 100, 400, 300)
    const o = await openFramed(page, [back, front], [image('s', 320, 180, { frameId: 'back' })]) // centre (420, 240): in the overlap
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    const before = await storedDoc(page)
    expect(obj(before, 's').frameId).toBe('back')

    const label = labelOf(o, back)
    await drag(page, label, { x: label.x + 30, y: label.y + 30 })
    const moved = await storedWhen(page, (d) => frameOf(d, 'back').left === 130)
    expect(obj(moved, 's')).toMatchObject({ left: 350, top: 210, frameId: 'back' }) // carried by its owner, not by the frame in front

    await undoButton(page).click()
    await storedWhen(page, (d) => frameOf(d, 'back').left === 100)
    await waitSaved(page)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    const after = await storedDoc(page)
    expect(after.frames).toEqual(before.frames)
    expect(after.objects).toEqual(before.objects)
  })

  test('a frame resized alone changes freely, leaves its contents alone, and releases what it no longer contains', async ({ page }) => {
    const o = await openFramed(page, [A], [image('member', 350, 250, { frameId: 'A' })]) // centre (450, 310)
    const before = await storedDoc(page)
    const label = labelOf(o, A)
    await page.mouse.click(label.x, label.y)
    await expect(title(page)).toHaveText('Frame')

    await drag(page, o.at(700, 500), o.at(560, 420)) // bottom-right handle: 400 x 300 -> 260 x 220, not proportional
    let doc = await storedWhen(page, (d) => frameOf(d, 'A').width === 260)
    expect(frameOf(doc, 'A')).toEqual({ ...A, width: 260, height: 220 }) // top-left corner fixed
    expect(doc.objects).toEqual(before.objects) // the member did not move, scale, or change owner

    await drag(page, o.at(560, 420), o.at(420, 290)) // 120 x 90: the member's centre is now outside
    doc = await storedWhen(page, (d) => frameOf(d, 'A').width === 120)
    expect(frameOf(doc, 'A')).toEqual({ ...A, width: 120, height: 90 })
    expect(obj(doc, 'member')).toEqual(image('member', 350, 250)) // released, and still exactly where it was

    await drag(page, o.at(420, 290), o.at(800, 600)) // grown back over it: growing never adopts
    doc = await storedWhen(page, (d) => frameOf(d, 'A').width === 500)
    expect(obj(doc, 'member')).not.toHaveProperty('frameId')

    await drag(page, o.at(800, 600), o.at(310, 205)) // squeezed to 10 x 5: each side stops at the minimum
    doc = await storedWhen(page, (d) => frameOf(d, 'A').width === 24)
    expect(frameOf(doc, 'A')).toEqual({ ...A, width: 24, height: 24 })
    expect(o.errors).toEqual([])
  })

  test('deleting the last frame keeps its images and stores a plain board again, in the same database', async ({ page }) => {
    const o = await openFramed(page, [A], [image('member', 350, 250, { frameId: 'A' })])
    const label = labelOf(o, A)
    await page.mouse.click(label.x, label.y)
    await page.keyboard.press('Delete')
    const doc = await storedWhen(page, (d) => d.version === 1)
    expect(doc).not.toHaveProperty('frames')
    expect(doc.objects).toEqual([image('member', 350, 250)]) // the image remains, loose
    expect(await dbVersion(page)).toBe(2) // the database is not demoted

    await undoButton(page).click()
    const back = await storedWhen(page, (d) => d.version === 2)
    expect(obj(back, 'member').frameId).toBe('A') // undo restores the owner
    expect(o.errors).toEqual([])
  })

  for (const button of ['right', 'middle'] as const) {
    test(`a ${button}-button press and release during a label drag does not end the drag`, async ({ page }) => {
      const o = await openFramed(page, [A], [image('member', 350, 250, { frameId: 'A' })])
      const start = labelOf(o, A)
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(start.x + 50, start.y + 20, { steps: 4 })
      await page.mouse.down({ button })
      await page.mouse.move(start.x + 80, start.y + 30, { steps: 4 })
      await page.mouse.up({ button })
      await page.mouse.move(start.x + 110, start.y + 40, { steps: 4 })
      await page.mouse.move(start.x + 110, 10, { steps: 4 }) // outside the canvas
      await page.mouse.move(start.x + 160, start.y + 60, { steps: 4 })
      await page.mouse.up()
      const doc = await storedWhen(page, (d) => frameOf(d, 'A').left === 460)
      expect(frameOf(doc, 'A')).toMatchObject({ left: 460, top: 260 }) // followed the pointer to the end
      expect(obj(doc, 'member')).toMatchObject({ left: 510, top: 310, frameId: 'A' })
      expect(doc.viewport).toEqual(UNIT) // the middle button did not pan

      await waitSaved(page)
      const settled = await snapshotIdb(page)
      await page.mouse.move(start.x + 400, start.y + 300, { steps: 4 }) // after the release nothing follows the pointer
      await page.waitForTimeout(AUTOSAVE_QUIET_MS)
      expect(await snapshotIdb(page)).toEqual(settled)

      await undoButton(page).click()
      await expect(undoButton(page)).toBeDisabled() // exactly one step
      expect(o.errors).toEqual([])
    })
  }
})

test.describe('new text inside a frame', () => {
  test('a text that is opened and abandoned untouched is never stored, even if the view is panned meanwhile', async ({ page }) => {
    const A = frameRec('A', 300, 200, 400, 300)
    const o = await openFramed(page, [A], [])
    await page.keyboard.press('t')
    const p = o.at(360, 260)
    await page.mouse.click(p.x, p.y)
    await page.mouse.wheel(0, 120) // pans: the board is saved for a reason unrelated to the text
    const panned = await storedWhen(page, (d) => d.viewport.panY !== 0)
    expect(panned.objects).toEqual([])
    await page.keyboard.press('Escape')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect((await storedDoc(page)).objects).toEqual([])
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await page.keyboard.press('Control+a')
    await expect(title(page)).toHaveText('Frame') // only the frame: no invisible text came back
    expect(o.errors).toEqual([])
  })

  test('is owned before its first save: after a reload in the middle of typing it belongs to the frame and moves with it', async ({ page }) => {
    const A = frameRec('A', 300, 200, 400, 300)
    const o = await openFramed(page, [A], [])
    await page.keyboard.press('t')
    const p = o.at(360, 260)
    await page.mouse.click(p.x, p.y)
    await page.keyboard.type('typed inside')
    const typed = await storedWhen(page, (d) => d.objects.length === 1 && d.objects[0]!.text === 'typed inside')
    expect(typed.objects[0]).toMatchObject({ type: 'text', frameId: 'A' }) // owner stored by the save made while typing
    await waitSaved(page)

    await page.reload() // without ever leaving the edit
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    const textId = typed.objects[0]!.id
    const left = typed.objects[0]!.left

    const label = labelOf(o, A)
    await drag(page, label, { x: label.x + 100, y: label.y })
    const moved = await storedWhen(page, (d) => frameOf(d, 'A').left === 400)
    expect(obj(moved, textId)).toMatchObject({ left: left + 100, frameId: 'A' })
    expect(o.errors).toEqual([])
  })
})

test.describe('frame panel and toolbar', () => {
  const A = frameRec('A', 300, 200, 400, 300, 'Cover')
  const nameField = (page: Page) => page.getByLabel('Name')
  const itemCount = (page: Page) => page.getByTestId('frame-item-count')
  const withContents = (page: Page) => page.getByRole('button', { name: 'Select with contents' })

  test('the Frame button arms the tool, draws a frame, and releases itself', async ({ page }) => {
    const o = await openLegacy(page, [image('i1', 300, 200)])
    const button = page.getByRole('button', { name: 'Frame', exact: true })
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await button.click() // clicking again puts it away
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await drag(page, o.at(600, 150), o.at(900, 400))
    await expect(button).toHaveAttribute('aria-pressed', 'false') // single-use
    await expect(title(page)).toHaveText('Frame')
    await expect(nameField(page)).toHaveValue('Frame 1')
    await expect(itemCount(page)).toHaveText('Nothing yet')
    await expect(withContents(page)).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Delete frame' })).toBeVisible()
    await storedWhen(page, (d) => (d.frames ?? []).length === 1)
    expect(o.errors).toEqual([])
  })

  test('renaming in the panel: Enter commits, Esc reverts, blank falls back; one undo restores the old name', async ({ page }) => {
    const o = await openFramed(page, [A], [])
    const label = labelOf(o, A)
    await page.mouse.click(label.x, label.y)
    const name = nameField(page)
    await expect(name).toHaveValue('Cover')

    await name.fill('  Back   cover ')
    await name.press('Enter')
    await expect(name).toHaveValue('Back cover') // normalized, and shown as stored
    let doc = await storedWhen(page, (d) => frameOf(d, 'A').name === 'Back cover')
    expect(doc.frames).toEqual([{ ...A, name: 'Back cover' }]) // nothing but the name changed
    await expect(title(page)).toHaveText('Frame') // still selected

    await name.fill('Thrown away')
    await name.press('Escape')
    await expect(name).toHaveValue('Back cover')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(frameOf(await storedDoc(page), 'A').name).toBe('Back cover')

    // Typing a name must not trigger canvas shortcuts (Delete, F, T ...).
    await name.fill('Fit text')
    await name.press('Delete')
    await name.press('Enter')
    doc = await storedWhen(page, (d) => frameOf(d, 'A').name === 'Fit text')
    expect(doc.frames).toHaveLength(1)

    await name.fill('   ')
    await name.press('Enter')
    await expect(name).toHaveValue('Frame')
    await storedWhen(page, (d) => frameOf(d, 'A').name === 'Frame')

    await undoButton(page).click()
    await storedWhen(page, (d) => frameOf(d, 'A').name !== 'Frame')
    expect(o.errors).toEqual([])
  })

  test('double-clicking a frame label puts the cursor in the name field', async ({ page }) => {
    const o = await openFramed(page, [A], [image('member', 350, 250, { frameId: 'A' })])
    const label = labelOf(o, A)
    await page.mouse.dblclick(label.x, label.y)
    await expect(nameField(page)).toBeFocused()
    await page.keyboard.type('Typed over it')
    await page.keyboard.press('Enter')
    await storedWhen(page, (d) => frameOf(d, 'A').name === 'Typed over it')
    await expect(undoButton(page)).toBeEnabled()
    await undoButton(page).click()
    await expect(undoButton(page)).toBeDisabled() // the double-click itself moved nothing and recorded nothing
    expect(o.errors).toEqual([])
  })

  test('the item count shows what a frame owns, not what merely sits inside it', async ({ page }) => {
    const o = await openFramed(page, [A], [image('owned', 320, 220, { frameId: 'A' }), image('guest', 480, 360)]) // both inside A
    const label = labelOf(o, A)
    await page.mouse.click(label.x, label.y)
    await expect(itemCount(page)).toHaveText('1 item')
    await withContents(page).click()
    await expect(title(page)).toHaveText('2 objects') // the frame and the one thing it owns
    await page.keyboard.press('Escape')

    await drag(page, o.at(580, 420), o.at(585, 424)) // nudge the guest: now it belongs
    await storedWhen(page, (d) => obj(d, 'guest').frameId === 'A')
    await page.mouse.click(label.x, label.y)
    await expect(itemCount(page)).toHaveText('2 items')
    expect(o.errors).toEqual([])
  })

  test('Select with contents: frame, a rotated image and a text scale together proportionally, each exactly once', async ({ page }) => {
    const view: View = { zoom: 0.5, panX: 100, panY: 60 }
    const big = frameRec('A', 200, 200, 1000, 700)
    const text = { type: 'text', id: 'txt', left: 300, top: 650, angle: 0, text: 'Caption', fontSize: 40, width: 400, frameId: 'A' }
    const o = await openFramed(
      page,
      [big],
      [image('tilted', 500, 350, { angle: 20, scaleX: 2, scaleY: 2, frameId: 'A' }), text, image('guest', 900, 300)], // "guest" sits inside A but is loose
      view,
    )
    const before = await storedDoc(page)
    const label = labelOf(o, big)
    await page.mouse.click(label.x, label.y)
    await expect(itemCount(page)).toHaveText('2 items')
    await withContents(page).click()
    await expect(title(page)).toHaveText('3 objects')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await storedDoc(page)).toEqual(before) // selecting records nothing
    await expect(undoButton(page)).toBeDisabled()

    // Bottom-right corner of the selection (the frame is its bounding box) dragged inward: 1000 -> 750 wide.
    await drag(page, o.at(1200, 900), o.at(950, 725), { steps: 10 })
    const scaled = await storedWhen(page, (d) => frameOf(d, 'A').width !== 1000)
    const k = frameOf(scaled, 'A').width / 1000
    expect(k).toBeGreaterThan(0.7)
    expect(k).toBeLessThan(0.8)
    const check = (doc: StoredBoard) => {
      const f = frameOf(doc, 'A')
      expect(f.left).toBe(200) // anchored at the selection's top-left corner
      expect(f.top).toBe(200)
      expect(f.height).toBeCloseTo(700 * k, 1) // proportional, although a frame alone would be free
      const img = obj(doc, 'tilted')
      expect(img.scaleX).toBeCloseTo(2 * k, 3) // once, not k squared
      expect(img.scaleY).toBeCloseTo(2 * k, 3)
      expect(img.angle).toBe(20)
      expect(img.left).toBeCloseTo(200 + (500 - 200) * k, 1)
      expect(img.top).toBeCloseTo(200 + (350 - 200) * k, 1)
      const t = obj(doc, 'txt')
      expect(t.fontSize).toBeCloseTo(40 * k, 1) // folded into the font size
      expect(t.width).toBeCloseTo(400 * k, 1)
      expect(t.left).toBeCloseTo(200 + (300 - 200) * k, 1)
      expect(t.top).toBeCloseTo(200 + (650 - 200) * k, 1)
      expect(img.frameId).toBe('A')
      expect(t.frameId).toBe('A')
      expect(obj(doc, 'guest')).toEqual(obj(before, 'guest')) // not part of it: untouched and still loose
    }
    check(scaled)
    await waitSaved(page)

    await page.keyboard.press('Escape') // deselecting changes nothing: scales were folded and baked
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await storedDoc(page)).toEqual(scaled)

    await undoButton(page).click()
    await storedWhen(page, (d) => frameOf(d, 'A').width === 1000)
    expect((await storedDoc(page)).objects).toEqual(before.objects) // exact pre-gesture records
    expect((await storedDoc(page)).frames).toEqual(before.frames)
    await redoButton(page).click()
    await storedWhen(page, (d) => frameOf(d, 'A').width !== 1000)
    expect(await storedDoc(page)).toEqual(scaled)

    await waitSaved(page)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await storedDoc(page)).toEqual(scaled) // no drift from loading

    // The same selection dragged: everything moves once; the loose guest stays.
    const moved = labelOf(o, big)
    await page.mouse.click(moved.x, moved.y)
    await withContents(page).click()
    await expect(title(page)).toHaveText('3 objects')
    const grab = o.at(250, 250)
    await drag(page, grab, { x: grab.x + 40, y: grab.y + 30 }) // 80 x 60 in the scene at zoom 0.5
    const dragged = await storedWhen(page, (d) => frameOf(d, 'A').left === 280)
    expect(frameOf(dragged, 'A')).toMatchObject({ left: 280, top: 260 })
    expect(obj(dragged, 'tilted').left).toBeCloseTo(obj(scaled, 'tilted').left + 80, 1)
    expect(obj(dragged, 'tilted').top).toBeCloseTo(obj(scaled, 'tilted').top + 60, 1)
    expect(obj(dragged, 'txt').left).toBeCloseTo(obj(scaled, 'txt').left + 80, 1)
    expect(obj(dragged, 'txt').top).toBeCloseTo(obj(scaled, 'txt').top + 60, 1)
    expect(obj(dragged, 'guest')).toEqual(obj(before, 'guest'))
    expect(o.errors).toEqual([])
  })
})
