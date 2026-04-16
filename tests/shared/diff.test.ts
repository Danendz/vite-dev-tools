import { describe, it, expect } from 'vitest'
import { buildDiff } from '@/shared/diff'

describe('buildDiff', () => {
  it('returns empty diff for identical strings', () => {
    const result = buildDiff('hello\nworld', 'hello\nworld', 'test.ts', 1)
    expect(result.removedLines).toEqual([])
    expect(result.addedLines).toEqual([])
    expect(result.fileName).toBe('test.ts')
  })

  it('detects a single line change', () => {
    const result = buildDiff('a\nb\nc', 'a\nB\nc', 'test.ts', 1)
    expect(result.removedLines).toEqual(['b'])
    expect(result.addedLines).toEqual(['B'])
    expect(result.lineNumber).toBe(2)
  })

  it('detects a line addition', () => {
    const result = buildDiff('a\nc', 'a\nb\nc', 'test.ts', 1)
    expect(result.addedLines).toContain('b')
  })

  it('detects a line removal', () => {
    const result = buildDiff('a\nb\nc', 'a\nc', 'test.ts', 1)
    expect(result.removedLines).toContain('b')
  })

  it('provides up to 3 lines of context before', () => {
    const lines = ['1', '2', '3', '4', '5', 'changed', '7']
    const result = buildDiff(lines.join('\n'), lines.map((l, i) => i === 5 ? 'CHANGED' : l).join('\n'), 'test.ts', 1)
    expect(result.contextBefore).toEqual(['3', '4', '5'])
    expect(result.contextBefore.length).toBeLessThanOrEqual(3)
  })

  it('provides shorter context when diff is near file start', () => {
    const result = buildDiff('a\nb\nc', 'X\nb\nc', 'test.ts', 1)
    expect(result.contextBefore).toEqual([])
    expect(result.lineNumber).toBe(1)
  })

  it('provides up to 3 lines of context after', () => {
    const lines = ['1', 'changed', '3', '4', '5', '6']
    const result = buildDiff(lines.join('\n'), lines.map((l, i) => i === 1 ? 'CHANGED' : l).join('\n'), 'test.ts', 1)
    expect(result.contextAfter).toEqual(['3', '4', '5'])
    expect(result.contextAfter.length).toBeLessThanOrEqual(3)
  })

  it('provides shorter context when diff is near file end', () => {
    const result = buildDiff('a\nb\nc', 'a\nb\nX', 'test.ts', 1)
    expect(result.contextAfter).toEqual([])
  })

  it('passes through fileName', () => {
    const result = buildDiff('a', 'b', 'my-file.tsx', 5)
    expect(result.fileName).toBe('my-file.tsx')
  })
})
