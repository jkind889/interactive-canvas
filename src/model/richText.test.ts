import { describe, expect, it } from 'vitest'
import {
  FONT_IDS,
  FONT_LABELS,
  HEADING_SCALE,
  canonicalHeadings,
  canonicalSpans,
  canonicalTextFormatting,
  diffText,
  formatAtCaret,
  formatOfRange,
  formatOfText,
  headingFontSize,
  headingsAfterEdit,
  linesOfRange,
  markMask,
  marksAtCaret,
  paragraphsOf,
  setHeading,
  setHeadingEverywhere,
  splitGraphemes,
  textAfterEdit,
  toggleMark,
  togglePendingMark,
  withPendingMarks,
} from './richText.ts'
import type { Mark, TextFormatting } from './richText.ts'

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

describe('lenient parsing stays bounded on hostile input', () => {
  it('a huge sparse span list is dropped at once, not walked hole by hole', () => {
    const sparse: unknown[] = []
    sparse.length = 2 ** 32 - 1
    sparse[0] = { start: 0, end: 1, bold: true }
    const t0 = performance.now()
    expect(spans('abc', sparse)).toBeUndefined()
    expect(canonicalTextFormatting('abc', { spans: sparse })).toStrictEqual({})
    expect(performance.now() - t0).toBeLessThan(50)
  })

  it('any span list longer than the text is dropped: a canonical one never is', () => {
    const many = Array.from({ length: 4 }, () => ({ start: 0, end: 1, bold: true }))
    expect(spans('abc', many)).toBeUndefined()
    expect(spans('abcd', many)).toStrictEqual([{ start: 0, end: 1, bold: true }])
  })

  it('a huge sparse heading list is read only as far as the text has lines', () => {
    const sparse: unknown[] = []
    sparse.length = 2 ** 32 - 1
    sparse[1] = 2
    const t0 = performance.now()
    expect(canonicalHeadings('a\nb', sparse)).toStrictEqual([0, 2])
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

describe('the changed region of an edit', () => {
  it('is the longest common prefix, then the longest common suffix, without a caret', () => {
    expect(diffText('abc', 'abXc')).toEqual({ start: 2, prevEnd: 2, nextEnd: 3 })
    expect(diffText('abc', 'ac')).toEqual({ start: 1, prevEnd: 2, nextEnd: 1 })
    expect(diffText('', 'ab')).toEqual({ start: 0, prevEnd: 0, nextEnd: 2 })
    expect(diffText('ab', '')).toEqual({ start: 0, prevEnd: 2, nextEnd: 0 })
    expect(diffText('ab', 'ab')).toEqual({ start: 2, prevEnd: 2, nextEnd: 2 })
  })

  it('ends at the caret when the caret fits, among repeated characters', () => {
    // "aa" -> "aaa": the new "a" is the first, second or third depending on the caret.
    expect(diffText('aa', 'aaa', 1)).toEqual({ start: 0, prevEnd: 0, nextEnd: 1 })
    expect(diffText('aa', 'aaa', 2)).toEqual({ start: 1, prevEnd: 1, nextEnd: 2 })
    expect(diffText('aa', 'aaa', 3)).toEqual({ start: 2, prevEnd: 2, nextEnd: 3 })
    expect(diffText('aa', 'aaa')).toEqual({ start: 2, prevEnd: 2, nextEnd: 3 })
    // Backspace and forward Delete leave the caret where the deletion was.
    expect(diffText('abba', 'aba', 1)).toEqual({ start: 1, prevEnd: 2, nextEnd: 1 })
    expect(diffText('abba', 'aba', 2)).toEqual({ start: 2, prevEnd: 3, nextEnd: 2 })
  })

  it('ignores a caret that does not fit the change', () => {
    expect(diffText('aa', 'aaa', 9)).toEqual(diffText('aa', 'aaa'))
    expect(diffText('abc', 'abXc', 0)).toEqual({ start: 2, prevEnd: 2, nextEnd: 3 })
    expect(diffText('abc', 'abXc', 1.5)).toEqual({ start: 2, prevEnd: 2, nextEnd: 3 })
  })

  it('never splits a surrogate pair or a "\\r\\n" line break', () => {
    // 😀 and 😁 share their first code unit.
    expect(diffText('x😀y', 'x😁y')).toEqual({ start: 1, prevEnd: 3, nextEnd: 3 })
    expect(diffText('a\r\nb', 'a\nb')).toEqual({ start: 1, prevEnd: 3, nextEnd: 2 })
  })
})

describe('heading levels carried across an edit', () => {
  const H = headingsAfterEdit

  it('typing in a line keeps every level; lines below shift when lines are added or removed above', () => {
    expect(H('Title\nbody', [1], 'Tixtle\nbody', 3)).toStrictEqual([1])
    expect(H('Title\nbody', [1], 'Title\nbodyx', 11)).toStrictEqual([1])
    expect(H('a\nTitle', [0, 1], 'a\n\nTitle', 2)).toStrictEqual([0, 0, 1])
    expect(H('a\n\nTitle', [0, 0, 1], 'a\nTitle', 2)).toStrictEqual([0, 1])
  })

  it('pasting text copied from a heading into a normal line leaves it normal, and normal text into a heading leaves it a heading', () => {
    expect(H('Title\nbody', [1], 'Title\nTitlebody', 11)).toStrictEqual([1])
    expect(H('Title\nbody', [1], 'bodyTitle\nbody', 4)).toStrictEqual([1])
  })

  it('Enter at the end of a heading starts a normal line; in the middle it leaves two headings', () => {
    expect(H('Title\nbody', [1], 'Title\n\nbody', 6)).toStrictEqual([1])
    expect(H('Title', [2], 'Title\n', 6)).toStrictEqual([2])
    expect(H('Title', [1], 'Ti\ntle', 3)).toStrictEqual([1, 1])
  })

  it('Enter at the start of a heading leaves an empty heading line above it (the line it started in keeps its level)', () => {
    expect(H('body\nTitle', [0, 1], 'body\n\nTitle', 6)).toStrictEqual([0, 1, 1])
  })

  it('the caret decides which of two identical results was meant', () => {
    // The same new text, from Enter at the end of "body" or at the start of "Title".
    expect(H('body\nTitle', [0, 1], 'body\n\nTitle', 5)).toStrictEqual([0, 0, 1])
    expect(H('body\nTitle', [0, 1], 'body\n\nTitle', 6)).toStrictEqual([0, 1, 1])
    // Enter on an empty heading line, or at the end of the normal line above it.
    expect(H('a\n\nb', [0, 2], 'a\n\n\nb', 3)).toStrictEqual([0, 2])
    expect(H('a\n\nb', [0, 2], 'a\n\n\nb', 2)).toStrictEqual([0, 0, 2])
    // Without a caret (or with one that does not fit): the longest common prefix wins.
    expect(H('body\nTitle', [0, 1], 'body\n\nTitle')).toStrictEqual([0, 1, 1])
    expect(H('body\nTitle', [0, 1], 'body\n\nTitle', 99)).toStrictEqual([0, 1, 1])
  })

  it('a multi-line paste: the first line joins the line pasted into, lines in between are normal, the last follows its remaining text', () => {
    expect(H('Title\nbody', [1], 'TiA\nB\nCtle\nbody', 7)).toStrictEqual([1, 0, 1])
    expect(H('Title\nbody', [1], 'TitleA\nB\nbody', 8)).toStrictEqual([1])
    expect(H('Title\nbody', [1], 'Title\nbA\nBody', 10)).toStrictEqual([1])
    expect(H('Title\nbody', [0, 1], 'TitlA\nBe\nbody', 7)).toStrictEqual([0, 0, 1])
  })

  it('joining lines keeps the level of the line the change starts in', () => {
    expect(H('Title\nbody', [1], 'Titlebody', 5)).toStrictEqual([1]) // Backspace at the start of a normal line under a heading
    expect(H('body\nTitle', [0, 1], 'bodyTitle', 4)).toBeUndefined() // Backspace at the start of a heading under a normal line
    expect(H('ab\nTitle', [0, 1], 'abTitle', 2)).toBeUndefined() // forward Delete at the end of the normal line
    expect(H('Title\nbody', [0, 1], 'Tidy', 2)).toBeUndefined() // a selection from the middle of a line across the break
    expect(H('Title\n\nbody', [1], 'Title\nbody', 5)).toStrictEqual([1]) // Delete at the end of a heading, over an empty line
    expect(H('Title\n\nbody', [0, 1], 'Title\nbody', 5)).toBeUndefined() // Backspace on an empty heading line
  })

  it('unless nothing of that line is left before the change and text of a later line follows it', () => {
    expect(H('\nTitle', [0, 1], 'Title', 0)).toStrictEqual([1]) // Backspace at the start of a heading under an empty line
    expect(H('ab\nTitle', [0, 1], 'tle', 0)).toStrictEqual([1]) // "ab\nTi" selected and deleted
    expect(H('Title\nbody', [1], 'body', 0)).toBeUndefined() // a whole heading line deleted with its break
    expect(H('Title\nbody', [1], 'x', 1)).toStrictEqual([1]) // everything selected and typed over: nothing follows
  })

  it('emptying a heading line keeps it a heading', () => {
    expect(H('Title\nbody', [1], '\nbody', 0)).toStrictEqual([1])
    expect(H('Title', [1], 'x', 1)).toStrictEqual([1])
    expect(H('Title', [3], '', 0)).toStrictEqual([3])
  })

  it('a move within the text that keeps the number of lines keeps every level by position', () => {
    // " two" dragged from line 1 to the end of "Title" on line 3: one change, from line 1 to line 3.
    expect(H('one two\nb\nTitle end', [0, 0, 1], 'one\nb\nTitle two end', 15)).toStrictEqual([0, 0, 1])
    expect(H('Title one\nb\nend', [1], 'Title\nb\nend one', 15)).toStrictEqual([1])
  })

  it('from or to an empty text', () => {
    expect(H('', undefined, 'a\nb', 3)).toBeUndefined()
    expect(H('', [1], 'Title', 5)).toStrictEqual([1])
    expect(H('a\nb', [1, 1], '', 0)).toStrictEqual([1])
  })

  it('a stored "\\r\\n" text compares line for line with the "\\n" text typing leaves of it', () => {
    expect(H('Title\r\nbody', [1], 'Title\nbody!', 11)).toStrictEqual([1])
    expect(H('Title\r\nbody', [1], '!Title\nbody', 1)).toStrictEqual([1])
    expect(H('a\r\nTitle', [0, 1], 'aTitle', 1)).toBeUndefined()
    expect(H('a\r\nb\r\nTitle', [0, 0, 1], 'a\nb\n\nTitle', 4)).toStrictEqual([0, 0, 0, 1])
    // The characters after the "\r\n" are recognised as already there, on their own line.
    const typed = textAfterEdit('T\r\nHead', [0, 1], 'xT\nHead', 1)
    expect(typed.levelBefore(3, 4)).toBe(1)
    expect(typed.levelBefore(1, 2)).toBe(0)
  })

  it('an unchanged text keeps its levels, in canonical form', () => {
    expect(H('a\nb', [0, 1, 0, 5], 'a\nb')).toStrictEqual([0, 1])
    expect(H('a\nb', undefined, 'a\nb')).toBeUndefined()
  })

  it('tells which characters were already there, and on what level of line', () => {
    const join = textAfterEdit('body\nTitle', [0, 1], 'bodyTitle', 4)
    expect(join.levelBefore(0, 1)).toBe(0)
    expect(join.levelBefore(4, 5)).toBe(1) // "T" came from the heading
    const typed = textAfterEdit('Title\nab', [1], 'Title\naXb', 8)
    expect(typed.levelBefore(7, 8)).toBeUndefined() // inserted
    expect(typed.levelBefore(0, 1)).toBe(1)
    expect(typed.levelBefore(8, 9)).toBe(0)
    // A character that the change altered (an emoji whose second unit changed) was not there before.
    expect(textAfterEdit('😀', [1], '😁').levelBefore(0, 2)).toBeUndefined()
  })
})

// ---- applying formatting ----------------------------------------------------------------------

describe('toggling a mark on a range', () => {
  const T = (text: string, fmt: TextFormatting, mark: Mark, a: number, b: number) => toggleMark(text, fmt, mark, a, b)

  it('adds the mark to a range that does not all have it, removes it from one that does', () => {
    expect(T('abcdef', {}, 'bold', 1, 3)).toStrictEqual({ spans: [{ start: 1, end: 3, bold: true }] })
    const half: TextFormatting = { spans: [{ start: 1, end: 3, bold: true }] }
    expect(T('abcdef', half, 'bold', 2, 5)).toStrictEqual({ spans: [{ start: 1, end: 5, bold: true }] }) // mixed: on
    expect(T('abcdef', half, 'bold', 1, 3)).toStrictEqual({}) // all of it: off
    expect(T('abcdef', half, 'bold', 2, 3)).toStrictEqual({ spans: [{ start: 1, end: 2, bold: true }] }) // part of a run: off there only
    expect(T('abcdef', half, 'italic', 0, 6)).toStrictEqual({
      spans: [
        { start: 0, end: 1, italic: true },
        { start: 1, end: 3, bold: true, italic: true },
        { start: 3, end: 6, italic: true },
      ],
    })
  })

  it('keeps the other fields and their canonical key order', () => {
    const fmt: TextFormatting = { font: 'serif', align: 'center', color: '#d92d20', headings: [1] }
    const out = T('Title\nbody', fmt, 'italic', 6, 10)
    expect(Object.keys(out)).toEqual(['font', 'align', 'color', 'spans', 'headings'])
    expect(out).toStrictEqual({ ...fmt, spans: [{ start: 6, end: 10, italic: true }] })
  })

  it('treats a surrogate pair (and any grapheme) as one character, whichever half the range touches', () => {
    // "a😀b": the emoji is code units 1 and 2.
    expect(T('a😀b', {}, 'underline', 1, 2)).toStrictEqual({ spans: [{ start: 1, end: 3, underline: true }] })
    expect(T('a😀b', {}, 'underline', 2, 3)).toStrictEqual({ spans: [{ start: 1, end: 3, underline: true }] })
    expect(T('a😀b', { spans: [{ start: 1, end: 3, strike: true }] }, 'strike', 0, 4)).toStrictEqual({ spans: [{ start: 0, end: 4, strike: true }] })
    expect(T('👍🏽x', {}, 'italic', 0, 1)).toStrictEqual({ spans: [{ start: 0, end: 4, italic: true }] }) // a skin-tone emoji: one grapheme of 4 units
  })

  it('across a line break: the break carries the mark when both sides have it', () => {
    expect(T('ab\ncd', {}, 'bold', 1, 4)).toStrictEqual({ spans: [{ start: 1, end: 4, bold: true }] })
    expect(T('ab\ncd', {}, 'bold', 0, 5)).toStrictEqual({ spans: [{ start: 0, end: 5, bold: true }] })
    expect(T('ab\ncd', { spans: [{ start: 0, end: 5, bold: true }] }, 'bold', 1, 4)).toStrictEqual({
      spans: [
        { start: 0, end: 1, bold: true },
        { start: 4, end: 5, bold: true },
      ],
    })
  })

  it('a range with no characters (empty, or only a line break) changes nothing', () => {
    const fmt: TextFormatting = { spans: [{ start: 0, end: 1, bold: true }] }
    expect(T('ab\ncd', fmt, 'bold', 2, 2)).toBe(fmt)
    expect(T('ab\ncd', fmt, 'italic', 2, 3)).toBe(fmt)
    expect(T('', {}, 'bold', 0, 0)).toStrictEqual({})
    expect(T('\n\n', {}, 'bold', 0, 2)).toStrictEqual({})
  })

  it('bold in heading lines: nothing on a range that is all heading, the normal lines only on a mixed range', () => {
    const fmt: TextFormatting = { headings: [1] }
    expect(T('Title\nbody', fmt, 'bold', 0, 5)).toStrictEqual(fmt)
    expect(T('Title\nbody', fmt, 'bold', 0, 10)).toStrictEqual({ spans: [{ start: 6, end: 10, bold: true }], headings: [1] })
    // The normal line already bold: every character of the range is bold, so it is removed.
    const bold: TextFormatting = { spans: [{ start: 6, end: 10, bold: true }], headings: [1] }
    expect(T('Title\nbody', bold, 'bold', 0, 10)).toStrictEqual({ headings: [1] })
    // Other marks are ordinary in a heading line.
    expect(T('Title\nbody', fmt, 'italic', 0, 5)).toStrictEqual({ spans: [{ start: 0, end: 5, italic: true }], headings: [1] })
  })

  it('the whole text, empty lines included', () => {
    expect(T('ab\n\ncd', {}, 'strike', 0, 6)).toStrictEqual({ spans: [{ start: 0, end: 6, strike: true }] })
  })
})

describe('setting headings', () => {
  it('on the caret line, the lines a range touches, and every line', () => {
    const text = 'one\ntwo\nthree'
    expect(setHeading(text, {}, 1, 5, 5)).toStrictEqual({ headings: [0, 1] })
    expect(setHeading(text, {}, 2, 2, 9)).toStrictEqual({ headings: [2, 2, 2] })
    expect(setHeading(text, {}, 3, 0, text.length)).toStrictEqual({ headings: [3, 3, 3] })
    expect(setHeading(text, { headings: [1, 2, 3] }, 0, 4, 7)).toStrictEqual({ headings: [1, 0, 3] })
    expect(setHeading(text, { headings: [1, 2, 3] }, 0, 0, text.length)).toStrictEqual({})
  })

  it('a caret at either end of a line is on that line; a range ending just after a line break does not touch the next line', () => {
    const text = 'one\ntwo'
    expect(setHeading(text, {}, 1, 3, 3)).toStrictEqual({ headings: [1] }) // end of "one"
    expect(setHeading(text, {}, 1, 4, 4)).toStrictEqual({ headings: [0, 1] }) // start of "two"
    expect(setHeading(text, {}, 1, 0, 4)).toStrictEqual({ headings: [1] }) // "one\n"
    expect(setHeading(text, {}, 1, 3, 4)).toStrictEqual({ headings: [1] }) // the break alone
    expect(linesOfRange(text, 0, 5)).toStrictEqual({ first: 0, last: 1 })
  })

  it('every line of the text (a selected box), an empty last line included', () => {
    expect(setHeadingEverywhere('a\nb\n', {}, 2)).toStrictEqual({ headings: [2, 2, 2] })
    expect(setHeadingEverywhere('a\nb\n', { headings: [1, 0, 3] }, 0)).toStrictEqual({})
    expect(formatOfText('Title\n', { headings: [1, 1] }).heading).toBe(1)
    expect(formatOfText('Title\n', { headings: [1] }).heading).toBe('mixed')
    expect(formatOfText('ab\ncd', { spans: [{ start: 0, end: 5, bold: true }] }).marks.bold).toBe('on')
  })

  it('on an empty line, and on the empty last line', () => {
    expect(setHeading('a\n\nb', {}, 2, 2, 2)).toStrictEqual({ headings: [0, 2] })
    expect(setHeading('a\n', {}, 1, 2, 2)).toStrictEqual({ headings: [0, 1] })
    expect(setHeading('', {}, 1, 0, 0)).toStrictEqual({ headings: [1] })
  })

  it('drops bold inside a new heading (implied), so going back to body text leaves the line plain; other marks stay', () => {
    const fmt: TextFormatting = {
      spans: [
        { start: 0, end: 3, bold: true, italic: true },
        { start: 3, end: 7, bold: true },
      ],
    }
    const h = setHeading('one\ntwo', fmt, 1, 0, 0)
    expect(h).toStrictEqual({
      spans: [
        { start: 0, end: 3, italic: true },
        { start: 4, end: 7, bold: true },
      ],
      headings: [1],
    })
    expect(setHeading('one\ntwo', h, 0, 0, 0)).toStrictEqual({
      spans: [
        { start: 0, end: 3, italic: true },
        { start: 4, end: 7, bold: true },
      ],
    })
  })
})

describe('the state the controls show', () => {
  it('a range: each mark on, off or mixed over its characters; the bold of a heading counts as on', () => {
    const fmt = canonicalTextFormatting('Title\nbody', {
      spans: [
        { start: 0, end: 10, italic: true },
        { start: 6, end: 8, bold: true },
      ],
      headings: [1],
    })
    const off = { underline: 'off', strike: 'off' } as const
    expect(formatOfRange('Title\nbody', fmt, 0, 5)).toStrictEqual({ marks: { bold: 'on', italic: 'on', ...off }, heading: 1, boldFromHeading: true })
    expect(formatOfRange('Title\nbody', fmt, 0, 10)).toStrictEqual({ marks: { bold: 'mixed', italic: 'on', ...off }, heading: 'mixed', boldFromHeading: false })
    expect(formatOfRange('Title\nbody', fmt, 6, 8)).toStrictEqual({ marks: { bold: 'on', italic: 'on', ...off }, heading: 0, boldFromHeading: false })
    expect(formatOfRange('ab', {}, 1, 1).marks.bold).toBe('off') // no characters
  })

  it('a caret: the marks the next typed character gets, from the character before it on its line, else after it', () => {
    const fmt: TextFormatting = {
      spans: [
        { start: 0, end: 2, bold: true },
        { start: 3, end: 5, italic: true },
      ],
    }
    const text = 'ab\ncd'
    expect(marksAtCaret(text, fmt, 2)).toStrictEqual({ bold: true, italic: false, underline: false, strike: false }) // after "b"
    expect(marksAtCaret(text, fmt, 3)).toStrictEqual({ bold: false, italic: true, underline: false, strike: false }) // start of "cd": copies "c"
    expect(marksAtCaret(text, fmt, 0).bold).toBe(true)
    expect(marksAtCaret('a\n\nb', { spans: [{ start: 0, end: 4, bold: true }] }, 2).bold).toBe(false) // an empty line copies nothing
    expect(marksAtCaret('Title\n', { headings: [1] }, 3).bold).toBe(true)
    expect(marksAtCaret('a😀b', { spans: [{ start: 1, end: 3, bold: true }] }, 3).bold).toBe(true)
  })

  it('pending choices: shown as the next character’s state, toggled against it, dropped when they match what typing gives', () => {
    const text = 'ab'
    const fmt: TextFormatting = { spans: [{ start: 0, end: 2, bold: true }] }
    let p = togglePendingMark(text, fmt, 2, {}, 'bold')
    expect(p).toStrictEqual({ bold: false }) // a pending "off" next to a bold character
    expect(formatAtCaret(text, fmt, 2, p).marks.bold).toBe('off')
    p = togglePendingMark(text, fmt, 2, p, 'italic')
    expect(p).toStrictEqual({ bold: false, italic: true })
    p = togglePendingMark(text, fmt, 2, p, 'bold')
    expect(p).toStrictEqual({ italic: true }) // back to what typing gives anyway
    expect(formatAtCaret(text, fmt, 2, p)).toStrictEqual({ marks: { bold: 'on', italic: 'on', underline: 'off', strike: 'off' }, heading: 0, boldFromHeading: false })
  })

  it('bold at a caret on a heading line is the heading’s and cannot be pending', () => {
    const fmt: TextFormatting = { headings: [0, 2] }
    expect(togglePendingMark('a\nTitle', fmt, 4, {}, 'bold')).toStrictEqual({})
    expect(formatAtCaret('a\nTitle', fmt, 4, { bold: false })).toStrictEqual({
      marks: { bold: 'on', italic: 'off', underline: 'off', strike: 'off' },
      heading: 2,
      boldFromHeading: true,
    })
  })

  it('a typed character’s marks with the pending choices applied', () => {
    const bold = markMask({ bold: true })
    const italic = markMask({ italic: true })
    expect(withPendingMarks(bold, { bold: false, italic: true })).toBe(italic)
    expect(withPendingMarks(0, {})).toBe(0)
    expect(withPendingMarks(bold | italic, { underline: false })).toBe(bold | italic)
  })
})
