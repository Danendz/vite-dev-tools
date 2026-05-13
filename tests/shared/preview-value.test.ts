import { describe, it, expect } from 'vitest'
import { safeStringify, prettyStringify } from '@/shared/preview-value'

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

describe('prettyStringify', () => {
  it('pretty-prints shallow objects with 2-space indent', () => {
    const out = prettyStringify({ a: 1, b: 'x' })
    expect(out).toContain('"a": 1')
    expect(out).toContain('"b": "x"')
    expect(out).toMatch(/\n  "a"/)
  })

  it('handles circular references without stack overflow', () => {
    const a: any = { name: 'a' }
    a.self = a
    const out = prettyStringify(a)
    expect(out).toContain('[Circular]')
  })

  it('caps depth on deeply nested objects', () => {
    // 20 levels deep — must terminate, not allocate forever
    let deep: any = { leaf: 1 }
    for (let i = 0; i < 20; i++) deep = { nested: deep }
    const out = prettyStringify(deep, { maxDepth: 4 })
    expect(out).toContain('[Object]')
    expect(out.length).toBeLessThan(500)
  })

  it('caps total output length', () => {
    const huge: Record<string, string> = {}
    for (let i = 0; i < 10_000; i++) huge[`key_${i}`] = 'x'.repeat(50)
    const out = prettyStringify(huge, { maxLength: 1000 })
    expect(out.length).toBeLessThanOrEqual(1001) // 1000 + trailing '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('does not OOM on wide+deep host-like graphs', () => {
    // Synthesizes the Shadow-Root scenario: a wide object referencing many
    // moderate-depth subtrees. Must complete in bounded time/memory.
    const root: any = {}
    for (let i = 0; i < 200; i++) {
      let chain: any = { value: i }
      for (let j = 0; j < 15; j++) chain = { child: chain }
      root[`branch_${i}`] = chain
    }
    const start = Date.now()
    const out = prettyStringify(root)
    expect(Date.now() - start).toBeLessThan(500)
    expect(out.length).toBeLessThanOrEqual(20_001)
  })

  it('formats React elements and Vue component instances compactly', () => {
    const reactEl = { $$typeof: Symbol.for('react.element'), type: 'Foo' }
    expect(prettyStringify(reactEl)).toContain('<Foo />')

    const vueInstance = { __v_skip: true, name: 'X' }
    expect(prettyStringify(vueInstance)).toContain('[ComponentInstance]')
  })

  it('unwraps Vue reactive proxies via __v_raw', () => {
    const raw = { a: 1 }
    const proxy: any = { __v_raw: raw }
    const out = prettyStringify(proxy)
    expect(out).toContain('"a": 1')
  })
})
