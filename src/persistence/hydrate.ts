import type { BoardDoc, ObjectRecord, StoredAsset } from '../model/types.ts'
import { UnreadableBoardError } from './boardStore.ts'
import type { BoardStore } from './boardStore.ts'

export type HydrationOutcome =
  /** Nothing stored yet: a genuinely new board. */
  | { kind: 'empty' }
  /** Everything stored was restored; saving may be enabled. */
  | { kind: 'restored'; doc: BoardDoc }
  /**
   * The stored board could not be fully restored. The session must be read-only
   * (no edits, no saving, no pruning) so the original document and image bytes are
   * never replaced. `partial` (if any) is only what could be shown; it must never
   * be persisted.
   */
  | { kind: 'blocked'; message: string; partial: BoardDoc | null }

const reason = (e: unknown) => (e instanceof Error && e.message ? e.message : 'unknown error')

/**
 * Loads the stored board and proves every image in it can be decoded. Fails
 * closed: any unreadable document, storage error, missing asset or undecodable
 * asset yields `blocked`, never a silently reduced board.
 */
export async function hydrateBoard(store: BoardStore, decode: (asset: StoredAsset) => Promise<unknown>): Promise<HydrationOutcome> {
  let loaded
  try {
    loaded = await store.load()
  } catch (e) {
    return {
      kind: 'blocked',
      partial: null,
      message:
        e instanceof UnreadableBoardError
          ? 'The saved board could not be read. It is shown read-only so it cannot be overwritten.'
          : `Local storage is unavailable (${reason(e)}). The board is read-only because changes could not be saved.`,
    }
  }
  if (!loaded) return { kind: 'empty' }

  const usable: ObjectRecord[] = []
  let failed = 0
  for (const rec of loaded.doc.objects) {
    if (rec.type === 'text') {
      usable.push(rec)
      continue
    }
    const asset = loaded.assets.get(rec.assetId)
    if (!asset) {
      failed++
      continue
    }
    try {
      await decode(asset)
      usable.push(rec)
    } catch {
      failed++
    }
  }

  if (failed > 0) {
    return {
      kind: 'blocked',
      partial: { ...loaded.doc, objects: usable },
      message: `${failed} saved image${failed === 1 ? '' : 's'} could not be loaded. The board is read-only so the original and its images stay exactly as stored.`,
    }
  }
  return { kind: 'restored', doc: loaded.doc }
}
