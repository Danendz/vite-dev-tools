import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRenderHistory,
  type RenderHistory,
} from '@/adapters/react/render-history'
import type { CommitRecord } from '@/core/types'

function makeCommit(commitIndex: number, componentCount = 1): CommitRecord {
  return {
    commitIndex,
    timestampMs: commitIndex * 1000,
    components: Array.from({ length: componentCount }, (_, i) => ({
      persistentId: i + 1,
      name: `C${i}`,
      source: null,
      cause: 'props',
      contributors: ['props'],
      changedProps: ['x'],
    })),
  }
}

describe('render-history', () => {
  let history: RenderHistory

  beforeEach(() => {
    history = createRenderHistory({ maxCommits: 3, maxComponentsPerCommit: 2 })
  })

  it('starts empty', () => {
    expect(history.getCommits()).toEqual([])
    expect(history.nextCommitIndex()).toBe(0)
  })

  it('record() does not advance the counter (advanceCommitIndex owns that)', () => {
    expect(history.nextCommitIndex()).toBe(0)
    history.record(makeCommit(0))
    expect(history.nextCommitIndex()).toBe(0)
  })

  it('records commits into the buffer', () => {
    history.record(makeCommit(0))
    history.record(makeCommit(1))
    expect(history.getCommits()).toHaveLength(2)
    expect(history.getCommits()[0].commitIndex).toBe(0)
    expect(history.getCommits()[1].commitIndex).toBe(1)
  })

  it('evicts oldest commits when over cap', () => {
    history.record(makeCommit(0))
    history.record(makeCommit(1))
    history.record(makeCommit(2))
    history.record(makeCommit(3))
    const commits = history.getCommits()
    expect(commits).toHaveLength(3)
    expect(commits[0].commitIndex).toBe(1)
    expect(commits[2].commitIndex).toBe(3)
  })

  it('caps components per commit', () => {
    history.record(makeCommit(0, 5))
    expect(history.getCommits()[0].components).toHaveLength(2)
  })

  it('does not record when recording is false', () => {
    history.setRecording(false)
    history.record(makeCommit(0))
    expect(history.getCommits()).toEqual([])
    // But commit counter still advances so outside callers can pair with walk id
    expect(history.nextCommitIndex()).toBe(0)
  })

  it('resumes recording when toggled back on', () => {
    history.setRecording(false)
    history.record(makeCommit(0))
    history.setRecording(true)
    history.record(makeCommit(1))
    expect(history.getCommits()).toHaveLength(1)
    expect(history.getCommits()[0].commitIndex).toBe(1)
  })

  it('clear() empties the buffer but does not reset monotonic counter', () => {
    history.record(makeCommit(0))
    history.record(makeCommit(1))
    const counterBefore = history.nextCommitIndex()
    history.clear()
    expect(history.getCommits()).toEqual([])
    expect(history.nextCommitIndex()).toBe(counterBefore)
  })

  it('advanceCommitIndex allocates a monotonically increasing index', () => {
    const a = history.advanceCommitIndex()
    const b = history.advanceCommitIndex()
    const c = history.advanceCommitIndex()
    expect(a).toBe(0)
    expect(b).toBe(1)
    expect(c).toBe(2)
  })
})
