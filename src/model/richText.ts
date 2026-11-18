import type { FontId, TextRecord, TextSpan } from './types.ts'

/**
 * Formatting on a text box, as the document stores it. Pure: no Fabric, no DOM.
 *
 * Every span list and heading list the app holds is in one canonical form, so that two
 * texts that look the same are stored the same, and "a commit that changes nothing
 * records nothing" stays exact:
 * - spans: integer offsets with 0 <= start < end <= text.length, sorted, non-overlapping,
 *   adjacent spans with identical marks merged, every span with at least one mark, marks
 *   only ever `true`;
 * - a span never starts or ends inside a character (a surrogate pair or any other
 *   grapheme cluster, the unit the canvas styles): a half-marked character counts as
 *   marked, so the span grows outwards to cover it whole;
 * - a line break is not a character of its own: it carries exactly the marks that the
 *   nearest characters on both sides of it share, so a bold run continues across a break
 *   only when both lines are bold there;
 * - a heading line is always bold, so `bold` is never stored inside one;
 * - headings: levels 0 to 3, one per paragraph at most, trailing zeros trimmed.
 * Absent (undefined) means none.
 */

export const FONT_IDS: readonly FontId[] = ['sans', 'serif', 'mono', 'hand', 'display']
export const FONT_LABELS: Readonly<Record<FontId, string>> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  hand: 'Handwritten',
  display: 'Display',
}
export const DEFAULT_FONT: FontId = 'sans'

/** The default ink of a text. Never stored: a text in this colour has no `color`. */
export const DEFAULT_TEXT_COLOR = '#1d2230'

export type Mark = 'bold' | 'italic' | 'underline' | 'strike'
export const MARKS: readonly Mark[] = ['bold', 'italic', 'underline', 'strike']

export type HeadingLevel = 1 | 2 | 3
/** A heading is drawn at this multiple of its box's font size. */
export const HEADING_SCALE: Readonly<Record<HeadingLevel, number>> = { 1: 2, 2: 1.5, 3: 1.25 }

export const isHeadingLevel = (v: unknown): v is HeadingLevel => v === 1 || v === 2 || v === 3

export function headingFontSize(base: number, level: HeadingLevel): number {
  return base * HEADING_SCALE[level]
}

/** The formatting fields of a text record, each present only when it is not the default. */
export type TextFormatting = Pick<TextRecord, 'font' | 'align' | 'color' | 'spans' | 'headings'>

// ---- characters and paragraphs ----------------------------------------------------------

interface Segmenter {
  segment(s: string): Iterable<{ segment: string }>
}
let segmenter: Segmenter | null | undefined

/**
 * Splits a line into user-perceived characters exactly as Fabric does (fabric 7.4.0,
 * util/lang_string.mjs: an `Intl.Segmenter` with granularity "grapheme" and the default
 * locale, or code points where there is none).
 */
export function splitGraphemes(s: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  }
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s)
}

export interface Paragraph {
  /** UTF-16 offset of the paragraph's first character. */
  start: number
  /** UTF-16 offset just past its last character (before its line break). */
  end: number
  /** The UTF-16 offset at which each of its characters starts. */
  chars: number[]
}

/**
 * The paragraphs of a text (`text.split('\n')`) with their characters. Like Fabric, a
 * "\r" directly before a "\n" belongs to the line break, not to the line.
 */
export function paragraphsOf(text: string): Paragraph[] {
  const out: Paragraph[] = []
  let start = 0
  for (const part of text.split('\n')) {
    const len = part.endsWith('\r') && start + part.length < text.length ? part.length - 1 : part.length
    const chars: number[] = []
    let o = start
    for (const g of splitGraphemes(part.slice(0, len))) {
      chars.push(o)
      o += g.length
    }
    out.push({ start, end: start + len, chars })
    start += part.length + 1
  }
  return out
}

export const paragraphCount = (text: string): number => text.split('\n').length

// ---- canonical form -----------------------------------------------------------------------

const BIT: Readonly<Record<Mark, number>> = { bold: 1, italic: 2, underline: 4, strike: 8 }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Heading levels per paragraph in canonical form; invalid levels count as 0. */
export function canonicalHeadings(text: string, raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const n = Math.min(raw.length, paragraphCount(text))
  const out = Array.from({ length: n }, (_, i): number => (isHeadingLevel(raw[i]) ? raw[i] : 0))
  while (out.length > 0 && out[out.length - 1] === 0) out.pop()
  return out.length > 0 ? out : undefined
}

/**
 * Spans in canonical form for `text`, given its canonical `headings`. Entries that are not
 * spans (non-integer offsets, nothing marked, empty after trimming to the text) are dropped;
 * overlapping spans combine their marks.
 */
