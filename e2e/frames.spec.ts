/**
 * Real-browser tests (real Fabric, real IndexedDB) for frames.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { openBlank, seedRaw } from './helpers.ts'
import type { View } from './helpers.ts'

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
      expect(await pixel(page, midX, top + 4)).toEqual([255, 255, 255, 255]) // and only one pixel thick
      expect(await pixel(page, left + 4, midY)).toEqual([255, 255, 255, 255])

      // The label sits just above the top-left corner, at a fixed screen size.
      expect(await inkIn(page, Math.round(left), Math.round(top) - 24, 60, 20)).toBeGreaterThan(20)
      expect(await inkIn(page, Math.round(left) + 120, Math.round(top) - 24, 60, 20)).toBe(0) // nothing beside it
      expect(errors).toEqual([])
    })
  }
})
