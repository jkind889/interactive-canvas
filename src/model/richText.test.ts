import { describe, expect, it } from 'vitest'
import {
  FONT_IDS,
  FONT_LABELS,
  HEADING_SCALE,
  canonicalHeadings,
  canonicalSpans,
  canonicalTextFormatting,
  headingFontSize,
  paragraphsOf,
  splitGraphemes,
} from './richText.ts'

const spans = (text: string, raw: unknown, headings?: number[]) => canonicalSpans(text, raw, headings)

describe('canonical spans', () => {
  it('text without formatting has none', () => {
    expect(spans('abc', undefined)).toBeUndefined()
    expect(spans('abc', [])).toBeUndefined()
    expect(spans('abc', 'bold')).toBeUndefined()
    expect(spans('', [{ start: 0, end: 1, bold: true }])).toBeUndefined()
    expect(canonicalTextFormatting('abc', {})).toStrictEqual({})
  })

  it('overlapping spans combine their marks into non-overlapping runs', () => {
    expect(spans('abcdef', [{ start: 0, end: 4, bold: true }, { start: 2, end: 6, italic: true }])).toStrictEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 4, bold: true, italic: true },
      { start: 4, end: 6, italic: true },
    ])
  })

  it('trims spans to the text and drops what is left empty, reversed or zero-length', () => {
    expect(spans('abcdef', [{ start: -3, end: 2, bold: true }, { start: 4, end: 99, italic: true }])).toStrictEqual([
      { start: 0, end: 2, bold: true },
      { start: 4, end: 6, italic: true },
    ])
    expect(spans('abcdef', [{ start: 2, end: 2, bold: true }, { start: 4, end: 1, bold: true }, { start: 7, end: 9, bold: true }])).toBeUndefined()
  })

  it('drops entries that are not spans: non-integer offsets, non-objects', () => {
    expect(spans('abcdef', [{ start: 0.5, end: 3, bold: true }, { start: '0', end: 3, bold: true }, { end: 3, bold: true }])).toBeUndefined()
    expect(spans('abcdef', [null, 3, 'x', [0, 2], { start: 0, end: 1, bold: true }])).toStrictEqual([{ start: 0, end: 1, bold: true }])
  })

  it('sorts unsorted spans', () => {
    expect(spans('abcdef', [{ start: 4, end: 6, bold: true }, { start: 0, end: 2, italic: true }])).toStrictEqual([
      { start: 0, end: 2, italic: true },
      { start: 4, end: 6, bold: true },
    ])
  })

  it('merges adjacent and overlapping spans with identical marks', () => {
    expect(spans('abcdef', [{ start: 0, end: 2, bold: true }, { start: 2, end: 4, bold: true }])).toStrictEqual([{ start: 0, end: 4, bold: true }])
    expect(spans('abcdef', [{ start: 0, end: 3, bold: true }, { start: 1, end: 5, bold: true }])).toStrictEqual([{ start: 0, end: 5, bold: true }])
  })

  it('a mark counts only when it is exactly true; a span with no mark is dropped; no false keys survive', () => {
    expect(spans('abc', [{ start: 0, end: 3, bold: 'yes', italic: 1, underline: false, strike: null }])).toBeUndefined()
    const out = spans('abc', [{ start: 0, end: 3, bold: true, italic: false, colour: 'red' }])
    expect(out).toStrictEqual([{ start: 0, end: 3, bold: true }])
    expect(Object.keys(out![0]!)).toEqual(['start', 'end', 'bold'])
    expect(spans('abc', [{ start: 0, end: 3, strike: true, underline: true, italic: true, bold: true }])).toStrictEqual([
      { start: 0, end: 3, bold: true, italic: true, underline: true, strike: true },
    ])
  })

  it('never stores bold inside a heading line (a heading is bold already); other marks stay', () => {
    expect(spans('Title\nbody', [{ start: 0, end: 10, bold: true }], [1])).toStrictEqual([{ start: 6, end: 10, bold: true }])
    expect(spans('Title\nbody', [{ start: 0, end: 5, bold: true, italic: true }], [2])).toStrictEqual([{ start: 0, end: 5, italic: true }])
    expect(spans('Title\nbody', [{ start: 0, end: 5, bold: true }], [0, 3])).toStrictEqual([{ start: 0, end: 5, bold: true }])
  })

  it('a line break carries only the marks shared by the characters on both sides of it', () => {
    expect(spans('ab\ncd', [{ start: 0, end: 5, bold: true }])).toStrictEqual([{ start: 0, end: 5, bold: true }])
    expect(spans('ab\ncd', [{ start: 0, end: 2, bold: true }, { start: 3, end: 5, bold: true }])).toStrictEqual([{ start: 0, end: 5, bold: true }])
    expect(spans('ab\n\ncd', [{ start: 0, end: 6, italic: true }])).toStrictEqual([{ start: 0, end: 6, italic: true }]) // across an empty line
    expect(spans('ab\ncd', [{ start: 2, end: 3, bold: true }])).toBeUndefined() // the break alone is not a character
    expect(spans('ab\ncd', [{ start: 0, end: 4, bold: true }])).toStrictEqual([{ start: 0, end: 4, bold: true }])
    expect(spans('ab\n', [{ start: 0, end: 3, bold: true }])).toStrictEqual([{ start: 0, end: 2, bold: true }]) // nothing after it
    expect(spans('ab\ncd', [{ start: 1, end: 4, bold: true, italic: true }, { start: 4, end: 5, bold: true }])).toStrictEqual([
      { start: 1, end: 4, bold: true, italic: true }, // "b", the break and "c"
      { start: 4, end: 5, bold: true },
    ])
  })

  it('"\\r\\n" is one line break, like on the canvas: the "\\r" is not a character', () => {
    expect(spans('ab\r\ncd', [{ start: 2, end: 3, bold: true }])).toBeUndefined()
    expect(spans('ab\r\ncd', [{ start: 0, end: 2, bold: true }, { start: 4, end: 6, bold: true }])).toStrictEqual([{ start: 0, end: 6, bold: true }])
    expect(paragraphsOf('ab\r\ncd')).toEqual([
      { start: 0, end: 2, chars: [0, 1] },
      { start: 4, end: 6, chars: [4, 5] },
    ])
  })

  it('a boundary inside a character (surrogate pair or grapheme cluster) grows outwards to cover it', () => {
    // "a😀b": the emoji is code units 1..3.
    expect(spans('a😀b', [{ start: 2, end: 4, bold: true }])).toStrictEqual([{ start: 1, end: 4, bold: true }])
    expect(spans('a😀b', [{ start: 0, end: 2, bold: true }])).toStrictEqual([{ start: 0, end: 3, bold: true }])
    expect(spans('a😀b', [{ start: 1, end: 3, bold: true }])).toStrictEqual([{ start: 1, end: 3, bold: true }]) // already whole
    // "e" + combining acute accent is one character.
    expect(spans('éx', [{ start: 1, end: 3, italic: true }])).toStrictEqual([{ start: 0, end: 3, italic: true }])
    // A family emoji joined by ZWJ is one character of 8 code units.
    const family = '👨‍👩‍👧'
    expect(splitGraphemes(`${family}z`)).toEqual([family, 'z'])
    expect(spans(`${family}z`, [{ start: 3, end: 4, bold: true }])).toStrictEqual([{ start: 0, end: family.length, bold: true }])
  })

  it('is idempotent', () => {
    const text = 'Title\n\nsome 😀 bold\nend'
    const once = spans(text, [{ start: 0, end: 13, bold: true }, { start: 9, end: 20, italic: true }], [1, 2])
    expect(spans(text, once, [1, 2])).toStrictEqual(once)
  })
})

