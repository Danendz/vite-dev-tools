import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { extractSections } from '@/adapters/vue/state-extractor'

function createRef(value: any) {
  return { __v_isRef: true, value }
}

function createReactive(obj: Record<string, any>) {
  return { __v_isReactive: true, ...obj }
}

function createComputed(value: any) {
  return { __v_isRef: true, value, effect: {}, __v_isReadonly: true }
}

describe('extractSections', () => {
  it('extracts ref values with badge and editable=true', () => {
    const instance = {
      setupState: { count: createRef(42), __v_raw: { count: createRef(42) } },
    }
    // Make setupState proxy-like: raw state read directly
    instance.setupState.__v_raw = { count: createRef(42) }

    const sections = extractSections(instance)
    const setupSection = sections.find(s => s.id === 'setup')
    expect(setupSection).toBeDefined()
    const countItem = setupSection!.items.find(i => i.key === 'count')
    expect(countItem).toBeDefined()
    expect(countItem!.value).toBe(42)
    expect(countItem!.badge).toBe('ref')
    expect(countItem!.editable).toBe(true)
    expect(countItem!.persistable).toBe(true)
  })

  it('extracts reactive values with badge and editable=true', () => {
    const reactiveObj = createReactive({ x: 1 })
    const instance = {
      setupState: { state: reactiveObj, __v_raw: { state: reactiveObj } },
    }

    const sections = extractSections(instance)
    const setupSection = sections.find(s => s.id === 'setup')
    expect(setupSection).toBeDefined()
    const stateItem = setupSection!.items.find(i => i.key === 'state')
    expect(stateItem!.badge).toBe('reactive')
    expect(stateItem!.editable).toBe(true)
    expect(stateItem!.persistable).toBe(true)
    expect(stateItem!.editHint).toEqual({ kind: 'vue-reactive-path', varName: 'state', propertyPath: [] })
  })

  it('extracts computed values in separate section', () => {
    const computedVal = createComputed('derived')
    const instance = {
      setupState: {
        fullName: 'derived',
        __v_raw: { fullName: computedVal },
      },
    }

    const sections = extractSections(instance)
    const computedSection = sections.find(s => s.id === 'computed')
    expect(computedSection).toBeDefined()
    expect(computedSection!.items[0].key).toBe('fullName')
    expect(computedSection!.items[0].editable).toBe(false)
    expect(computedSection!.items[0].badge).toBe('computed')
  })

  it('extracts Options API data with editable=true', () => {
    const instance = {
      data: { name: 'John', age: 30 },
    }

    const sections = extractSections(instance)
    const dataSection = sections.find(s => s.id === 'data')
    expect(dataSection).toBeDefined()
    expect(dataSection!.items.length).toBe(2)
    expect(dataSection!.items[0].editable).toBe(true)
  })

  it('extracts provides (only own, not inherited)', () => {
    const parentProvides = { shared: 'parent' }
    const instance = {
      provides: { shared: 'parent', ownKey: 'ownValue' },
      parent: { provides: parentProvides },
    }

    const sections = extractSections(instance)
    const provideSection = sections.find(s => s.id === 'provide')
    expect(provideSection).toBeDefined()
    // Should only have ownKey, not shared (which is inherited)
    expect(provideSection!.items.length).toBe(1)
    expect(provideSection!.items[0].key).toBe('ownKey')
  })

  it('extracts inject values', () => {
    const instance = {
      type: { inject: ['theme'] },
      proxy: { theme: 'dark' },
    }

    const sections = extractSections(instance)
    const injectSection = sections.find(s => s.id === 'inject')
    expect(injectSection).toBeDefined()
    expect(injectSection!.items[0].key).toBe('theme')
    expect(injectSection!.items[0].value).toBe('dark')
  })

  it('skips internal keys starting with __ or $', () => {
    const instance = {
      setupState: {
        __internal: 'hidden',
        $computed: 'hidden',
        visible: createRef('show'),
        __v_raw: {
          __internal: 'hidden',
          $computed: 'hidden',
          visible: createRef('show'),
        },
      },
    }

    const sections = extractSections(instance)
    const setupSection = sections.find(s => s.id === 'setup')
    expect(setupSection).toBeDefined()
    expect(setupSection!.items.length).toBe(1)
    expect(setupSection!.items[0].key).toBe('visible')
  })

  it('serializes functions as fn()', () => {
    const instance = {
      setupState: {
        handler: () => {},
        __v_raw: { handler: () => {} },
      },
    }

    const sections = extractSections(instance)
    const setupSection = sections.find(s => s.id === 'setup')
    expect(setupSection).toBeDefined()
    expect(setupSection!.items[0].value).toBe('fn()')
  })

  it('serializes component instances as [ComponentInstance]', () => {
    const componentLike = { __v_skip: true, some: 'data' }
    const instance = {
      setupState: {
        child: componentLike,
        __v_raw: { child: componentLike },
      },
    }

    const sections = extractSections(instance)
    const setupSection = sections.find(s => s.id === 'setup')
    expect(setupSection!.items[0].value).toBe('[ComponentInstance]')
  })

  it('omits empty sections', () => {
    const instance = {}
    const sections = extractSections(instance)
    expect(sections.length).toBe(0)
  })

  describe('watcher dep tracking', () => {
    it('extracts dep key names from effect.deps linked list', () => {
      const instance = {
        scope: {
          effects: [
            {
              fn: () => {},
              scheduler: () => {},
              cb: () => {},
              getter: () => 42,
              deps: {
                dep: { key: 'count' },
                nextDep: {
                  dep: { key: 'name' },
                  nextDep: null,
                },
              },
            },
          ],
        },
      }

      const sections = extractSections(instance)
      const watcherSection = sections.find(s => s.id === 'watchers')
      expect(watcherSection).toBeDefined()
      expect(watcherSection!.items[0].depNames).toEqual(['count', 'name'])
    })

    it('deduplicates dep keys', () => {
      const instance = {
        scope: {
          effects: [
            {
              fn: () => {},
              scheduler: () => {},
              deps: {
                dep: { key: 'count' },
                nextDep: {
                  dep: { key: 'count' }, // duplicate
                  nextDep: null,
                },
              },
            },
          ],
        },
      }

      const sections = extractSections(instance)
      const watcherSection = sections.find(s => s.id === 'watchers')
      expect(watcherSection!.items[0].depNames).toEqual(['count'])
    })

    it('returns undefined depNames when no deps linked list', () => {
      const instance = {
        scope: {
          effects: [
            {
              fn: () => {},
              scheduler: () => {},
            },
          ],
        },
      }

      const sections = extractSections(instance)
      const watcherSection = sections.find(s => s.id === 'watchers')
      expect(watcherSection!.items[0].depNames).toBeUndefined()
    })
  })

  describe('composable metadata wiring', () => {
    let savedComposables: any

    beforeEach(() => {
      savedComposables = (globalThis as any).__DEVTOOLS_COMPOSABLES__
    })

    afterEach(() => {
      if (savedComposables === undefined) {
        delete (globalThis as any).__DEVTOOLS_COMPOSABLES__
      } else {
        (globalThis as any).__DEVTOOLS_COMPOSABLES__ = savedComposables
      }
    })

    it('wires sourceFile from composable metadata', () => {
      ;(globalThis as any).__DEVTOOLS_COMPOSABLES__ = {
        'src/App.vue': {
          composables: [
            { h: 'useCounter', l: 5, f: 'src/composables/useCounter.ts', i: [{ n: 'count', h: 'ref', l: 3 }] },
          ],
          locals: [],
        },
      }

      const countRef = createRef(0)
      const instance = {
        type: { __file: '/project/src/App.vue' },
        setupState: { count: countRef, __v_raw: { count: countRef } },
      }

      const sections = extractSections(instance)
      const setupSection = sections.find(s => s.id === 'setup')
      const composableItem = setupSection!.items.find(i => i.key === 'useCounter')
      expect(composableItem).toBeDefined()
      expect(composableItem!.sourceFile).toBe('src/composables/useCounter.ts')
    })

    it('wires depNames from composable metadata', () => {
      ;(globalThis as any).__DEVTOOLS_COMPOSABLES__ = {
        'src/App.vue': {
          composables: [
            { h: 'useFetch', l: 8, d: ['url', 'options'], i: [{ n: 'data', h: 'ref', l: 2 }] },
          ],
          locals: [],
        },
      }

      const dataRef = createRef(null)
      const instance = {
        type: { __file: '/project/src/App.vue' },
        setupState: { data: dataRef, __v_raw: { data: dataRef } },
      }

      const sections = extractSections(instance)
      const setupSection = sections.find(s => s.id === 'setup')
      const composableItem = setupSection!.items.find(i => i.key === 'useFetch')
      expect(composableItem!.depNames).toEqual(['url', 'options'])
    })

    it('wires lineNumber to inner hooks from metadata', () => {
      ;(globalThis as any).__DEVTOOLS_COMPOSABLES__ = {
        'src/App.vue': {
          composables: [
            { h: 'useCounter', l: 5, i: [{ n: 'count', h: 'ref', l: 12 }] },
          ],
          locals: [],
        },
      }

      const countRef = createRef(0)
      const instance = {
        type: { __file: '/project/src/App.vue' },
        setupState: { count: countRef, __v_raw: { count: countRef } },
      }

      const sections = extractSections(instance)
      const setupSection = sections.find(s => s.id === 'setup')
      const composableItem = setupSection!.items.find(i => i.key === 'useCounter')
      expect(composableItem!.innerHooks![0].lineNumber).toBe(12)
    })

    it('resolves depValues from current setupState', () => {
      ;(globalThis as any).__DEVTOOLS_COMPOSABLES__ = {
        'src/App.vue': {
          composables: [
            { h: 'useFetch', l: 8, d: ['url'], i: [{ n: 'data', h: 'ref', l: 2 }] },
          ],
          locals: [],
        },
      }

      const urlRef = createRef('/api/users')
      const dataRef = createRef([1, 2, 3])
      const instance = {
        type: { __file: '/project/src/App.vue' },
        setupState: {
          url: urlRef,
          data: dataRef,
          __v_raw: { url: urlRef, data: dataRef },
        },
      }

      const sections = extractSections(instance)
      const setupSection = sections.find(s => s.id === 'setup')
      const composableItem = setupSection!.items.find(i => i.key === 'useFetch')
      expect(composableItem!.depValues).toEqual(['/api/users'])
    })
  })
})
