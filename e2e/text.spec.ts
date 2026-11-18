/**
 * Real-browser tests (real Fabric, real IndexedDB) for formatted text: a stored text's marks,
 * headings, font, alignment and colour are drawn by Fabric, survive saving, moving, scaling,
 * undo, redo and reload, and stay what the canvas shows while the text is typed into.
 *
 * There are no formatting controls yet, so formatted text is seeded into storage.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  AUTOSAVE_QUIET_MS,
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
import type { StoredBoard, StoredObject, View } from './helpers.ts'

const UNIT: View = { zoom: 1, panX: 0, panY: 0 }
const RED = '#c0392b'

type Seed = StoredObject & { type: 'text'; text: string; fontSize: number; width: number }
const textRec = (id: string, left: number, top: number, text: string, extra: Partial<Seed> = {}): Seed => ({
  type: 'text',
  id,
  left,
  top,
  angle: 0,
  text,
  fontSize: 24,
  width: 360,
  ...extra,
})

/**
 * Everything at once: a level 1 heading, an EMPTY level 2 heading line, a bold and an italic
 * word, and a span after an emoji (UTF-16 offsets: the emoji is two code units).
 *   0 "Heading" 7 \n 8 "" 8 \n 9 "Some bold, some italic" 31 \n 32 "😀 marked tail" 46
 */
const RICH_TEXT = 'Heading\n\nSome bold, some italic\n😀 marked tail'
const RICH: Seed = textRec('rich', 100, 100, RICH_TEXT, {
  width: 500,
  font: 'serif',
  align: 'center',
  color: RED,
  spans: [
    { start: 14, end: 18, bold: true },
    { start: 25, end: 31, italic: true },
    { start: 35, end: 41, bold: true, underline: true, strike: true },
  ],
  headings: [1, 2],
})

const board = (objects: unknown[], view: View = UNIT) => ({ version: 1, title: 'Text', objects, viewport: view })

async function open(page: Page, objects: unknown[], view: View = UNIT) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openBlank(page)
  await seedMilestone1(page, board(objects, view))
  await openApp(page)
  return { errors, at: await sceneToPage(page, view) }
}

const byId = (doc: StoredBoard, id: string) => {
  const found = doc.objects.find((o) => o.id === id)
  if (!found) throw new Error(`no object ${id}`)
  return found
}
async function storedWhen(page: Page, check: (doc: StoredBoard) => boolean): Promise<StoredBoard> {
  await expect.poll(async () => check(await storedDoc(page)), { timeout: 5000 }).toBe(true)
  return storedDoc(page)
}

interface Ink {
  count: number
  red: number
  top: number
  bottom: number
  left: number
  right: number
}
/**
 * What is drawn in a rectangle of the scene canvas (canvas CSS pixels): how many pixels are
 * dark ink, how many are clearly red, and the extent of all of them.
 */
function inkIn(page: Page, left: number, top: number, width: number, height: number): Promise<Ink> {
  return page.evaluate(
    ({ left, top, width, height }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas.lower-canvas')
      if (!canvas) throw new Error('scene canvas not found')
      const scale = canvas.width / canvas.clientWidth
      const w = Math.round(width * scale)
      const d = canvas.getContext('2d')!.getImageData(Math.round(left * scale), Math.round(top * scale), w, Math.round(height * scale)).data
      const ink: Ink = { count: 0, red: 0, top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity }
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!]
        const dark = a > 40 && r < 160 && g < 160 && b < 160
        const red = a > 40 && r > 140 && g < 110 && b < 110
        if (!dark && !red) continue
        if (dark) ink.count++
        if (red) ink.red++
        const y = Math.floor(i / 4 / w) / scale
        const x = ((i / 4) % w) / scale
        ink.top = Math.min(ink.top, y)
        ink.bottom = Math.max(ink.bottom, y)
        ink.left = Math.min(ink.left, x)
        ink.right = Math.max(ink.right, x)
      }
      return ink
    },
    { left, top, width, height },
  )
}