describe('canonical headings', () => {
  it('trims trailing zeros, and none at all is absent', () => {
    expect(canonicalHeadings('a\nb\nc', [0, 2, 0])).toStrictEqual([0, 2])
    expect(canonicalHeadings('a\nb\nc', [0, 0])).toBeUndefined()
    expect(canonicalHeadings('a\nb\nc', [])).toBeUndefined()
    expect(canonicalHeadings('a', 1)).toBeUndefined()
    expect(canonicalHeadings('a', undefined)).toBeUndefined()
  })

  it('invalid levels count as 0', () => {
    expect(canonicalHeadings('a\nb\nc\nd\ne\nf', [5, 'x', 1.5, -1, null, 3])).toStrictEqual([0, 0, 0, 0, 0, 3])
    // eslint-disable-next-line no-sparse-arrays
    expect(canonicalHeadings('a\nb', [, 1])).toStrictEqual([0, 1])
  })

  it('never has more entries than paragraphs (including an empty last one)', () => {
    expect(canonicalHeadings('a\nb', [1, 2, 3])).toStrictEqual([1, 2])
    expect(canonicalHeadings('a\n', [0, 3, 1])).toStrictEqual([0, 3])
    expect(canonicalHeadings('', [2, 1])).toStrictEqual([2]) // an empty text is one empty paragraph
  })
})

describe('font, alignment and colour', () => {
  it('drops defaults and anything unknown; colours are lower case', () => {
    const f = (raw: Record<string, unknown>) => canonicalTextFormatting('x', raw)
    expect(f({ font: 'sans' })).toStrictEqual({})
    expect(f({ font: 'comic' })).toStrictEqual({})
    expect(f({ font: 'serif' })).toStrictEqual({ font: 'serif' })
    expect(f({ align: 'left' })).toStrictEqual({})
    expect(f({ align: 'justify' })).toStrictEqual({})
    expect(f({ align: 'center' })).toStrictEqual({ align: 'center' })
    expect(f({ align: 'right' })).toStrictEqual({ align: 'right' })
    expect(f({ color: '#1d2230' })).toStrictEqual({}) // the default ink
    expect(f({ color: '#1D2230' })).toStrictEqual({})
    expect(f({ color: '#ABCDEF' })).toStrictEqual({ color: '#abcdef' })
    expect(f({ color: 'red' })).toStrictEqual({})
    expect(f({ color: '#abc' })).toStrictEqual({})
    expect(f({ color: 0xabcdef })).toStrictEqual({})
  })

  it('keeps its keys in one order', () => {
    const out = canonicalTextFormatting('ab\ncd', { headings: [1], spans: [{ start: 3, end: 5, bold: true }], color: '#ff0000', align: 'right', font: 'mono' })
    expect(Object.keys(out)).toEqual(['font', 'align', 'color', 'spans', 'headings'])
  })
})

describe('tables', () => {
  it('heading sizes are 2, 1.5 and 1.25 times the base size', () => {
    expect(HEADING_SCALE).toEqual({ 1: 2, 2: 1.5, 3: 1.25 })
    expect(headingFontSize(24, 1)).toBe(48)
    expect(headingFontSize(24, 2)).toBe(36)
    expect(headingFontSize(24, 3)).toBe(30)
  })

  it('every font id has a label', () => {
    expect(FONT_IDS).toEqual(['sans', 'serif', 'mono', 'hand', 'display'])
    for (const id of FONT_IDS) expect(FONT_LABELS[id]).toBeTruthy()
  })
})
