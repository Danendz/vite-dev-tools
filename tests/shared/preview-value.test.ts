import { describe, it, expect } from 'vitest'
import { safeStringify } from '@/shared/preview-value'

describe('safeStringify', () => {
  it('formats primitives', () => {
    expect(safeStringify('hello')).toBe('"hello"')
    expect(safeStringify(42)).toBe('42')
    expect(safeStringify(true)).toBe('true')
    expect(safeStringify(null)).toBe('null')
    expect(safeStringify(undefined)).toBe('undefined')
  })

  it('formats functions as ƒ()', () => {
    expect(safeStringify(() => 1)).toBe('ƒ()')
    function named() {}
    expect(safeStringify(named)).toBe('ƒ named()')
  })

  it('formats symbols', () => {
    expect(safeStringify(Symbol('foo'))).toBe('Symbol(foo)')
  })

  it('formats shallow objects and arrays', () => {
    expect(safeStringify({ a: 1, b: 'x' })).toBe('{a: 1, b: "x"}')
    expect(safeStringify([1, 2, 3])).toBe('[1, 2, 3]')
  })

  it('caps depth — nested objects render as [Object]', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } }
    // depth cap at 3: level 4 (d) and beyond collapsed
    expect(safeStringify(deep, { maxDepth: 3 })).toContain('[Object]')
  })

  it('handles circular references without stack overflow', () => {
    const a: any = { name: 'a' }
    a.self = a
    const out = safeStringify(a)
    expect(out).toContain('[Circular]')
  })

  it('truncates long string output', () => {
    const long = 'x'.repeat(500)
    const out = safeStringify(long, { maxLength: 120 })
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out).toMatch(/…$|\.\.\.$/)
  })

  it('formats React elements compactly', () => {
    const el = { $$typeof: Symbol.for('react.element'), type: 'div', props: {} }
    const out = safeStringify(el)
    expect(out).toContain('<div')
  })
})