/** Enters editing of the text under `p` and puts the caret after `n` characters (graphemes). */
async function caretAt(page: Page, p: { x: number; y: number }, n: number) {
  await page.mouse.dblclick(p.x, p.y)
  await page.keyboard.press('Control+a')
  await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight')
}

test.describe('a stored formatted text', () => {
  test('opens editable, loading writes nothing, and a move stores exactly the same formatting (version 1 board)', async ({ page }) => {
    const { errors, at } = await open(page, [RICH])
    const before = await snapshotIdb(page)
    await expect(page.getByTestId('readonly-banner')).toHaveCount(0)
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await snapshotIdb(page)).toEqual(before) // opening alone writes nothing
    await expect(undoButton(page)).toBeDisabled()

    await drag(page, at(150, 120), at(190, 150))
    const moved = await storedWhen(page, (d) => byId(d, 'rich').left !== 100)
    expect(moved.version).toBe(1)
    expect(byId(moved, 'rich')).toEqual({ ...RICH, left: 140, top: 130 })
    expect(errors).toEqual([])
  })

  test('opens from a version 2 board with frames and keeps its formatting and owner through a move', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const frame = { id: 'F', name: 'Spread', left: 50, top: 50, width: 700, height: 500 }
    const rich = { ...RICH, frameId: 'F' }
    await openBlank(page)
    await seedRaw(page, 2, { version: 2, title: 'Framed', frames: [frame], objects: [rich], viewport: UNIT })
    await openApp(page)
    const at = await sceneToPage(page, UNIT)
    await drag(page, at(150, 120), at(170, 140))
    const moved = await storedWhen(page, (d) => byId(d, 'rich').left !== 100)
    expect(moved.frames).toEqual([frame])
    expect(byId(moved, 'rich')).toEqual({ ...rich, left: 120, top: 120 })
    expect(errors).toEqual([])
  })

  test('is drawn with its formatting: headings (including an empty one) are taller, bold and colour change the ink', async ({ page }) => {
    const plain = textRec('plain', 40, 40, 'Title\n\nbody')
    const h1 = textRec('h1', 440, 40, 'Title\n\nbody', { headings: [1] })
    const h12 = textRec('h12', 840, 40, 'Title\n\nbody', { headings: [1, 2] })
    const word = textRec('word', 40, 400, 'Sample words')
    const strong = textRec('strong', 440, 400, 'Sample words', { spans: [{ start: 0, end: 12, bold: true }], color: RED })
    const { errors } = await open(page, [plain, h1, h12, word, strong])

    const col = (left: number) => inkIn(page, left - 5, 30, 380, 330)
    await expect.poll(async () => (await col(40)).count).toBeGreaterThan(0)
    const [p, a, b] = [await col(40), await col(440), await col(840)]
    expect(a.bottom - a.top).toBeGreaterThan(p.bottom - p.top + 20) // the heading line is drawn at twice the size
    expect(b.bottom - b.top).toBeGreaterThan(a.bottom - a.top + 15) // and so is the empty heading line below it
    expect(a.count).toBeGreaterThan(p.count * 1.5)

    const w = await inkIn(page, 35, 390, 380, 60)
    const s = await inkIn(page, 435, 390, 380, 60)
    expect(w.red).toBe(0)
    expect(w.count).toBeGreaterThan(0)
    expect(s.red).toBeGreaterThan(w.count) // red, and bold: more ink than the plain words
    expect(errors).toEqual([])
  })

  test('a mark on a wrapped line of a paragraph is drawn on that word (styles are keyed by paragraph, not by drawn line)', async ({ page }) => {
    // Narrow boxes: "aaaa bbbb" on the first drawn line, "cccc dddd" wrapped onto the second.
    const plain = textRec('plain', 40, 40, 'aaaa bbbb cccc dddd', { width: 130 })
    const marked = textRec('marked', 440, 40, 'aaaa bbbb cccc dddd', { width: 130, spans: [{ start: 15, end: 19, bold: true }] })
    const { errors } = await open(page, [plain, marked])
    await expect.poll(async () => (await inkIn(page, 35, 30, 140, 30)).count).toBeGreaterThan(0)
    const first = [await inkIn(page, 35, 30, 140, 30), await inkIn(page, 435, 30, 140, 30)]
    const second = [await inkIn(page, 35, 62, 140, 30), await inkIn(page, 435, 62, 140, 30)]
    expect(second[0]!.count).toBeGreaterThan(0)
    expect(first[1]!.count).toBe(first[0]!.count) // nothing bold on the first drawn line
    expect(second[1]!.count).toBeGreaterThan(second[0]!.count * 1.1) // "dddd" is bold
    expect(errors).toEqual([])
  })

  test('move, undo, redo and reload keep the formatting exactly', async ({ page }) => {
    const { errors, at } = await open(page, [RICH])
    const before = await storedDoc(page)
    await drag(page, at(150, 120), at(250, 170))
    const moved = await storedWhen(page, (d) => byId(d, 'rich').left !== 100)
    expect(byId(moved, 'rich')).toEqual({ ...RICH, left: 200, top: 150 })
    await page.keyboard.press('Escape')

    await undoButton(page).click()
    await storedWhen(page, (d) => byId(d, 'rich').left === 100)
    expect((await storedDoc(page)).objects).toEqual(before.objects)
    await redoButton(page).click()
    await storedWhen(page, (d) => byId(d, 'rich').left === 200)
    expect((await storedDoc(page)).objects).toEqual(moved.objects)

    await waitSaved(page)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(status(page)).toContainText('Saved on this device')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect((await storedDoc(page)).objects).toEqual(moved.objects) // no drift from loading
    await expect(undoButton(page)).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('a corner scale scales the size and width as today, keeps the formatting, and draws the heading at its ratio', async ({ page }) => {
    const rec = textRec('t', 100, 200, 'Title\nbody text', { headings: [1], spans: [{ start: 6, end: 10, italic: true }], width: 300 })
    const { errors, at } = await open(page, [rec])
    const ink0 = await inkIn(page, 90, 150, 700, 600)
    await page.mouse.click(at(150, 230).x, at(150, 230).y)
    await expect(page.locator('.inspector-title')).toHaveText('Text')
    // The top-right handle; the anchor is the bottom-left corner.
    const handle = at(100 + 300 + 2, 200 - 2)
    await drag(page, handle, { x: handle.x + 150, y: handle.y - 80 }, { steps: 10 })
    const scaled = await storedWhen(page, (d) => byId(d, 't').width !== 300)
    const t = byId(scaled, 't')
    const k = t.width! / 300
    expect(k).toBeGreaterThan(1.3)
    expect(t.fontSize).toBeCloseTo(24 * k, 1) // folded into the size, as for a plain text
    expect(t.left).toBe(100)
    expect({ ...t, fontSize: 0, width: 0, top: 0 }).toEqual({ ...rec, fontSize: 0, width: 0, top: 0 }) // formatting unchanged
    await page.keyboard.press('Escape')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await storedDoc(page)).toEqual(scaled) // deselecting changes nothing

    // Every line, the heading included, is drawn k times larger: the ink is k times taller.
    const ink1 = await inkIn(page, 90, 50, 900, 700)
    expect((ink1.bottom - ink1.top) / (ink0.bottom - ink0.top)).toBeCloseTo(k, 1)

    await undoButton(page).click()
    await storedWhen(page, (d) => byId(d, 't').width === 300)
    expect(byId(await storedDoc(page), 't')).toEqual(rec)
    await redoButton(page).click()
    await storedWhen(page, (d) => byId(d, 't').width !== 300)
    expect(await storedDoc(page)).toEqual(scaled)
    expect(errors).toEqual([])
  })

  test('a read-only board shows formatted text and writes nothing', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const strong = textRec('strong', 100, 100, 'Sample words', { spans: [{ start: 0, end: 12, bold: true }], color: RED })
    const lost = { type: 'image', id: 'lost', left: 600, top: 300, angle: 0, assetId: 'gone', scaleX: 1, scaleY: 1 } // its bytes are missing
    await openBlank(page)
    await seedMilestone1(page, board([strong, lost]))
    await page.goto('/')
    await expect(page.getByTestId('readonly-banner')).toContainText('could not be loaded')
    const before = await snapshotIdb(page)
    await expect.poll(async () => (await inkIn(page, 95, 90, 380, 60)).red).toBeGreaterThan(50)
    const at = await sceneToPage(page, UNIT)
    await page.mouse.dblclick(at(120, 112).x, at(120, 112).y)
    await page.keyboard.type('nope')
    await page.waitForTimeout(AUTOSAVE_QUIET_MS)
    expect(await snapshotIdb(page)).toEqual(before)
    expect(errors).toEqual([])
  })
})

