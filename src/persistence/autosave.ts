import type { BoardDoc, SaveState } from '../model/types.ts'
import { ABSENT, BoardConflictError } from './boardStore.ts'
import type { AssetBytes, BoardStore, RevisionToken } from './boardStore.ts'

export interface AutosaverOptions {
  store: BoardStore
  /** Called at save time, so it must reflect the board that should be durable right now. */
  getDoc: () => BoardDoc
  /** Original bytes of every image this session has seen; the store re-stores any that are missing. */
  bytes: AssetBytes
  onStatus: (s: SaveState) => void
  /** The stored board is no longer the one this tab loaded or saved. Saving is off for good. */
  onConflict?: (message: string) => void
  debounceMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export const CONFLICT_MESSAGE =
  'This board was changed in another tab, so this tab stopped saving. Reload to continue from the saved board; changes made here since its last save are not saved.'

/**
 * Debounced saver with an honest status machine:
 * new/saved -> dirty -> saving -> saved | error. It holds the revision token of the
 * stored board: every save must match it, and a save that finds a different board
 * stored (another tab wrote) is never retried.
 */
export class Autosaver {
  private status: SaveState = { kind: 'loading' }
  private token: RevisionToken = ABSENT
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

  /** Board finished loading from storage. `token` is what was found there (`ABSENT` for nothing). */
  markLoaded(token: RevisionToken) {
    if (this.disabled) return
    this.armed = true
    this.token = token
    this.setStatus(token.kind === 'absent' ? { kind: 'new' } : { kind: 'saved', at: this.now() })
  }

  /** Saving is impossible; keeps the reason visible and never touches storage. */
  disable(message: string) {
    this.disabled = true
    this.armed = false
    this.clearScheduled()
    this.setStatus({ kind: 'unavailable', message })
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
    try {
      this.token = await this.opts.store.save(this.opts.getDoc(), this.token, this.opts.bytes)
    } catch (e) {
      if (this.disabled) return // switched off while the save was in flight; its reason stays visible
      if (e instanceof BoardConflictError) {
        // Never overwrite, never retry: the other tab's board is the stored truth.
        this.disable(CONFLICT_MESSAGE)
        this.opts.onConflict?.(CONFLICT_MESSAGE)
        return
      }
      // Everything else (quota, missing image bytes, storage held by another tab) wrote
      // nothing and can be retried.
      const message = e instanceof Error && e.message ? e.message : 'Unknown storage error.'
      this.setStatus({ kind: 'error', message })
      return
    }
    if (this.disabled) return
    if (this.changedWhileSaving) {
      this.markDirty()
    } else {
      this.setStatus({ kind: 'saved', at: this.now() })
    }
  }
}
