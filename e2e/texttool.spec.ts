/**
 * Real-browser tests (real Fabric, real IndexedDB) for the Text tool's drag: pressing on empty
 * canvas and dragging out a box whose width becomes the wrapping width. What is stored, how
 * the text wraps, the click that still gives the default box, cancelling, other buttons,
 * directions, the minimum width, frames, history and zoom.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { AUTOSAVE_QUIET_MS, drag, openApp, openBlank, redoButton, sceneToPage, seedMilestone1, seedRaw, status, storedDoc, undoButton, waitSaved } from './helpers.ts'
import type { StoredBoard, StoredObject, View } from './helpers.ts'

const UNIT: View = { zoom: 1, panX: 0, panY: 0 }
type Seed = StoredObject & { type: 'text'; text: string; fontSize: number; width: number }
const textRec = (id: string, left: number, top: number, text: string, extra: Partial<Seed> = {}): Seed => ({ type: 'text', id, left, top, angle: 0, text, fontSize: 24, width: 360, ...extra })

async function open(page: Page, objects: unknown[], opts: { view?: View; frames?: unknown[] } = {}) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const view = opts.view ?? UNIT
  await openBlank(page)
  if (opts.frames) await seedRaw(page, 2, { version: 2, title: 'Text tool', frames: opts.frames, objects, viewport: view })
  else await seedMilestone1(page, { version: 1, title: 'Text tool', objects, viewport: view })
  await openApp(page)
  return { errors, at: await sceneToPage(page, view) }
}
async function storedWhen(page: Page, check: (doc: StoredBoard) => boolean): Promise<StoredBoard> {
  await expect.poll(async () => check(await storedDoc(page)), { timeout: 5000 }).toBe(true)
  return storedDoc(page)
}
const texts = (doc: StoredBoard) => doc.objects.filter((o) => o.type === 'text')
const tool = (page: Page, name: string): Locator => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
const editing = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-fabric') === 'textarea')
type P = { x: number; y: number }

/** Dark pixels in a page rectangle of the scene canvas, and their extent. */
function inkIn(page: Page, left: number, top: number, width: number, height: number) {
  return page.evaluate(
    ({ left, top, width, height }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas.lower-canvas')!
      const r = canvas.getBoundingClientRect()
      const scale = canvas.width / canvas.clientWidth
      const w = Math.round(width * scale)
      const d = canvas.getContext('2d')!.getImageData(Math.round((left - r.left) * scale), Math.round((top - r.top) * scale), w, Math.round(height * scale)).data
      const ink = { count: 0, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
      for (let i = 0; i < d.length; i += 4) {
        if (!(d[i + 3]! > 40 && d[i]! < 160 && d[i + 1]! < 160 && d[i + 2]! < 160)) continue
        ink.count++
        const x = left + ((i / 4) % w) / scale
        const y = top + Math.floor(i / 4 / w) / scale
        ink.left = Math.min(ink.left, x)
        ink.right = Math.max(ink.right, x)
        ink.top = Math.min(ink.top, y)
        ink.bottom = Math.max(ink.bottom, y)
      }
      return ink
    },
    { left, top, width, height },
  )
}

/** Pixels of the accent colour (the dashed rectangle being drawn) in a page rectangle of the scene canvas. */
function accentIn(page: Page, left: number, top: number, width: number, height: number) {
  return page.evaluate(
    ({ left, top, width, height }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas.lower-canvas')!
      const r = canvas.getBoundingClientRect()
      const scale = canvas.width / canvas.clientWidth
      const d = canvas.getContext('2d')!.getImageData(Math.round((left - r.left) * scale), Math.round((top - r.top) * scale), Math.round(width * scale), Math.round(height * scale)).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - 0x6c) < 30 && Math.abs(d[i + 1]! - 0x7b) < 30 && Math.abs(d[i + 2]! - 0xf2) < 30) n++
      return n
    },
    { left, top, width, height },
  )
}

