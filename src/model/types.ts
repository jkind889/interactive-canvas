export const DOC_VERSION = 1
export const DEFAULT_TITLE = 'Untitled board'

export interface RecordBase {
  /** Stable identity across undo/redo and reloads. */
  id: string
  /** Top-left of the object in scene coordinates (before rotation). */
  left: number
  top: number
  /** Degrees, clockwise. */
  angle: number
}

export interface ImageRecord extends RecordBase {
  type: 'image'
  /** Key into the asset store; bytes are never inlined in the document. */
  assetId: string
  scaleX: number
  scaleY: number
}

export interface TextRecord extends RecordBase {
  type: 'text'
  text: string
  fontSize: number
  /** Wrapping width in scene units. */
  width: number
}

export type ObjectRecord = ImageRecord | TextRecord

export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

/** The persisted board. Array order is z-order, back to front. */
export interface BoardDoc {
  version: typeof DOC_VERSION
  title: string
  objects: ObjectRecord[]
  viewport: Viewport
}

export interface StoredAsset {
  id: string
  name: string
  type: string
  bytes: ArrayBuffer
}

export type SaveState =
  | { kind: 'loading' }
  /** Fresh board, nothing has been written yet. */
  | { kind: 'new' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  /** Saving is switched off (storage unavailable or stored board unreadable). */
  | { kind: 'unavailable'; message: string }
