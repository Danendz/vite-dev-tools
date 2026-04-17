import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/core/overlay/state-store', () => ({
  devtoolsState: {
    renderHistory: [] as any[],
    renderHistoryRecording: true,
    setRenderHistory: vi.fn(function (this: any, commits: any) { this.renderHistory = commits }),
    setRenderHistoryRecording: vi.fn(function (this: any, enabled: boolean) { this.renderHistoryRecording = enabled }),
    onClearRenderHistory: null as (() => void) | null,
    onSetRenderHistoryRecording: null as ((enabled: boolean) => void) | null,
  },
}))

import { devtoolsState } from '@/core/overlay/state-store'
import {
  getRenderHistoryHandler,
  getRenderCausesHandler,
  getHotComponentsHandler,
  clearRenderHistoryHandler,
  setRenderHistoryRecordingHandler,
  stripValues,
} from '@/core/mcp/render-history-handlers'
import type { CommitRecord } from '@/core/types'

function makeCommit(index: number, entries: Array<Partial<any>> = []): CommitRecord {
  return {
    commitIndex: index,
    timestampMs: index * 1000,
    components: entries.map((e, i) => ({
      persistentId: i + 1,
      name: `Comp${i}`,
      source: null,
      cause: 'props',
      contributors: ['props'],
      changedProps: ['x'],
      previousValues: { x: 'old' },
      nextValues: { x: 'new' },
      ...e,
    })),
  }
}