test.describe('dragging out a text box', () => {
  test('the stored width is the dragged width in scene units; a long sentence wraps at it; the height is the text\'s', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(400, 400))
    await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true') // single-use
    expect(await editing(page)).toBe(true)
    await page.keyboard.type('a long sentence that has to wrap several times inside this box')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 1)
    expect(Object.keys(done.objects[0]!)).toEqual(['id', 'left', 'top', 'angle', 'type', 'text', 'fontSize', 'width'])
    expect(done.objects[0]).toMatchObject({ left: 100, top: 100, width: 300, fontSize: 24 })
    const p0 = at(90, 90)
    const ink = await inkIn(page, p0.x, p0.y, 600, 400)
    expect(ink.right).toBeLessThanOrEqual(at(401, 0).x) // wrapped at the box's width
    expect(ink.bottom - ink.top).toBeGreaterThan(24 * 1.25 * 2.5) // on at least three lines
    expect(ink.bottom).toBeLessThan(at(0, 100 + 24 * 1.25 * 5).y) // as tall as the text, whatever was dragged
    expect(errors).toEqual([])
  })

  test('a click still gives the default box with exactly the values stored today', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await page.mouse.click(at(300, 300).x, at(300, 300).y)
    await page.keyboard.type('just words')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 1)
    const { id: _id, ...rest } = done.objects[0]!
    void _id
    expect(rest).toEqual({ left: 300, top: 300, angle: 0, type: 'text', text: 'just words', fontSize: 24, width: 240 })
    expect(errors).toEqual([])
  })

  test('a tiny drag (under 4 screen pixels) is a click: the default box at the press point', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(300, 300), at(302, 301), { steps: 2 })
    await page.keyboard.type('x')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 1)
    expect(done.objects[0]).toMatchObject({ left: 300, top: 300, width: 240 })
    expect(errors).toEqual([])
  })

  test('leftward and upward drags; the minimum width grows away from the press point', async ({ page }) => {
    const { errors, at } = await open(page, [])
    const make = async (from: P, to: P, typed: string) => {
      await page.keyboard.press('t')
      await drag(page, from, to)
      await page.keyboard.type(typed)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
    await make(at(500, 300), at(200, 100), 'up left')
    await make(at(600, 400), at(605, 500), 'n1') // a word narrower than the minimum box: typing does not widen it
    await make(at(600, 600), at(595, 700), 'n2')
    const done = await storedWhen(page, (d) => texts(d).length === 3)
    const by = (t: string) => done.objects.find((o) => o.text === t)
    expect(by('up left')).toMatchObject({ left: 200, top: 100, width: 300 })
    expect(by('n1')).toMatchObject({ left: 600, top: 400, width: 48 })
    expect(by('n2')).toMatchObject({ left: 552, top: 600, width: 48 })
    expect(errors).toEqual([])
  })

  test('released outside the canvas (over the toolbar): the box still comes, up to where the pointer was', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    const toolbar = (await page.locator('.toolbar').boundingBox())!
    const over = { x: toolbar.x + toolbar.width / 2, y: at(0, 300).y }
    await drag(page, at(300, 300), over)
    await page.keyboard.type('reached')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 1)
    const host = (await page.locator('.canvas-host').boundingBox())!
    expect(done.objects[0]).toMatchObject({ top: 300, width: Math.round((at(300, 0).x - over.x) * 100) / 100 })
    expect(done.objects[0]!.left).toBeCloseTo(over.x - host.x, 1)
    expect(errors).toEqual([])
  })

  for (const view of [
    { zoom: 2, panX: 0, panY: 0 },
    { zoom: 0.5, panX: 100, panY: 50 },
  ]) {
    test(`at zoom ${view.zoom}: the width is in scene units and the font size is chosen as for a click`, async ({ page }) => {
      const { errors, at } = await open(page, [], { view })
      await page.keyboard.press('t')
      await drag(page, at(100, 100), at(300, 150))
      await page.keyboard.type('zoomed')
      await page.keyboard.press('Escape')
      const done = await storedWhen(page, (d) => texts(d).length === 1)
      expect(done.objects[0]).toMatchObject({ left: 100, top: 100, width: 200, fontSize: Math.round(Math.min(160, Math.max(12, 24 / view.zoom))) })
      expect(errors).toEqual([])
    })
  }

  test('`# Title` typed first in a dragged box is a heading, and a typing shortcut works straight away', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(500, 200))
    await page.keyboard.type('# Title')
    await page.keyboard.press('Enter')
    await page.keyboard.type('a **bold** word')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 1)
    expect(done.objects[0]).toMatchObject({ text: 'Title\na bold word', width: 400, headings: [1], spans: [{ start: 8, end: 12, bold: true }] })
    expect(errors).toEqual([])
  })
})

