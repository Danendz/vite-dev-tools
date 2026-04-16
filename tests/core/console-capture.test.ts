// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { startCapture } from '@/core/console-capture'
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

  it('cleans stack traces by removing node_modules and .vite/deps lines', () => {
    const entries: ConsoleEntry[] = []
    cleanup = startCapture((e) => entries.push(e))
    const err = new Error('test')
    err.stack = 'Error: test\n  at foo (app.ts:1:1)\n  at bar (node_modules/lib.js:1:1)\n  at baz (.vite/deps/chunk.js:1:1)'
    console.error(err)
    expect(entries[0].stack).toContain('at foo')
    expect(entries[0].stack).not.toContain('node_modules')
    expect(entries[0].stack).not.toContain('.vite/deps')
  })

  it('restores console methods on cleanup', () => {
    const origError = console.error
    const origWarn = console.warn
    cleanup = startCapture(() => {})
    expect(console.error).not.toBe(origError)
    cleanup()
    expect(console.error).toBe(origError)
    expect(console.warn).toBe(origWarn)
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
})
