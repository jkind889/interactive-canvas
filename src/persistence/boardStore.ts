import { parseDoc } from '../model/doc.ts'
import type { BoardDoc, StoredAsset } from '../model/types.ts'

export interface LoadedBoard {
  doc: BoardDoc
  assets: Map<string, StoredAsset>
}

/** Thrown by load() when something is stored but cannot be understood. */
export class UnreadableBoardError extends Error {
  constructor(message = 'The saved board could not be read.') {
    super(message)
    this.name = 'UnreadableBoardError'
  }
}

export interface BoardStore {
  /** Resolves null when nothing has been saved yet. */
  load(): Promise<LoadedBoard | null>
  /** Atomically writes the document together with any new asset bytes. */
  save(doc: BoardDoc, newAssets: readonly StoredAsset[]): Promise<void>
  /** Best-effort cleanup of asset bytes the document no longer references. */
  pruneAssets(keep: ReadonlySet<string>): Promise<void>
}

const DB_NAME = 'yuriful'
const DB_VERSION = 1
const BOARDS = 'boards'
const ASSETS = 'assets'
/** Milestone 1 has a single board; the key leaves room for a board list later. */
const CURRENT_BOARD = 'current'

interface BoardRow {
  id: string
  doc: BoardDoc
  updatedAt: number
}

const describe = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** instanceof breaks across realms (iframes, test environments); the tag does not. */
const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export class IndexedDbBoardStore implements BoardStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB is not available in this browser.'))
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest
      try {
        req = this.factory!.open(DB_NAME, DB_VERSION)
      } catch (e) {
        reject(new Error(describe(e, 'Could not open local storage.')))
        return
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(BOARDS)) db.createObjectStore(BOARDS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          db.close()
          this.dbPromise = null
        }
        resolve(db)
      }
      req.onerror = () => reject(new Error(describe(req.error, 'Could not open local storage.')))
      req.onblocked = () => reject(new Error('Local storage is blocked by another yuriful tab.'))
    })
    // A failed open must be retryable.
    this.dbPromise.catch(() => {
      this.dbPromise = null
    })
    return this.dbPromise
  }

  async load(): Promise<LoadedBoard | null> {
    const db = await this.open()
    const tx = db.transaction([BOARDS, ASSETS], 'readonly')
    const row = (await request(tx.objectStore(BOARDS).get(CURRENT_BOARD))) as BoardRow | undefined
    if (!row) return null
    const doc = parseDoc(row.doc)
    if (!doc) throw new UnreadableBoardError()
    const all = (await request(tx.objectStore(ASSETS).getAll())) as StoredAsset[]
    const assets = new Map<string, StoredAsset>()
    for (const a of all) {
      if (a && typeof a.id === 'string' && isArrayBuffer(a.bytes)) assets.set(a.id, a)
    }
    return { doc, assets }
  }

  async save(doc: BoardDoc, newAssets: readonly StoredAsset[]): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([BOARDS, ASSETS], 'readwrite')
    const done = transactionDone(tx)
    done.catch(() => {}) // surfaced via the await below; avoid an unhandled duplicate
    try {
      const assets = tx.objectStore(ASSETS)
      for (const a of newAssets) assets.put(a)
      const row: BoardRow = { id: CURRENT_BOARD, doc, updatedAt: Date.now() }
      tx.objectStore(BOARDS).put(row)
    } catch (e) {
      try {
        tx.abort()
      } catch {
        /* already finished */
      }
      throw new Error(describe(e, 'Could not write to local storage.'), { cause: e })
    }
    try {
      await done
    } catch (e) {
      throw new Error(describe(e, 'Could not write to local storage (it may be full).'), { cause: e })
    }
  }

  async pruneAssets(keep: ReadonlySet<string>): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(ASSETS, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(ASSETS)
    const keys = (await request(store.getAllKeys())) as IDBValidKey[]
    for (const k of keys) if (typeof k === 'string' && !keep.has(k)) store.delete(k)
    await done
  }
}