test.describe('cancelling, other buttons, single use', () => {
  test('Esc mid-drag: no box, nothing stored, the Select tool', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(400, 300), { hold: true })
    const edge = at(100, 300) // the bottom edge of the rectangle being drawn
    await expect.poll(() => accentIn(page, edge.x, edge.y - 3, 300, 6)).toBeGreaterThan(50)
    await page.keyboard.press('Escape')
    await expect.poll(() => accentIn(page, edge.x, edge.y - 3, 300, 6)).toBe(0)
    await page.mouse.up()
    await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(texts(await storedDoc(page))).toEqual([])
    expect(await editing(page)).toBe(false)
    await expect(undoButton(page)).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('a window blur mid-drag: no box; the Text tool stays chosen', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(400, 300), { hold: true })
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(texts(await storedDoc(page))).toEqual([])
    await expect(tool(page, 'Text')).toHaveAttribute('aria-pressed', 'true')
    expect(errors).toEqual([])
  })

  test('the right or middle button pressed and released mid-drag neither ends nor cancels it', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(250, 200), { hold: true })
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await page.mouse.down({ button: 'middle' })
    await page.mouse.up({ button: 'middle' })
    await page.mouse.move(at(400, 300).x, at(400, 300).y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.type('one box')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 1)
    expect(done.objects[0]).toMatchObject({ left: 100, top: 100, width: 300, text: 'one box' })
    expect(errors).toEqual([])
  })

  test('a dragged box left blank with Esc leaves no history step and nothing stored; the tool was single-use', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(400, 300))
    expect(await editing(page)).toBe(true)
    await page.keyboard.press('Escape')
    await drag(page, at(100, 400), at(400, 600)) // the Select tool now: a marquee, no text
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(texts(await storedDoc(page))).toEqual([])
    await expect(undoButton(page)).toBeDisabled()
    expect(await editing(page)).toBe(false)
    expect(errors).toEqual([])
  })

  test('a press with the Text tool on a text, an image or a frame label is not a draft; a frame interior is', async ({ page }) => {
    const frame = { id: 'F', name: 'Spread', left: 400, top: 100, width: 400, height: 300 }
    const { errors, at } = await open(page, [textRec('t', 100, 100, 'existing')], { frames: [frame] })
    await page.keyboard.press('t')
    await drag(page, at(110, 112), at(200, 300)) // on the text: Fabric drags it, as before
    await expect(page.locator('.inspector-title')).toHaveText('Text')
    await page.keyboard.press('t')
    await drag(page, at(410, 92), at(500, 50)) // on the frame label: moves the frame
    await expect(page.locator('.inspector-title')).toHaveText('Frame')
    let doc = await storedWhen(page, (d) => d.frames?.[0]?.top === 58)
    expect(texts(doc)).toHaveLength(1)
    await page.keyboard.press('t')
    await drag(page, at(520, 150), at(700, 200)) // inside the frame: a box, which it owns
    await page.keyboard.type('inside')
    await page.keyboard.press('Escape')
    doc = await storedWhen(page, (d) => texts(d).length === 2)
    expect(doc.objects.find((o) => o.text === 'inside')).toMatchObject({ left: 520, top: 150, width: 180, frameId: 'F' })
    expect(errors).toEqual([])
  })
})