export function canonicalSpans(text: string, raw: unknown, headings?: readonly number[]): TextSpan[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || text === '') return undefined
  // How many valid spans cover each code unit, per mark (a difference array, summed below).
  const cover = MARKS.map(() => new Int32Array(text.length + 1))
  let any = false
  for (const s of raw) {
    if (!isObj(s) || !Number.isInteger(s.start) || !Number.isInteger(s.end)) continue
    const a = Math.max(0, s.start as number)
    const b = Math.min(text.length, s.end as number)
    if (a >= b) continue
    MARKS.forEach((m, i) => {
      if (s[m] !== true) return
      const c = cover[i] as Int32Array
      c[a] = (c[a] ?? 0) + 1
      c[b] = (c[b] ?? 0) - 1
      any = true
    })
  }
  if (!any) return undefined
  // Mask of the marks on each code unit.
  const unitMask = new Uint8Array(text.length)
  cover.forEach((c, i) => {
    let n = 0
    for (let k = 0; k < text.length; k++) {
      n += c[k] ?? 0
      if (n > 0) unitMask[k] = (unitMask[k] ?? 0) | (1 << i)
    }
  })
  return spansFromCharMasks(text, headings, (a, b) => {
    let mask = 0
    for (let k = a; k < b; k++) mask |= unitMask[k] ?? 0
    return mask
  })
}

/**
 * Builds canonical spans from the marks of each character (given as its UTF-16 range).
 * Shared by loading and by reading a text back from the canvas, so both agree exactly.
 */
export function spansFromCharMasks(text: string, headings: readonly number[] | undefined, maskOf: (start: number, end: number) => number): TextSpan[] | undefined {
  interface Unit {
    start: number
    end: number
    mask: number
    isBreak: boolean
  }
  const units: Unit[] = []
  const paras = paragraphsOf(text)
  paras.forEach((p, pi) => {
    const keep = (headings?.[pi] ?? 0) > 0 ? ~BIT.bold : ~0 // a heading is bold already
    p.chars.forEach((a, k) => {
      const b = p.chars[k + 1] ?? p.end
      units.push({ start: a, end: b, mask: maskOf(a, b) & keep & 15, isBreak: false })
    })
    const next = paras[pi + 1]
    if (next) units.push({ start: p.end, end: next.start, mask: 0, isBreak: true })
  })
  // A line break carries the marks shared by the nearest characters on either side of it.
  const after = new Array<number>(units.length).fill(0)
  for (let i = units.length - 1, m = 0; i >= 0; i--) {
    after[i] = m
    const u = units[i] as Unit
    if (!u.isBreak) m = u.mask
  }
  let before = 0
  units.forEach((u, i) => {
    if (u.isBreak) u.mask = before & (after[i] ?? 0)
    else before = u.mask
  })

  const out: TextSpan[] = []
  let lastMask = 0
  for (const u of units) {
    if (u.mask === 0) continue
    const last = out[out.length - 1]
    if (last && last.end === u.start && lastMask === u.mask) {
      last.end = u.end
      continue
    }
    const span: TextSpan = { start: u.start, end: u.end }
    for (const m of MARKS) if (u.mask & BIT[m]) span[m] = true
    out.push(span)
    lastMask = u.mask
  }
  return out.length > 0 ? out : undefined
}

/** The marks of a span as a bit mask (see `spansFromCharMasks`). */
export function markMask(marks: Partial<Record<Mark, unknown>>): number {
  let mask = 0
  for (const m of MARKS) if (marks[m] === true) mask |= BIT[m]
  return mask
}

const COLOR = /^#[0-9a-f]{6}$/i

/**
 * The formatting of a text in canonical form, from untrusted values (a stored record, or
 * what the canvas holds). Anything malformed is dropped or trimmed, never fatal; defaults
 * are absent. Keys come in a fixed order: font, align, color, spans, headings.
 */
export function canonicalTextFormatting(text: string, raw: Record<string, unknown>): TextFormatting {
  const out: TextFormatting = {}
  const { font, align, color } = raw
  if (FONT_IDS.includes(font as FontId) && font !== DEFAULT_FONT) out.font = font as FontId
  if (align === 'center' || align === 'right') out.align = align
  if (typeof color === 'string' && COLOR.test(color) && color.toLowerCase() !== DEFAULT_TEXT_COLOR) out.color = color.toLowerCase()
  const headings = canonicalHeadings(text, raw.headings)
  const spans = canonicalSpans(text, raw.spans, headings)
  if (spans) out.spans = spans
  if (headings) out.headings = headings
  return out
}
