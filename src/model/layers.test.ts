import { describe, expect, it } from 'vitest'
import { canReorder, reorder } from './layers.ts'

const order = ['a', 'b', 'c', 'd', 'e']
const sel = (...ids: string[]) => new Set(ids)

describe('reorder', () => {
  it('brings a single item forward and backward by one slot', () => {
    expect(reorder(order, sel('b'), 'forward')).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(reorder(order, sel('b'), 'backward')).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('moves to the front and back', () => {
    expect(reorder(order, sel('b'), 'front')).toEqual(['a', 'c', 'd', 'e', 'b'])
    expect(reorder(order, sel('d'), 'back')).toEqual(['d', 'a', 'b', 'c', 'e'])
  })

  it('keeps relative order of a multi-selection', () => {
    expect(reorder(order, sel('b', 'd'), 'front')).toEqual(['a', 'c', 'e', 'b', 'd'])
    expect(reorder(order, sel('b', 'd'), 'back')).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('moves an adjacent multi-selection as a block', () => {
    expect(reorder(order, sel('b', 'c'), 'forward')).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(reorder(order, sel('c', 'd'), 'backward')).toEqual(['a', 'c', 'd', 'b', 'e'])
  })

  it('does not let selected items leapfrog each other', () => {
    expect(reorder(order, sel('d', 'e'), 'forward')).toEqual(order)
    expect(reorder(order, sel('a', 'b'), 'backward')).toEqual(order)
  })

  it('does not mutate the input', () => {
    const copy = [...order]
    reorder(copy, sel('a'), 'front')
    expect(copy).toEqual(order)
  })
})

describe('canReorder', () => {
  it('is false at the extremes and true otherwise', () => {
    expect(canReorder(order, sel('e'), 'front')).toBe(false)
    expect(canReorder(order, sel('e'), 'forward')).toBe(false)
    expect(canReorder(order, sel('e'), 'back')).toBe(true)
    expect(canReorder(order, sel('a'), 'back')).toBe(false)
    expect(canReorder(order, sel('a'), 'backward')).toBe(false)
    expect(canReorder(order, sel('c'), 'forward')).toBe(true)
  })
})
