import type { BoardDoc, StoredAsset } from '../../model/types.ts'
import type { BoardStore, LoadedBoard } from '../../persistence/boardStore.ts'
import type { AssetSource } from '../assets.ts'

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** In-memory BoardStore whose load() can be held open, recording every write attempt. */
export class SpyStore implements BoardStore {
  readonly gate = deferred<LoadedBoard | null>()
  readonly saves: Array<{ doc: BoardDoc; assets: string[] }> = []
  readonly prunes: Array<string[]> = []
  holdLoad = true
  constructor(private readonly stored: LoadedBoard | null) {}
  releaseLoad() {
    this.gate.resolve(this.stored)
  }
  failLoad(e: unknown) {
    this.gate.reject(e)
  }
  load() {
    return this.holdLoad ? this.gate.promise : Promise.resolve(this.stored)
  }
  async save(doc: BoardDoc, newAssets: readonly StoredAsset[]) {
    this.saves.push({ doc, assets: newAssets.map((a) => a.id) })
  }
  async pruneAssets(keep: ReadonlySet<string>) {
    this.prunes.push([...keep])
  }
}

/** Asset source that "decodes" instantly, except for ids in `broken`. */
export class FakeAssets implements AssetSource {
  readonly loaded: string[] = []
  private readonly cache = new Map<string, HTMLImageElement>()
  constructor(private readonly broken: ReadonlySet<string> = new Set()) {}
  get(id: string) {
    return this.cache.get(id)
  }
  async load(asset: StoredAsset) {
    if (this.broken.has(asset.id)) throw new Error(`${asset.name} could not be decoded as an image.`)
    this.loaded.push(asset.id)
    const el = { naturalWidth: 200, naturalHeight: 100 } as HTMLImageElement
    this.cache.set(asset.id, el)
    return el
  }
  dispose() {
    this.cache.clear()
  }
}