test.describe('typing into a formatted text', () => {
  test('typing in the middle of a bold run extends it; the typing save mid-edit is already right; Esc then one undo restores it', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'plain bold rest', { spans: [{ start: 6, end: 10, bold: true }] })
    const { errors, at } = await open(page, [rec])
    await caretAt(page, at(130, 112), 8) // between "bo" and "ld"
    await page.keyboard.type('XY')
    // Saved while still editing (the autosave debounce fires mid-edit).
    const typed = await storedWhen(page, (d) => byId(d, 't').text === 'plain boXYld rest')
    expect(byId(typed, 't')).toEqual({ ...rec, text: 'plain boXYld rest', spans: [{ start: 6, end: 12, bold: true }] })
    await page.keyboard.press('Escape')
    await waitSaved(page)
    expect(await storedDoc(page)).toEqual(typed)

    await undoButton(page).click() // the whole edit is one step
    await storedWhen(page, (d) => byId(d, 't').text === 'plain bold rest')
    expect(byId(await storedDoc(page), 't')).toEqual(rec)
    await expect(undoButton(page)).toBeDisabled()
    await redoButton(page).click()
    await storedWhen(page, (d) => byId(d, 't').text !== 'plain bold rest')
    expect(await storedDoc(page)).toEqual(typed)
    expect(errors).toEqual([])
  })

  test('typing in the body line of a text with a heading keeps the heading (left by clicking elsewhere)', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'Title\nbody', { headings: [1] })
    const { errors, at } = await open(page, [rec])
    await caretAt(page, at(130, 112), 10) // the end of "body"
    await page.keyboard.type(' more')
    await page.mouse.click(at(900, 600).x, at(900, 600).y) // empty canvas
    const done = await storedWhen(page, (d) => byId(d, 't').text === 'Title\nbody more')
    expect(byId(done, 't')).toEqual({ ...rec, text: 'Title\nbody more' })
    expect(errors).toEqual([])
  })

  test('the first character typed on an empty heading line is a heading (it takes the placeholder style)', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'Title\n\nbody', { headings: [1, 2] })
    const { errors, at } = await open(page, [rec])
    await caretAt(page, at(130, 112), 6) // on the empty line
    await page.keyboard.type('Sub')
    const done = await storedWhen(page, (d) => byId(d, 't').text === 'Title\nSub\nbody')
    expect(byId(done, 't')).toEqual({ ...rec, text: 'Title\nSub\nbody' })
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })

  test('Backspace that merges a body line into a heading leaves one heading drawn at one size', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'Title\nbody', { headings: [1] })
    const reference = textRec('ref', 600, 100, 'Titlebody', { headings: [1] })
    const { errors, at } = await open(page, [rec, reference])
    await caretAt(page, at(130, 112), 6) // the start of "body"
    await page.keyboard.press('Backspace')
    const merged = await storedWhen(page, (d) => byId(d, 't').text === 'Titlebody')
    expect(byId(merged, 't')).toEqual({ ...rec, text: 'Titlebody' })
    await page.keyboard.press('Escape') // leaves the edit
    await page.keyboard.press('Escape') // and deselects, so no selection chrome is drawn over it
    await expect(page.locator('.inspector-title')).toHaveCount(0)
    await waitSaved(page)
    // Drawn like a text stored that way: the same extent, up to rasterisation. (Were "body"
    // still at the body size, the line would be about 50 pixels shorter.)
    const a = await inkIn(page, 95, 90, 400, 120)
    const b = await inkIn(page, 595, 90, 400, 120)
    expect(Math.abs(a.bottom - a.top - (b.bottom - b.top))).toBeLessThanOrEqual(2)
    expect(Math.abs(a.right - a.left - (b.right - b.left))).toBeLessThanOrEqual(2)
    expect(Math.abs(a.count - b.count)).toBeLessThan(b.count * 0.1)
    expect(errors).toEqual([])
  })

  test('an emoji typed before a span shifts the span by its two code units (left by clicking another object)', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'ab bold', { spans: [{ start: 3, end: 7, bold: true }] })
    const other = textRec('other', 100, 400, 'other')
    const { errors, at } = await open(page, [rec, other])
    await caretAt(page, at(130, 112), 0)
    await page.keyboard.type('😀')
    await page.mouse.click(at(120, 412).x, at(120, 412).y) // the other text
    await expect(page.locator('.inspector-title')).toHaveText('Text')
    const done = await storedWhen(page, (d) => byId(d, 't').text === '😀ab bold')
    expect(byId(done, 't')).toEqual({ ...rec, text: '😀ab bold', spans: [{ start: 5, end: 9, bold: true }] })
    expect(errors).toEqual([])
  })
})