test.describe('ownership and history', () => {
  test('a box dragged inside a frame belongs to it; one dragged mostly outside does not', async ({ page }) => {
    const frame = { id: 'F', name: 'Spread', left: 100, top: 100, width: 400, height: 300 }
    const { errors, at } = await open(page, [], { frames: [frame] })
    await page.keyboard.press('t')
    await drag(page, at(350, 150), at(480, 200)) // a click at 350 would make a 240-wide box centred outside
    await page.keyboard.type('in')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.keyboard.press('t')
    await drag(page, at(350, 300), at(900, 350))
    await page.keyboard.type('out')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 2)
    expect(done.objects.find((o) => o.text === 'in')?.frameId).toBe('F')
    expect(done.objects.find((o) => o.text === 'out')?.frameId).toBeUndefined()
    expect(errors).toEqual([])
  })

  test('typing into a dragged box is one undo step; redo restores it with its width; reload shows it', async ({ page }) => {
    const { errors, at } = await open(page, [textRec('other', 100, 500, 'other')])
    await page.keyboard.press('t')
    await drag(page, at(100, 100), at(260, 160))
    await page.keyboard.type('Sized')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 2)
    const made = done.objects.find((o) => o.text === 'Sized')!
    expect(made).toMatchObject({ width: 160 })
    await waitSaved(page)
    await undoButton(page).click()
    await storedWhen(page, (d) => texts(d).length === 1)
    await expect(undoButton(page)).toBeDisabled()
    await redoButton(page).click()
    const redone = await storedWhen(page, (d) => texts(d).length === 2)
    expect(redone.objects.find((o) => o.text === 'Sized')).toEqual(made)
    await waitSaved(page)
    await page.reload()
    await expect(status(page)).toContainText('Saved on this device')
    expect((await storedDoc(page)).objects.find((o) => o.text === 'Sized')).toEqual(made)
    expect(errors).toEqual([])
  })

  test('with the Text tool chosen and a text being edited, dragging inside that text selects its characters and makes no box', async ({ page }) => {
    const { errors, at } = await open(page, [textRec('t', 100, 100, 'select these words')])
    await page.keyboard.press('t')
    await page.mouse.dblclick(at(110, 112).x, at(110, 112).y)
    expect(await editing(page)).toBe(true)
    await drag(page, at(104, 112), at(300, 112)) // inside the edited text: a text selection, not a draft
    expect(await editing(page)).toBe(true)
    await page.keyboard.type('X')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d)[0]?.text !== 'select these words')
    expect(texts(done)).toHaveLength(1)
    const t = texts(done)[0]?.text ?? '' // the dragged-over characters were selected and replaced by the typed X
    expect(t.includes('X') && t.length < 'select these words'.length).toBe(true)
    expect(errors).toEqual([])
  })

  test('with the Text tool chosen, a text being edited, then a drag on empty canvas: the edit ends as its own step, then the new box', async ({ page }) => {
    const { errors, at } = await open(page, [textRec('t', 100, 100, 'old')])
    await page.keyboard.press('t')
    await page.mouse.dblclick(at(110, 112).x, at(110, 112).y)
    expect(await editing(page)).toBe(true) // a double-click edits a text while the Text tool stays chosen
    await page.keyboard.press('Control+a')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('er')
    await expect(tool(page, 'Text')).toHaveAttribute('aria-pressed', 'true')
    await drag(page, at(100, 300), at(300, 360))
    await page.keyboard.type('new')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => texts(d).length === 2)
    expect(done.objects.find((o) => o.id === 't')?.text).toBe('older')
    expect(done.objects.find((o) => o.text === 'new')).toMatchObject({ left: 100, top: 300, width: 200 })
    await undoButton(page).click() // the new box
    await storedWhen(page, (d) => texts(d).length === 1)
    await undoButton(page).click() // then the earlier edit, its own step
    await storedWhen(page, (d) => texts(d)[0]?.text === 'old')
    await expect(undoButton(page)).toBeDisabled()
    expect(errors).toEqual([])
  })
})
