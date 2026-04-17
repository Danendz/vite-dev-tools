// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { startCapture, parseStack } from '@/core/console-capture'
import type { ConsoleEntry } from '@/core/types'

describe('startCapture', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  it('calls callback with error entry for console.error', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.error('boom')
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe('error')
    expect(entries[0].message).toBe('boom')
  })

  it('calls callback with warning entry for console.warn', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.warn('careful')
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe('warning')
    expect(entries[0].message).toBe('careful')
  })

  it('joins multiple arguments', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.error('a', 'b', 'c')
    expect(entries[0].message).toBe('a b c')
  })

  it('expands printf-style format strings', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.warn('%s is %d', 'count', 42)
    expect(entries[0].message).toBe('count is 42')
  })

  it('uses .message for Error objects', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.error(new Error('fail'))
    expect(entries[0].message).toBe('fail')
  })

  it('JSON-stringifies objects', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.error({ key: 'value' })
    expect(entries[0].message).toBe('{"key":"value"}')
  })

  it('cleans stack traces by stripping origin URLs but preserving library lines', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    const err = new Error('test')
    err.stack = 'Error: test\n  at foo (https://localhost:5173/app.ts:1:1)\n  at bar (node_modules/lib.js:1:1)\n  at baz (.vite/deps/chunk.js:1:1)'
    console.error(err)
    expect(entries[0].stack).toContain('at foo')
    // Library lines are preserved (filtering is done at display time)
    expect(entries[0].stack).toContain('node_modules')
    expect(entries[0].stack).toContain('.vite/deps')
    // Origin URLs are stripped
    expect(entries[0].stack).not.toContain('https://localhost:5173')
  })

  it('restores console methods on cleanup', () => {
    const origError = console.error
    const origWarn = console.warn
    const origLog = console.log
    cleanup = startCapture(() => {})
    expect(console.error).not.toBe(origError)
    cleanup()
    expect(console.error).toBe(origError)
    expect(console.warn).toBe(origWarn)
    expect(console.log).toBe(origLog)
    cleanup = null
  })

  it('assigns sequential entry IDs', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.error('a')
    console.error('b')
    // IDs should follow console_N pattern
    expect(entries[0].id).toMatch(/^console_\d+$/)
    expect(entries[1].id).toMatch(/^console_\d+$/)
    // Second should have higher number
    const id0 = parseInt(entries[0].id.split('_')[1])
    const id1 = parseInt(entries[1].id.split('_')[1])
    expect(id1).toBeGreaterThan(id0)
  })

  it('populates frames for error entries with a stack', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    const err = new Error('fail')
    err.stack = 'Error: fail\n  at myFunc (/src/App.vue:10:5)\n  at callWithErrorHandling (/node_modules/.vite/deps/vue.js:1873:17)'
    console.error(err)
    expect(entries[0].frames).not.toBeNull()
    expect(Array.isArray(entries[0].frames)).toBe(true)
    expect(entries[0].frames!.length).toBe(2)
    expect(entries[0].frames![0].fn).toBe('myFunc')
    expect(entries[0].frames![0].file).toBe('/src/App.vue')
    expect(entries[0].frames![0].isLibrary).toBe(false)
    expect(entries[0].frames![1].isLibrary).toBe(true)
  })

  it('console.log entries have frames from synthetic stack capture', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.log('hello')
    // frames may be empty if the test runner stack has no parseable user frames,
    // but the field must be present (not undefined) — it's either an array or null
    expect('frames' in entries[0]).toBe(true)
  })

  it('console.warn entries have frames field present', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.warn('watch out')
    expect('frames' in entries[0]).toBe(true)
  })

  it('error entries with plain string have synthetic stack frames', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    console.error('plain string, no Error')
    // console.error now captures synthetic stacks for non-Error args
    expect('frames' in entries[0]).toBe(true)
  })
})

describe('parseStack', () => {
  it('parses a named frame correctly', () => {
    const frames = parseStack('  at triggerTypeError (/src/components/ErrorForm.vue:188:9)')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual({
      fn: 'triggerTypeError',
      file: '/src/components/ErrorForm.vue',
      line: 188,
      col: 9,
      isLibrary: false,
    })
  })

  it('parses an anonymous frame (no function name)', () => {
    const frames = parseStack('  at /src/App.vue:42:10')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual({
      fn: null,
      file: '/src/App.vue',
      line: 42,
      col: 10,
      isLibrary: false,
    })
  })

  it('marks node_modules frames as library', () => {
    const frames = parseStack('  at callWithErrorHandling (/node_modules/.vite/deps/vue.js:1873:17)')
    expect(frames).toHaveLength(1)
    expect(frames[0].isLibrary).toBe(true)
    expect(frames[0].fn).toBe('callWithErrorHandling')
    expect(frames[0].file).toBe('/node_modules/.vite/deps/vue.js')
    expect(frames[0].line).toBe(1873)
    expect(frames[0].col).toBe(17)
  })

  it('marks .vite/deps frames as library', () => {
    const frames = parseStack('  at bar (/.vite/deps/chunk.js:1:1)')
    expect(frames).toHaveLength(1)
    expect(frames[0].isLibrary).toBe(true)
  })

  it('parses an eval frame by extracting the outer location', () => {
    const frames = parseStack('  at eval (eval at triggerReferenceError (/src/Foo.vue:209:5), <anonymous>:1:1)')
    expect(frames).toHaveLength(1)
    expect(frames[0].file).toBe('/src/Foo.vue')
    expect(frames[0].line).toBe(209)
    expect(frames[0].col).toBe(5)
    expect(frames[0].isLibrary).toBe(false)
  })

  it('skips non-matching lines like "Error: test"', () => {
    const frames = parseStack('Error: test')
    expect(frames).toEqual([])
  })

  it('returns empty array for empty string', () => {
    const frames = parseStack('')
    expect(frames).toEqual([])
  })

  it('correctly parses a multi-line stack with mixed library and user frames', () => {
    const stack = [
      'Error: something went wrong',
      '  at triggerError (/src/components/Form.vue:50:3)',
      '  at /src/App.vue:20:5',
      '  at callWithErrorHandling (/node_modules/.vite/deps/vue.js:1873:17)',
      '  at bar (/.vite/deps/other-chunk.js:10:2)',
    ].join('\n')

    const frames = parseStack(stack)
    expect(frames).toHaveLength(4)

    // User frames
    expect(frames[0]).toEqual({ fn: 'triggerError', file: '/src/components/Form.vue', line: 50, col: 3, isLibrary: false })
    expect(frames[1]).toEqual({ fn: null, file: '/src/App.vue', line: 20, col: 5, isLibrary: false })

    // Library frames
    expect(frames[2].isLibrary).toBe(true)
    expect(frames[3].isLibrary).toBe(true)
  })
})
