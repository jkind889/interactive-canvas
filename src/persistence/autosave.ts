import type { BoardDoc, SaveState, StoredAsset } from '../model/types.ts'
import type { BoardStore } from './boardStore.ts'

export interface AutosaverOptions {
  store: BoardStore
  /** Called at save time, so it must reflect the live board. */
  getDoc: () => BoardDoc
  onStatus: (s: SaveState) => void
  debounceMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/**
 * Debounced saver with an honest status machine:
 * new/saved -> dirty -> saving -> saved | error. Assets added since the last
 * successful save are written in the same transaction as the document and are
 * only forgotten after that transaction commits.
 */
export class Autosaver {
  private status: SaveState = { kind: 'loading' }
  private pending = new Map<string, StoredAsset>()
  private timer: unknown = null
  private inFlight: Promise<void> | null = null
  /** Something changed after the in-flight save snapshot was taken. */
  private changedWhileSaving = false
  private disabled = false
  /**
   * Nothing may be written until the stored board has been hydrated. Until
   * markLoaded() arms the saver, every write path is inert, so an early edit can
   * never replace a stored board that has not been restored yet.
   */
  private armed = false

  private readonly debounceMs: number
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void

  constructor(private readonly opts: AutosaverOptions) {
    this.debounceMs = opts.debounceMs ?? 500
    this.now = opts.now ?? (() => Date.now())
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  get state(): SaveState {
    return this.status
  }

  /** True while there are edits that are not safely stored. */
  get hasUnsavedChanges(): boolean {
    const k = this.status.kind
    return k === 'dirty' || k === 'saving' || k === 'error'
  }

  /** Board finished loading from storage (or nothing was stored). */
  markLoaded(hadStoredBoard: boolean) {
    if (this.disabled) return
    this.armed = true
    this.setStatus(hadStoredBoard ? { kind: 'saved', at: this.now() } : { kind: 'new' })
  }

  /** Saving is impossible; keeps the reason visible and never touches storage. */
  disable(message: string) {
    this.disabled = true
    this.armed = false
    this.clearScheduled()
    this.setStatus({ kind: 'unavailable', message })
  }

  addAsset(asset: StoredAsset) {
    this.pending.set(asset.id, asset)
  }

  markDirty() {
    if (this.disabled || !this.armed) return
    if (this.inFlight) this.changedWhileSaving = true
    this.setStatus({ kind: 'dirty' })
    this.clearScheduled()
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.save()
    }, this.debounceMs)
  }

  /** Saves now (used by retry and page-hide). Resolves when the attempt ends. */
  async flush(): Promise<void> {
    if (this.disabled || !this.armed) return
    this.clearScheduled()
    if (this.inFlight) await this.inFlight
    // The in-flight save may have re-armed the debounce timer; we are saving now instead.
    this.clearScheduled()
    if (this.status.kind === 'dirty' || this.status.kind === 'error') await this.save()
  }

  retry(): Promise<void> {
    if (this.status.kind !== 'error') return Promise.resolve()
    return this.flush()
  }

  dispose() {
    this.clearScheduled()
  }

  private clearScheduled() {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private setStatus(s: SaveState) {
    this.status = s
    this.opts.onStatus(s)
  }

  private save(): Promise<void> {
    if (!this.armed || this.disabled) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    this.inFlight = this.run().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(): Promise<void> {
    this.changedWhileSaving = false
    this.setStatus({ kind: 'saving' })
    const batch = [...this.pending.values()]
    try {
      await this.opts.store.save(this.opts.getDoc(), batch)
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Unknown storage error.'
      this.setStatus({ kind: 'error', message })
      return
    }
    for (const a of batch) if (this.pending.get(a.id) === a) this.pending.delete(a.id)
    if (this.changedWhileSaving) {
      this.markDirty()
    } else {
      this.setStatus({ kind: 'saved', at: this.now() })
    }
  }
}
