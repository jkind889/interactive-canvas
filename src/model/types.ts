/** In-memory document version. The wire format may be older; see `StoredDoc`. */
export const DOC_VERSION = 2
export const DEFAULT_TITLE = 'Untitled board'

export interface RecordBase {
  /** Stable identity across undo/redo and reloads. */
  id: string
  /** Top-left of the object in scene coordinates (before rotation). */
  left: number
  top: number
  /** Degrees, clockwise. */
  angle: number
  /**
   * The frame that owns this object, if any. Ownership is stored, never recomputed:
   * an owner need not contain the object, and an object inside a frame need not be owned by it.
   */
  frameId?: string
}

export interface ImageRecord extends RecordBase {
  type: 'image'
  /** Key into the asset store; bytes are never inlined in the document. */
  assetId: string
  scaleX: number
  scaleY: number
}

/** A named font choice. The board stores the id, never a font name (see src/editor/fonts.ts). */
export type FontId = 'sans' | 'serif' | 'mono' | 'hand' | 'display'

/**
 * Formatting on a range of a text's characters. Offsets are UTF-16 code units into the
 * text; a span may cross a line break. Marks are present only when on, and a font only
 * when different from the box font. See src/model/richText.ts for the
 * canonical form every stored and in-memory span list is in.
 */
export interface TextSpan {
  start: number
  end: number
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  font?: FontId
}

/**
 * Formatting fields are absent when they have their default, so a plain text has exactly
 * the milestone 1 keys.
 */
export interface TextRecord extends RecordBase {
  type: 'text'
  text: string
  /** The box's own size; headings are drawn larger (see HEADING_SCALE). */
  fontSize: number
  /** Wrapping width in scene units. */
  width: number
  /** Absent: 'sans'. */
  font?: FontId
  /** Absent: left. */
  align?: 'center' | 'right'
  /** `#rrggbb`, lower case. Absent: the default ink. */
  color?: string
  spans?: TextSpan[]
  /** Heading level (0 to 3) per paragraph (`text.split('\n')`), trailing zeros trimmed. */
  headings?: number[]
}

export type ObjectRecord = ImageRecord | TextRecord

/** A named, unrotated rectangle in scene coordinates. */
export interface FrameRecord {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
}

export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

/**
 * The board as the app holds it. `frames` and `objects` are each in z-order, back to
 * front; every frame sits behind every object.
 */
export interface BoardDoc {
  version: typeof DOC_VERSION
  title: string
  frames: FrameRecord[]
  objects: ObjectRecord[]
  viewport: Viewport
}

/** What undo/redo and gestures snapshot: everything on the canvas, nothing about the view. */
export type Scene = Pick<BoardDoc, 'frames' | 'objects'>

/** Exactly the shape milestone 1 wrote. Still written for any board without frames. */
export interface StoredDocV1 {
  version: 1
  title: string
  objects: Array<Omit<ImageRecord, 'frameId'> | Omit<TextRecord, 'frameId'>>
  viewport: Viewport
}

export interface StoredDocV2 {
  version: 2
  title: string
  frames: FrameRecord[]
  objects: ObjectRecord[]
  viewport: Viewport
}

/** The document as stored on disk. */
export type StoredDoc = StoredDocV1 | StoredDocV2

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
