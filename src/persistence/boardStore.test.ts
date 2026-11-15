// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../model/doc.ts'
import type { BoardDoc, StoredAsset } from '../model/types.ts'
import { IndexedDbBoardStore, UnreadableBoardError } from './boardStore.ts'

const bytes = (...n: number[]) => new Uint8Array(n).buffer
const asset = (id: string, ...b: number[]): StoredAsset => ({ id, name: `${id}.png`, type: 'image/png', bytes: bytes(...b) })
const docWith = (assetId: string): BoardDoc => ({
  ...createEmptyDoc(),
  title: 'Saved',
  objects: [
    { type: 'image', id: 'o1', left: 1, top: 2, angle: 0, assetId, scaleX: 1, scaleY: 1 },
    { type: 'text', id: 'o2', left: 3, top: 4, angle: 0, text: 'note', fontSize: 20, width: 200 },
  ],
})

const newStore = () => {
  const factory = new IDBFactory()
  return { factory, store: new IndexedDbBoardStore(factory) }
}

/** Writes arbitrary data straight into the boards store. */
function putRaw(factory: IDBFactory, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open('yuriful', 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('boards', { keyPath: 'id' })
      open.result.createObjectStore('assets', { keyPath: 'id' })
    }
    open.onsuccess = () => {
      const tx = open.result.transaction('boards', 'readwrite')
      tx.objectStore('boards').put({ id: 'current', doc: value, updatedAt: 0 })
      tx.oncomplete = () => {
        open.result.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}

describe('IndexedDbBoardStore', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await newStore().store.load()).toBeNull()
  })

  it('round-trips the document and the exact image bytes', async () => {
    const { store } = newStore()
    await store.save(docWith('a1'), [asset('a1', 1, 2, 3, 250)])
    const loaded = await store.load()
    expect(loaded?.doc).toEqual(docWith('a1'))
    const stored = loaded?.assets.get('a1')
    expect(stored && [...new Uint8Array(stored.bytes)]).toEqual([1, 2, 3, 250])
    expect(stored?.type).toBe('image/png')
  })

  it('keeps previously stored assets when later saves add none', async () => {
    const { store } = newStore()
    await store.save(docWith('a1'), [asset('a1', 9)])
    await store.save({ ...docWith('a1'), title: 'Renamed' }, [])
    const loaded = await store.load()
    expect(loaded?.doc.title).toBe('Renamed')
    expect(loaded?.assets.has('a1')).toBe(true)
  })

  it('overwrites the single current board', async () => {
    const { store } = newStore()
    await store.save(docWith('a1'), [asset('a1', 1)])
    await store.save({ ...createEmptyDoc(), title: 'Second' }, [])
    expect((await store.load())?.doc.objects).toHaveLength(0)
  })

  it('throws UnreadableBoardError for stored data it cannot parse, without touching it', async () => {
    const { factory, store } = newStore()
    await putRaw(factory, { version: 99, junk: true })
    await expect(store.load()).rejects.toBeInstanceOf(UnreadableBoardError)
    await expect(store.load()).rejects.toBeInstanceOf(UnreadableBoardError) // still there, still unreadable
  })

  it('writes nothing when a save fails midway (atomic document + assets)', async () => {
    const { store } = newStore()
    await store.save(docWith('a1'), [asset('a1', 1)])
    // A non-cloneable asset makes the transaction throw while writing.
    const bad = { id: 'bad', name: 'bad', type: 'image/png', bytes: () => 1 } as unknown as StoredAsset
    await expect(store.save({ ...docWith('a1'), title: 'Should not persist' }, [asset('a2', 2), bad])).rejects.toThrow()
    const loaded = await store.load()
    expect(loaded?.doc.title).toBe('Saved')
    expect(loaded?.assets.has('a2')).toBe(false)
  })

  it('rejects with a readable error when IndexedDB is unavailable', async () => {
    const store = new IndexedDbBoardStore(undefined)
    await expect(store.load()).rejects.toThrow(/not available/)
    await expect(store.save(createEmptyDoc(), [])).rejects.toThrow(/not available/)
  })

  it('prunes assets the document no longer references', async () => {
    const { store } = newStore()
    await store.save(docWith('a1'), [asset('a1', 1), asset('orphan', 2)])
    await store.pruneAssets(new Set(['a1']))
    const loaded = await store.load()
    expect([...(loaded?.assets.keys() ?? [])]).toEqual(['a1'])
  })
})
