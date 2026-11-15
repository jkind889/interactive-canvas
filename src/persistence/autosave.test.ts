// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../model/doc.ts'
import type { BoardDoc, SaveState, StoredAsset } from '../model/types.ts'
import { Autosaver } from './autosave.ts'
import type { BoardStore } from './boardStore.ts'

const asset = (id: string): StoredAsset => ({ id, name: `${id}.png`, type: 'image/png', bytes: new ArrayBuffer(4) })

/** `hydrated: false` leaves the saver in its pre-hydration (inert) state. */
function setup({ hydrated = true } = {}) {
  const statuses: SaveState[] = []
  const saves: Array<{ doc: BoardDoc; assets: string[] }> = []
  const timers: Array<{ fn: () => void; ms: number; id: number; live: boolean }> = []
  const gate = { fail: null as Error | null, hold: null as Promise<void> | null }
  const store: BoardStore = {
    load: async () => null,
    pruneAssets: async () => {},
    save: async (doc, newAssets) => {
      if (gate.hold) await gate.hold
      if (gate.fail) throw gate.fail
      saves.push({ doc, assets: newAssets.map((a) => a.id) })
    },
  }
  let version = 0
  const saver = new Autosaver({
    store,
    getDoc: () => ({ ...createEmptyDoc(), title: `v${++version}` }),
    onStatus: (s) => statuses.push(s),
    now: () => 1234,
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: timers.length, live: true }
      timers.push(t)
      return t
    },
    clearTimer: (h) => {
      ;(h as (typeof timers)[number]).live = false
    },
  })
  if (hydrated) saver.markLoaded(false)
  statuses.length = 0
  const fire = async () => {
    const live = timers.filter((t) => t.live)
    for (const t of live) {
      t.live = false
      t.fn()
    }
    await saver.flush() // lets an in-flight save settle
  }
  return { saver, statuses, saves, timers, gate, fire, kinds: () => statuses.map((s) => s.kind) }
}

