import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordTrigger,
  flushTriggers,
  clearSeen,
  setLastRenderedCommit,
  getLastRenderedCommit,
  _resetForTesting,
} from '@/adapters/vue/render-cause'

function createInstance(overrides: Record<string, any> = {}) {
  return {
    type: {},
    proxy: {},
    scope: { effects: [] },
    ...overrides,
  }
}

function trigger(opts: {
  key?: string
  oldValue?: unknown
  newValue?: unknown
  target?: object
  type?: string
}) {
  return {
    type: opts.type ?? 'set',
    key: opts.key,
    oldValue: opts.oldValue,
    newValue: opts.newValue,
    target: opts.target ?? {},
  }
}

describe('Vue render-cause', () => {
  beforeEach(() => {
    _resetForTesting()
  })

  describe('mount detection', () => {
    it('labels first flush as mount', () => {
      const instance = createInstance()
      const entry = flushTriggers(1, 'App', null, 1, instance, false)
      expect(entry).not.toBeNull()
      expect(entry!.cause).toBe('mount')
      expect(entry!.contributors).toEqual(['mount'])
    })

    it('does not label second flush as mount', () => {
      const instance = createInstance()
      // First flush = mount
      flushTriggers(1, 'App', null, 1, instance, false)

      // Record a state trigger for second flush
      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 1 }))
      const entry = flushTriggers(1, 'App', null, 1, instance, false)
      expect(entry).not.toBeNull()
      expect(entry!.cause).not.toBe('mount')
    })

    it('re-labels as mount after clearSeen', () => {
      const instance = createInstance()
      flushTriggers(1, 'App', null, 1, instance, false)
      clearSeen(1)

      const entry = flushTriggers(1, 'App', null, 1, instance, false)
      expect(entry!.cause).toBe('mount')
    })
  })

  describe('state classification', () => {
    it('classifies ref/reactive mutations as state', () => {
      const instance = createInstance()
      // Mark as seen first
      flushTriggers(1, 'Counter', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 1 }))
      const entry = flushTriggers(1, 'Counter', null, 1, instance, false)

      expect(entry!.cause).toBe('state')
      expect(entry!.changedHooks).toEqual([
        { index: 0, hookName: 'ref', varName: 'count' },
      ])
    })

    it('lists multiple changed state keys', () => {
      const instance = createInstance()
      flushTriggers(1, 'Form', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'name', oldValue: '', newValue: 'Alice' }))
      recordTrigger(1, trigger({ key: 'age', oldValue: 0, newValue: 30 }))
      const entry = flushTriggers(1, 'Form', null, 1, instance, false)

      expect(entry!.changedHooks).toHaveLength(2)
      expect(entry!.changedHooks![0].varName).toBe('name')
      expect(entry!.changedHooks![1].varName).toBe('age')
    })
  })

  describe('props classification', () => {
    it('classifies readonly target triggers as props', () => {
      const propsTarget = { __v_isReadonly: true }
      const instance = createInstance()
      flushTriggers(1, 'Child', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'title', oldValue: 'old', newValue: 'new', target: propsTarget }))
      const entry = flushTriggers(1, 'Child', null, 1, instance, false)

      expect(entry!.cause).toBe('props')
      expect(entry!.changedProps).toEqual(['title'])
    })
  })

  describe('context classification', () => {
    it('classifies injected reactive target triggers as context', () => {
      const themeObj = { color: 'dark' }
      const instance = createInstance({
        type: { inject: ['theme'] },
        proxy: { theme: themeObj },
      })
      flushTriggers(1, 'Button', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'color', oldValue: 'light', newValue: 'dark', target: themeObj }))
      const entry = flushTriggers(1, 'Button', null, 1, instance, false)

      expect(entry!.cause).toBe('context')
      expect(entry!.changedContexts).toEqual(['theme'])
    })

    it('unwraps proxied inject targets via __v_raw', () => {
      const rawObj = { color: 'blue' }
      const proxyObj = { __v_raw: rawObj }
      const instance = createInstance({
        type: { inject: ['style'] },
        proxy: { style: proxyObj },
      })
      flushTriggers(1, 'Box', null, 1, instance, false)

      // Trigger target is the raw object
      recordTrigger(1, trigger({ key: 'color', target: rawObj }))
      const entry = flushTriggers(1, 'Box', null, 1, instance, false)

      expect(entry!.cause).toBe('context')
      expect(entry!.changedContexts).toEqual(['style'])
    })
  })

  describe('parent classification', () => {
    it('returns null when no triggers and not mount (caller treats as parent)', () => {
      const instance = createInstance()
      flushTriggers(1, 'Child', null, 1, instance, false)

      // No triggers recorded, second flush
      const entry = flushTriggers(1, 'Child', null, 1, instance, false)
      expect(entry).toBeNull()
    })
  })

  describe('precedence', () => {
    it('state > context > props', () => {
      const themeObj = { color: 'dark' }
      const propsTarget = { __v_isReadonly: true }
      const instance = createInstance({
        type: { inject: ['theme'] },
        proxy: { theme: themeObj },
      })
      flushTriggers(1, 'Multi', null, 1, instance, false)

      // All three types of triggers
      recordTrigger(1, trigger({ key: 'count', target: {} })) // state
      recordTrigger(1, trigger({ key: 'color', target: themeObj })) // context
      recordTrigger(1, trigger({ key: 'title', target: propsTarget })) // props

      const entry = flushTriggers(1, 'Multi', null, 1, instance, false)
      expect(entry!.cause).toBe('state')
      expect(entry!.contributors).toEqual(
        expect.arrayContaining(['state', 'context', 'props']),
      )
    })
  })

  describe('value diffs', () => {
    it('captures prop value diffs when includeValues is true', () => {
      const propsTarget = { __v_isReadonly: true }
      const instance = createInstance()
      flushTriggers(1, 'Child', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'name', oldValue: 'Alice', newValue: 'Bob', target: propsTarget }))
      const entry = flushTriggers(1, 'Child', null, 1, instance, true)

      expect(entry!.previousValues).toBeDefined()
      expect(entry!.previousValues!.name).toContain('Alice')
      expect(entry!.nextValues!.name).toContain('Bob')
      expect(entry!.fullPreviousValues).toBeDefined()
      expect(entry!.fullNextValues).toBeDefined()
    })

    it('captures state value diffs when includeValues is true', () => {
      const instance = createInstance()
      flushTriggers(1, 'Counter', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 5 }))
      const entry = flushTriggers(1, 'Counter', null, 1, instance, true)

      expect(entry!.previousHookValues).toBeDefined()
      expect(entry!.previousHookValues!.count).toContain('0')
      expect(entry!.nextHookValues!.count).toContain('5')
    })

    it('does not capture value diffs when includeValues is false', () => {
      const instance = createInstance()
      flushTriggers(1, 'Counter', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 5 }))
      const entry = flushTriggers(1, 'Counter', null, 1, instance, false)

      expect(entry!.previousValues).toBeUndefined()
      expect(entry!.previousHookValues).toBeUndefined()
    })

    it('captures object value diffs with full pretty-printed values', () => {
      const instance = createInstance()
      flushTriggers(1, 'List', null, 1, instance, false)

      const oldItems = [{ id: 1, name: 'a' }]
      const newItems = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
      recordTrigger(1, trigger({ key: 'items', oldValue: oldItems, newValue: newItems }))
      const entry = flushTriggers(1, 'List', null, 1, instance, true)

      // Full values should contain the entire JSON
      expect(entry!.fullPreviousHookValues!.items).toContain('"id"')
      expect(entry!.fullNextHookValues!.items).toContain('"name"')
    })
  })

  describe('watcher dep correlation', () => {
    it('correlates trigger keys with watcher deps', () => {
      const instance = createInstance({
        scope: {
          effects: [
            {
              fn: () => {},
              scheduler: () => {},
              cb: () => {},
              deps: {
                dep: { key: 'count' },
                nextDep: { dep: { key: 'name' }, nextDep: null },
              },
            },
          ],
        },
      })
      flushTriggers(1, 'Comp', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 1 }))
      const entry = flushTriggers(1, 'Comp', null, 1, instance, false)

      expect(entry!.effectChanges).toHaveLength(1)
      expect(entry!.effectChanges![0].hookName).toBe('watcher')
      expect(entry!.effectChanges![0].changedDeps).toEqual([
        { name: 'count', prev: 0, next: 1 },
      ])
    })

    it('labels all watcher effects as watcher', () => {
      const instance = createInstance({
        scope: {
          effects: [
            {
              fn: () => {},
              scheduler: () => {},
              deps: { dep: { key: 'count' }, nextDep: null },
            },
          ],
        },
      })
      flushTriggers(1, 'Comp', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 1 }))
      const entry = flushTriggers(1, 'Comp', null, 1, instance, false)

      expect(entry!.effectChanges![0].hookName).toBe('watcher')
    })

    it('does not report unaffected watchers', () => {
      const instance = createInstance({
        scope: {
          effects: [
            {
              fn: () => {},
              scheduler: () => {},
              cb: () => {},
              deps: { dep: { key: 'unrelated' }, nextDep: null },
            },
          ],
        },
      })
      flushTriggers(1, 'Comp', null, 1, instance, false)

      recordTrigger(1, trigger({ key: 'count', oldValue: 0, newValue: 1 }))
      const entry = flushTriggers(1, 'Comp', null, 1, instance, false)

      expect(entry!.effectChanges).toBeUndefined()
    })
  })

  describe('lastRenderedCommit tracking', () => {
    it('stores and retrieves last rendered commit', () => {
      setLastRenderedCommit(1, 5)
      expect(getLastRenderedCommit(1)).toBe(5)

      setLastRenderedCommit(1, 10)
      expect(getLastRenderedCommit(1)).toBe(10)
    })

    it('returns undefined for unknown uid', () => {
      expect(getLastRenderedCommit(999)).toBeUndefined()
    })
  })
})
