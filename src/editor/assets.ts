import type { StoredAsset } from '../model/types.ts'
import { newId } from './objects.ts'

export function isImageFile(file: Pick<File, 'type'>): boolean {
  return file.type.startsWith('image/')
}

/** Reads the file's bytes so they can be stored independent of the File handle. */
export async function readImageFile(file: File): Promise<StoredAsset> {
  if (!isImageFile(file)) throw new Error(`${file.name || 'File'} is not an image.`)
  return { id: newId(), name: file.name || 'image', type: file.type, bytes: await file.arrayBuffer() }
}

/** What the editor needs from an asset cache (injectable so tests need no image decoding). */
export interface AssetSource {
  get(id: string): HTMLImageElement | undefined
  load(asset: StoredAsset): Promise<HTMLImageElement>
  dispose(): void
}

/**
 * Decoded images keyed by asset id. Fabric objects are rebuilt from these
 * elements synchronously (undo/redo/restore), so decoding happens only once.
 */
export class AssetCache implements AssetSource {
  private entries = new Map<string, { url: string; element: HTMLImageElement }>()

  get(id: string): HTMLImageElement | undefined {
    return this.entries.get(id)?.element
  }

  async load(asset: StoredAsset): Promise<HTMLImageElement> {
    const existing = this.get(asset.id)
    if (existing) return existing
    const url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.type }))
    const element = new Image()
    element.src = url
    try {
      await element.decode()
      if (element.naturalWidth === 0 || element.naturalHeight === 0) throw new Error('Image has no size.')
    } catch {
      URL.revokeObjectURL(url)
      throw new Error(`${asset.name} could not be decoded as an image.`)
    }
    this.entries.set(asset.id, { url, element })
    return element
  }

  dispose() {
    for (const { url } of this.entries.values()) URL.revokeObjectURL(url)
    this.entries.clear()
  }
}