describe('Autosaver status machine', () => {
  it('reports "new" for a board with nothing stored and "saved" after loading one', () => {
    const a = setup()
    a.saver.markLoaded(false)
    expect(a.saver.state.kind).toBe('new')
    a.saver.markLoaded(true)
    expect(a.saver.state).toEqual({ kind: 'saved', at: 1234 })
  })

  it('goes dirty -> saving -> saved and writes the live document', async () => {
    const a = setup()
    a.saver.markLoaded(false)
    a.saver.markDirty()
    expect(a.saver.state.kind).toBe('dirty')
    expect(a.saves).toHaveLength(0) // debounced, nothing written yet
    await a.fire()
    expect(a.kinds().slice(-3)).toEqual(['dirty', 'saving', 'saved'])
    expect(a.saves).toHaveLength(1)
  })

  it('debounces bursts into a single save', async () => {
    const a = setup()
    for (let i = 0; i < 10; i++) a.saver.markDirty()
    expect(a.timers.filter((t) => t.live)).toHaveLength(1)
    await a.fire()
    expect(a.saves).toHaveLength(1)
  })

  it('writes new assets with the document, and only once', async () => {
    const a = setup()
    a.saver.addAsset(asset('x'))
    a.saver.addAsset(asset('y'))
    a.saver.markDirty()
    await a.fire()
    expect(a.saves[0]?.assets).toEqual(['x', 'y'])
    a.saver.markDirty()
    await a.fire()
    expect(a.saves[1]?.assets).toEqual([])
  })

  it('surfaces a failed save as an error and keeps assets for the retry', async () => {
    const a = setup()
    a.saver.addAsset(asset('x'))
    a.gate.fail = new Error('quota exceeded')
    a.saver.markDirty()
    await a.fire()
    expect(a.saver.state).toEqual({ kind: 'error', message: 'quota exceeded' })
    expect(a.saver.hasUnsavedChanges).toBe(true)

    a.gate.fail = null
    await a.saver.retry()
    expect(a.saver.state.kind).toBe('saved')
    expect(a.saves[0]?.assets).toEqual(['x']) // bytes were not lost by the failure
    expect(a.saver.hasUnsavedChanges).toBe(false)
  })

  it('retry is a no-op unless the last save failed', async () => {
    const a = setup()
    a.saver.markLoaded(true)
    await a.saver.retry()
    expect(a.saves).toHaveLength(0)
  })

  it('a new edit after a failure schedules a fresh attempt', async () => {
    const a = setup()
    a.gate.fail = new Error('nope')
    a.saver.markDirty()
    await a.fire()
    a.gate.fail = null
    a.saver.markDirty()
    expect(a.saver.state.kind).toBe('dirty')
    await a.fire()
    expect(a.saver.state.kind).toBe('saved')
  })

  it('edits made while saving trigger another save instead of claiming "saved"', async () => {
    const a = setup()
    let release!: () => void
    a.gate.hold = new Promise<void>((r) => (release = r))
    a.saver.markDirty()
    for (const t of a.timers.filter((t) => t.live)) {
      t.live = false
      t.fn()
    }
    expect(a.saver.state.kind).toBe('saving')
    a.saver.markDirty() // user keeps editing mid-save
    a.gate.hold = null
    release()
    await a.fire()
    await a.fire()
    expect(a.saves.length).toBe(2)
    expect(a.saver.state.kind).toBe('saved')
    expect(a.saves[1]?.doc.title).toBe('v2') // the second save used a fresh snapshot
  })

  it('disable() blocks all writes and keeps the reason visible', async () => {
    const a = setup()
    a.saver.disable('storage unavailable')
    a.saver.markDirty()
    await a.saver.flush()
    expect(a.saves).toHaveLength(0)
    expect(a.timers.filter((t) => t.live)).toHaveLength(0)
    expect(a.saver.state).toEqual({ kind: 'unavailable', message: 'storage unavailable' })
    expect(a.saver.hasUnsavedChanges).toBe(false)
  })

  it('flush saves pending edits immediately (page hide)', async () => {
    const a = setup()
    a.saver.markDirty()
    await a.saver.flush()
    expect(a.saves).toHaveLength(1)
    expect(a.saver.state.kind).toBe('saved')
  })

  it('is inert until a successful load arms it: early edits never write', async () => {
    const a = setup({ hydrated: false }) // still hydrating: markLoaded() has not run
    a.saver.markDirty()
    a.saver.markDirty()
    expect(a.timers.filter((t) => t.live)).toHaveLength(0) // not even scheduled
    await a.saver.flush()
    await a.saver.retry()
    expect(a.saves).toHaveLength(0)
    expect(a.saver.state.kind).toBe('loading')
    expect(a.saver.hasUnsavedChanges).toBe(false)

    a.saver.markLoaded(true) // hydration finished
    a.saver.markDirty()
    await a.fire()
    expect(a.saves).toHaveLength(1)
  })

  it('a timer armed before disable() cannot write afterwards', async () => {
    const a = setup()
    a.saver.markLoaded(true)
    a.saver.markDirty() // debounce timer pending
    a.saver.disable('stored board could not be fully loaded')
    for (const t of a.timers) t.fn() // even if the timer fires anyway
    await a.saver.flush()
    expect(a.saves).toHaveLength(0)
    expect(a.saver.state.kind).toBe('unavailable')
  })

  it('markLoaded after disable() cannot re-enable saving', async () => {
    const a = setup()
    a.saver.disable('blocked')
    a.saver.markLoaded(true)
    a.saver.markDirty()
    await a.saver.flush()
    expect(a.saves).toHaveLength(0)
    expect(a.saver.state.kind).toBe('unavailable')
  })

  it('treats a throwing getDoc as a save error rather than crashing', async () => {
    const statuses: SaveState[] = []
    const saver = new Autosaver({
      store: { load: async () => null, pruneAssets: async () => {}, save: async () => {} },
      getDoc: () => {
        throw new Error('serialize failed')
      },
      onStatus: (s) => statuses.push(s),
      setTimer: (fn) => fn,
      clearTimer: () => {},
    })
    saver.markLoaded(true)
    saver.markDirty()
    await saver.flush()
    expect(saver.state).toEqual({ kind: 'error', message: 'serialize failed' })
  })
})
