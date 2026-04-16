// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { formatEntryForCopy, formatAllEntriesForCopy } from '@/core/console-format'
import { createConsoleEntry } from '@helpers/factories'

describe('formatEntryForCopy', () => {
  beforeEach(() => {
    // happy-dom provides window.location, set href for deterministic output
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost:3000/test' },
      writable: true,
      configurable: true,
    })
  })

  it('formats error entry with Error label', () => {
    const entry = createConsoleEntry({ type: 'error', message: 'Something broke' })
    const result = formatEntryForCopy(entry)
    expect(result).toContain('--- Browser Console Error ---')
    expect(result).toContain('Something broke')
    expect(result).toContain('Page: http://localhost:3000/test')
  })

  it('formats warning entry with Warning label', () => {
    const entry = createConsoleEntry({ type: 'warning', message: 'Watch out' })
    const result = formatEntryForCopy(entry)
    expect(result).toContain('--- Browser Console Warning ---')
    expect(result).toContain('Watch out')
  })

  it('includes stack trace when present', () => {
    const entry = createConsoleEntry({ stack: 'at foo (bar.ts:1:1)' })
    const result = formatEntryForCopy(entry)
    expect(result).toContain('at foo (bar.ts:1:1)')
  })

  it('omits stack section when stack is null', () => {
    const entry = createConsoleEntry({ stack: null })
    const result = formatEntryForCopy(entry)
    // Should not have a blank line between message and Page
    const lines = result.split('\n')
    const messageLine = lines.findIndex(l => l === entry.message)
    expect(lines[messageLine + 1]).toBe('')
    expect(lines[messageLine + 2]).toContain('Page:')
  })
})

describe('formatAllEntriesForCopy', () => {
  it('joins multiple entries with double newline', () => {
    const entries = [
      createConsoleEntry({ id: 'c0', message: 'first' }),
      createConsoleEntry({ id: 'c1', message: 'second' }),
    ]
    const result = formatAllEntriesForCopy(entries)
    expect(result).toContain('first')
    expect(result).toContain('second')
    // Entries separated by double newline
    expect(result.split('---\n\n---').length).toBeGreaterThanOrEqual(2)
  })
})