describe('render-history-handlers', () => {
  beforeEach(() => {
    devtoolsState.renderHistory = []
    devtoolsState.renderHistoryRecording = true
    devtoolsState.onClearRenderHistory = null
    devtoolsState.onSetRenderHistoryRecording = null
  })

  describe('getRenderHistory', () => {
    it('returns last N commits from the buffer', async () => {
      devtoolsState.renderHistory = [makeCommit(0, [{}]), makeCommit(1, [{}]), makeCommit(2, [{}])]
      const result = await getRenderHistoryHandler({ limit: 2 }) as { commits: CommitRecord[] }
      expect(result.commits).toHaveLength(2)
      expect(result.commits[0].commitIndex).toBe(1)
      expect(result.commits[1].commitIndex).toBe(2)
    })

    it('strips previousValues/nextValues when includeValues is false', async () => {
      devtoolsState.renderHistory = [makeCommit(0, [{}])]
      const result = await getRenderHistoryHandler({ includeValues: false }) as { commits: CommitRecord[] }
      expect(result.commits[0].components[0].previousValues).toBeUndefined()
      expect(result.commits[0].components[0].nextValues).toBeUndefined()
      expect(result.commits[0].components[0].changedProps).toEqual(['x'])
    })

    it('keeps values when includeValues is true', async () => {
      devtoolsState.renderHistory = [makeCommit(0, [{}])]
      const result = await getRenderHistoryHandler({ includeValues: true }) as { commits: CommitRecord[] }
      expect(result.commits[0].components[0].previousValues).toEqual({ x: 'old' })
    })
  })

  describe('getRenderCauses', () => {
    it('filters commits to those containing the given componentName', async () => {
      devtoolsState.renderHistory = [
        makeCommit(0, [{ name: 'Header' }]),
        makeCommit(1, [{ name: 'Footer' }]),
        makeCommit(2, [{ name: 'Header' }, { name: 'Footer' }]),
      ]
      const result = await getRenderCausesHandler({ componentName: 'Header' }) as { commits: CommitRecord[] }
      expect(result.commits.map((c) => c.commitIndex)).toEqual([0, 2])
      // Each commit's components are also filtered to the named one
      for (const c of result.commits) {
        expect(c.components.every((e) => e.name === 'Header')).toBe(true)
      }
    })

    it('returns empty when componentName not found', async () => {
      devtoolsState.renderHistory = [makeCommit(0, [{ name: 'Header' }])]
      const result = await getRenderCausesHandler({ componentName: 'Nope' }) as { commits: CommitRecord[] }
      expect(result.commits).toEqual([])
    })

    it('matches by case-insensitive substring when fuzzy is true', async () => {
      devtoolsState.renderHistory = [
        makeCommit(0, [{ name: 'TodoList' }]),
        makeCommit(1, [{ name: 'TodoItem' }]),
        makeCommit(2, [{ name: 'Header' }]),
      ]
      const result = await getRenderCausesHandler({ componentName: 'todo', fuzzy: true }) as { commits: CommitRecord[] }
      expect(result.commits).toHaveLength(2)
      expect(result.commits.map((c) => c.components[0].name)).toEqual(['TodoList', 'TodoItem'])
    })

    it('uses exact match when fuzzy is not set', async () => {
      devtoolsState.renderHistory = [
        makeCommit(0, [{ name: 'TodoList' }]),
        makeCommit(1, [{ name: 'TodoItem' }]),
      ]
      const result = await getRenderCausesHandler({ componentName: 'todo' }) as { commits: CommitRecord[] }
      expect(result.commits).toHaveLength(0)
    })
  })

  describe('getHotComponents', () => {
    it('returns top N components by render count within window', async () => {
      const now = Date.now()
      devtoolsState.renderHistory = [
        { commitIndex: 0, timestampMs: now - 1000, components: [
          { persistentId: 1, name: 'A', source: null, cause: 'props', contributors: ['props'] } as any,
        ] },
        { commitIndex: 1, timestampMs: now - 500, components: [
          { persistentId: 1, name: 'A', source: null, cause: 'props', contributors: ['props'] } as any,
          { persistentId: 2, name: 'B', source: null, cause: 'props', contributors: ['props'] } as any,
        ] },
        { commitIndex: 2, timestampMs: now - 100, components: [
          { persistentId: 1, name: 'A', source: null, cause: 'state', contributors: ['state'] } as any,
        ] },
      ]
      const result = await getHotComponentsHandler({ windowMs: 2000, limit: 5 }) as { components: any[] }
      expect(result.components[0].name).toBe('A')
      expect(result.components[0].renderCount).toBe(3)
      expect(result.components[0].lastCause).toBe('state')
      expect(result.components[1].name).toBe('B')
      expect(result.components[1].renderCount).toBe(1)
    })

    it('filters by time window', async () => {
      const now = Date.now()
      devtoolsState.renderHistory = [
        { commitIndex: 0, timestampMs: now - 10_000, components: [
          { persistentId: 1, name: 'Old', source: null, cause: 'props', contributors: ['props'] } as any,
        ] },
        { commitIndex: 1, timestampMs: now - 100, components: [
          { persistentId: 2, name: 'Recent', source: null, cause: 'props', contributors: ['props'] } as any,
        ] },
      ]
      const result = await getHotComponentsHandler({ windowMs: 1000 }) as { components: any[] }
      expect(result.components).toHaveLength(1)
      expect(result.components[0].name).toBe('Recent')
    })
  })

  describe('clearRenderHistory', () => {
    it('invokes the onClearRenderHistory callback', async () => {
      const spy = vi.fn()
      devtoolsState.onClearRenderHistory = spy
      const result = await clearRenderHistoryHandler({}) as { ok: boolean }
      expect(spy).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })
  })

  describe('setRenderHistoryRecording', () => {
    it('invokes the callback with the enabled value', async () => {
      const spy = vi.fn()
      devtoolsState.onSetRenderHistoryRecording = spy
      const result = await setRenderHistoryRecordingHandler({ enabled: false }) as { ok: boolean; recording: boolean }
      expect(spy).toHaveBeenCalledWith(false)
      expect(result.ok).toBe(true)
    })
  })

  describe('stripValues', () => {
    it('removes previousValues and nextValues from a commit', () => {
      const stripped = stripValues(makeCommit(0, [{}]))
      expect(stripped.components[0].previousValues).toBeUndefined()
      expect(stripped.components[0].nextValues).toBeUndefined()
    })

    it('also removes previousHookValues and nextHookValues', () => {
      const commit = makeCommit(0, [{
        previousHookValues: { 'count (useState)': '0' },
        nextHookValues: { 'count (useState)': '1' },
      }])
      const stripped = stripValues(commit)
      expect((stripped.components[0] as any).previousHookValues).toBeUndefined()
      expect((stripped.components[0] as any).nextHookValues).toBeUndefined()
    })
  })
})