/**
 * Fabric's own habits while typing, tidied into canonical form. Recorded as known limits in
 * the README: these tests pin today's behaviour, not a settled rule.
 */
test.describe('typing habits around headings (known limits)', () => {
  test('Enter at the end of a heading continues the heading on the new line', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'Title\nbody', { headings: [1] })
    const { errors, at } = await open(page, [rec])
    await caretAt(page, at(130, 112), 5)
    await page.keyboard.press('Enter')
    await page.keyboard.type('Next')
    const done = await storedWhen(page, (d) => byId(d, 't').text === 'Title\nNext\nbody')
    expect(byId(done, 't')).toEqual({ ...rec, text: 'Title\nNext\nbody', headings: [1, 1] })
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })

  test('deleting every character of a heading line turns it back into a normal line', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'Title\nbody', { headings: [1] })
    const { errors, at } = await open(page, [rec])
    await caretAt(page, at(130, 112), 5)
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
    const done = await storedWhen(page, (d) => byId(d, 't').text === '\nbody')
    const rest = { ...rec, headings: undefined }
    expect(byId(done, 't')).toEqual({ ...rest, text: '\nbody' })
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })

  test('joining a heading onto the end of a normal line keeps its characters bold at the normal size', async ({ page }) => {
    const rec = textRec('t', 100, 100, 'body\nTitle', { headings: [0, 1] })
    const reference = textRec('ref', 600, 100, 'bodyTitle', { spans: [{ start: 4, end: 9, bold: true }] })
    const { errors, at } = await open(page, [rec, reference])
    await caretAt(page, at(130, 112), 5) // the start of "Title"
    await page.keyboard.press('Backspace')
    const done = await storedWhen(page, (d) => byId(d, 't').text === 'bodyTitle')
    const rest = { ...rec, headings: undefined }
    expect(byId(done, 't')).toEqual({ ...rest, text: 'bodyTitle', spans: [{ start: 4, end: 9, bold: true }] })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    const a = await inkIn(page, 95, 90, 400, 80)
    const b = await inkIn(page, 595, 90, 400, 80)
    expect(Math.abs(a.bottom - a.top - (b.bottom - b.top))).toBeLessThanOrEqual(2) // drawn at the normal size
    expect(Math.abs(a.right - a.left - (b.right - b.left))).toBeLessThanOrEqual(2)
    expect(errors).toEqual([])
  })
})

test.describe('a plain text', () => {
  test('created with the Text tool is stored with exactly the old keys', async ({ page }) => {
    const { errors, at } = await open(page, [])
    await page.keyboard.press('t')
    await page.mouse.click(at(300, 300).x, at(300, 300).y)
    await page.keyboard.type('just words')
    await page.keyboard.press('Escape')
    const done = await storedWhen(page, (d) => d.objects.length === 1)
    expect(Object.keys(done.objects[0]!)).toEqual(['id', 'left', 'top', 'angle', 'type', 'text', 'fontSize', 'width'])
    expect(done.objects[0]!.text).toBe('just words')
    expect(errors).toEqual([])
  })
})
