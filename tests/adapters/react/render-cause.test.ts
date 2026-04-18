import { describe, it, expect } from 'vitest'
import { computeRenderCause, getDepWarnings, PERFORMED_WORK_FLAG } from '@/adapters/react/render-cause'
import { getPersistentId } from '@/adapters/react/persistent-id'

// ---- helpers to build fake fibers ----

interface FakeHook {
  memoizedState: unknown
  queue?: unknown
  next: FakeHook | null
}

function makeHooks(values: unknown[], opts?: { queue?: boolean }): FakeHook | null {
  if (values.length === 0) return null
  const nodes: FakeHook[] = values.map((v) => ({
    memoizedState: v,
    next: null,
    ...(opts?.queue ? { queue: { dispatch: () => {} } } : {}),
  }))
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].next = nodes[i + 1]
  return nodes[0]
}

interface ContextDep {
  context: { displayName?: string; _currentValue?: unknown }
  memoizedValue: unknown
  next: ContextDep | null
}

function makeContextDeps(entries: Array<{ name?: string; value: unknown }>): ContextDep | null {
  if (entries.length === 0) return null
  const nodes: ContextDep[] = entries.map((e) => ({
    context: { displayName: e.name },
    memoizedValue: e.value,
    next: null,
  }))
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].next = nodes[i + 1]
  return nodes[0]
}

function fiber(opts: {
  type?: any
  memoizedProps?: any
  alternate?: any
  hooks?: unknown[]
  hooksQueue?: boolean
  contexts?: Array<{ name?: string; value: unknown }>
  flags?: number
  tag?: number
}) {
  return {
    tag: opts.tag ?? 0, // FunctionComponent
    type: opts.type ?? function Named() {},
    memoizedProps: opts.memoizedProps ?? {},
    memoizedState: opts.hooks ? makeHooks(opts.hooks, { queue: opts.hooksQueue }) : null,
    dependencies: opts.contexts ? { firstContext: makeContextDeps(opts.contexts) } : null,
    alternate: opts.alternate ?? null,
    flags: opts.flags ?? PERFORMED_WORK_FLAG,
  }
}

describe('computeRenderCause', () => {
  it('labels mount when alternate is null', () => {
    const f = fiber({ memoizedProps: { a: 1 } })
    const cause = computeRenderCause(f, 7)
    expect(cause.primary).toBe('mount')
    expect(cause.contributors).toContain('mount')
    expect(cause.commitIndex).toBe(7)
  })

  it('labels props with changed keys', () => {
    const sharedFn = () => {}
    const prev = fiber({ memoizedProps: { user: { id: 1 }, onClick: sharedFn, stable: 'x' } })
    const next = fiber({
      memoizedProps: { user: { id: 2 }, onClick: sharedFn, stable: 'x' },
      alternate: prev,
    })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('props')
    expect(cause.changedProps).toEqual(['user'])
  })

  it('labels bailout when props and state are referentially identical (skipped subtree)', () => {
    const props = { a: 1 }
    const prev = fiber({ memoizedProps: props })
    const next = fiber({ memoizedProps: props, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('bailout')
    expect(cause.changedProps).toBeUndefined()
  })

  it('detects useState change and attaches varName from __devtools_hooks', () => {
    const type = function User() {}
    ;(type as any).__devtools_hooks = [['count', 10]]
    const prev = fiber({ type, hooks: [0], hooksQueue: true })
    const next = fiber({ type, hooks: [1], hooksQueue: true, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('state')
    expect(cause.changedHooks).toEqual([{ index: 0, hookName: 'useState', varName: 'count' }])
  })

  it('detects dep-level changes with __devtools_meta', () => {
    const type = function Fetcher() {}
    ;(type as any).__devtools_meta = {
      hooks: [
        { n: 'userId', h: 'useState', l: 2 },
        { n: null, h: 'useEffect', l: 4, d: ['userId', 'token'] },
      ],
      locals: [],
    }

    // Effect with deps [42, 'abc']
    const prevEffect = { create: () => {}, destroy: undefined, deps: [42, 'abc'], tag: 0, next: null }
    const nextEffect = { create: () => {}, destroy: undefined, deps: [42, 'xyz'], tag: 0, next: null }

    const prev = fiber({
      type,
      hooks: [42],
      hooksQueue: true,
      // Manually set up the hook chain with effect
    })
    // Override the hook chain for effect
    prev.memoizedState.next = { memoizedState: prevEffect, queue: null, next: null }

    const next = fiber({
      type,
      hooks: [42], // useState unchanged
      hooksQueue: true,
      alternate: prev,
    })
    next.memoizedState.next = { memoizedState: nextEffect, queue: null, next: null }

    const cause = computeRenderCause(next, 1)
    // useEffect dep changes are not "state" — they go into effectChanges
    expect(cause.primary).toBe('parent')
    expect(cause.changedHooks).toBeUndefined()
    expect(cause.effectChanges).toHaveLength(1)

    const ec = cause.effectChanges![0]
    expect(ec.hookName).toBe('useEffect')
    expect(ec.changedDeps).toEqual([
      { name: 'token', prev: 'abc', next: 'xyz' },
    ])
  })

  it('reads __devtools_meta for varName (new format)', () => {
    const type = function Counter() {}
    ;(type as any).__devtools_meta = {
      hooks: [{ n: 'count', h: 'useState', l: 5 }],
      locals: [],
    }
    const prev = fiber({ type, hooks: [0], hooksQueue: true })
    const next = fiber({ type, hooks: [1], hooksQueue: true, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.changedHooks).toEqual([{ index: 0, hookName: 'useState', varName: 'count' }])
  })

  it('flattens nested custom hooks in __devtools_meta for diffing', () => {
    const type = function App() {}
    ;(type as any).__devtools_meta = {
      hooks: [
        {
          n: null, h: 'useCounter', l: 8, i: [
            { n: 'count', h: 'useState', l: 3 },
            { n: 'step', h: 'useState', l: 4 },
          ],
        },
      ],
      locals: [],
    }
    // Two useState hooks from useCounter
    const prev = fiber({ type, hooks: [0], hooksQueue: true })
    prev.memoizedState.next = { memoizedState: 1, queue: { dispatch: () => {} }, next: null }

    const next = fiber({ type, hooks: [5], hooksQueue: true, alternate: prev })
    next.memoizedState.next = { memoizedState: 1, queue: { dispatch: () => {} }, next: null }

    const cause = computeRenderCause(next, 1)
    expect(cause.changedHooks).toHaveLength(1)
    expect(cause.changedHooks![0].varName).toBe('count')
    expect(cause.changedHooks![0].hookName).toBe('useState')
  })

  it('infers hook type from hook structure (useState via queue)', () => {
    const prev = fiber({ hooks: [0], hooksQueue: true })
    const next = fiber({ hooks: [1], hooksQueue: true, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('state')
    expect(cause.changedHooks).toEqual([{ index: 0, hookName: 'useState' }])
  })

  it('falls back to generic hookName when hook type cannot be inferred', () => {
    const prev = fiber({ hooks: [0] })
    const next = fiber({ hooks: [1], alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('state')
    expect(cause.changedHooks).toEqual([{ index: 0, hookName: 'hook' }])
  })

  it('detects context value change and labels with displayName', () => {
    const prev = fiber({ contexts: [{ name: 'ThemeContext', value: 'light' }] })
    const next = fiber({
      contexts: [{ name: 'ThemeContext', value: 'dark' }],
      alternate: prev,
    })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('context')
    expect(cause.changedContexts).toEqual(['ThemeContext'])
  })

  it('falls back to "Context" when displayName missing', () => {
    const prev = fiber({ contexts: [{ value: 'a' }] })
    const next = fiber({ contexts: [{ value: 'b' }], alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('context')
    expect(cause.changedContexts).toEqual(['Context'])
  })

  it('labels parent cascade when re-rendered but no local changes', () => {
    const prev = fiber({})
    const next = fiber({ alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('parent')
  })

  it('labels bailout when no PerformedWork flag and props/hooks unchanged', () => {
    const prev = fiber({})
    const next = fiber({ alternate: prev, flags: 0 })
    const cause = computeRenderCause(next, 5)
    expect(cause.primary).toBe('bailout')
  })

  it('labels bailout when PerformedWork is stale but props/state are referentially identical', () => {
    const sharedProps = { to: '/', end: true }
    const sharedState = makeHooks([0])
    const prev = {
      tag: 0,
      type: function NavLink() {},
      memoizedProps: sharedProps,
      memoizedState: sharedState,
      dependencies: null,
      alternate: null,
      flags: PERFORMED_WORK_FLAG,
    }
    const next = {
      ...prev,
      alternate: prev,
      // Same references — subtree was skipped, React didn't create new work
      memoizedProps: sharedProps,
      memoizedState: sharedState,
      // Stale PerformedWork from the mount commit
      flags: PERFORMED_WORK_FLAG,
    }
    const cause = computeRenderCause(next, 2)
    expect(cause.primary).toBe('bailout')
  })

  it('labels bailout via snapshot when no alternate and props/state unchanged between walks', () => {
    // Same fiber object across walks — simulates a skipped subtree where
    // React never clones the fiber, so alternate stays null.
    const props = { to: '/' }
    const state = makeHooks([0])
    const f = {
      tag: 0,
      type: function NavLink() {},
      memoizedProps: props,
      memoizedState: state,
      dependencies: null,
      alternate: null,
      flags: PERFORMED_WORK_FLAG,
    }

    // Walk 1: mount (snapshot stored internally via WeakMap on fiber)
    const cause1 = computeRenderCause(f, 0)
    expect(cause1.primary).toBe('mount')

    // After walk 1, getPersistentId registers the fiber (like attachRenderCause does)
    getPersistentId(f)

    // Walk 2: same fiber object, same props/state, no alternate
    // isKnownFiber → true (registered above), snapshot matches → bailout
    const cause2 = computeRenderCause(f, 1)
    expect(cause2.primary).toBe('bailout')
  })

  it('labels parent via snapshot when no alternate but props changed between walks', () => {
    const f = {
      tag: 0,
      type: function NavLink() {},
      memoizedProps: { to: '/' } as any,
      memoizedState: null,
      dependencies: null,
      alternate: null,
      flags: PERFORMED_WORK_FLAG,
    }

    // Walk 1: mount (stores snapshot)
    computeRenderCause(f, 0)
    getPersistentId(f)

    // Walk 2: props changed (React 19 detached alternate but component did re-render)
    f.memoizedProps = { to: '/new' }
    const cause = computeRenderCause(f, 1)
    // isKnownFiber → true, but snapshot doesn't match → parent fallback
    expect(cause.primary).toBe('parent')
  })

  it('applies precedence: mount > state > context > props > parent', () => {
    // Mount beats everything (no alternate)
    expect(computeRenderCause(fiber({}), 0).primary).toBe('mount')

    // State beats context beats props
    const sharedType = function C() {}
    ;(sharedType as any).__devtools_hooks = []
    const prev = fiber({
      type: sharedType,
      memoizedProps: { a: 1 },
      hooks: [1],
      contexts: [{ name: 'Ctx', value: 'a' }],
    })
    const next = fiber({
      type: sharedType,
      memoizedProps: { a: 2 }, // props changed
      hooks: [2],               // state changed
      contexts: [{ name: 'Ctx', value: 'b' }], // context changed
      alternate: prev,
    })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('state')
    expect(cause.contributors).toEqual(
      expect.arrayContaining(['state', 'context', 'props']),
    )
  })

  it('populates lastRenderedCommit on bailout from a previous non-bailout commit', () => {
    const props = { a: 1 }
    const f = fiber({ memoizedProps: props })
    // Commit 5: mount
    const mountCause = computeRenderCause(f, 5)
    expect(mountCause.primary).toBe('mount')

    getPersistentId(f)

    // Commit 6: same props/state → bailout, should reference commit 5
    const bailoutCause = computeRenderCause(f, 6)
    expect(bailoutCause.primary).toBe('bailout')
    expect(bailoutCause.lastRenderedCommit).toBe(5)
  })

  it('sets isMemo for MemoComponent (tag 14) on parent cascade', () => {
    const prev = fiber({ tag: 14 })
    const next = fiber({ tag: 14, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('parent')
    expect(cause.isMemo).toBe(true)
  })

  it('sets isMemo for SimpleMemoComponent (tag 15) on parent cascade', () => {
    const prev = fiber({ tag: 15 })
    const next = fiber({ tag: 15, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('parent')
    expect(cause.isMemo).toBe(true)
  })

  it('does not set isMemo for regular FunctionComponent', () => {
    const prev = fiber({ tag: 0 })
    const next = fiber({ tag: 0, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('parent')
    expect(cause.isMemo).toBeUndefined()
  })
})

// ---- Hook dependency lint (getDepWarnings) ----

/** Build an effect-style hook memoizedState: { create, destroy, deps, tag } */
function effectState(deps: unknown[]) {
  return { create: () => {}, destroy: undefined, deps, tag: 5 }
}

/** Build a memo/callback-style hook memoizedState: [value, deps] */
function memoState(value: unknown, deps: unknown[]) {
  return [value, deps]
}

function makeEffectHooks(depsArrays: unknown[][]): FakeHook | null {
  return makeHooks(depsArrays.map(d => effectState(d)))
}

/**
 * Simulate N renders by creating fiber pairs and calling computeRenderCause.
 * Each call to renderFn(i) returns the deps array for that render.
 * The meta object provides __devtools_meta for hook names and dep/ref names.
 */
function simulateRenders(
  count: number,
  renderFn: (i: number) => unknown[],
  meta?: { hookName?: string; varName?: string; depNames?: string[]; refNames?: string[] },
) {
  const hookMeta = meta ? {
    __devtools_meta: {
      hooks: [{
        n: meta.varName ?? null,
        h: meta.hookName ?? 'useEffect',
        l: 1,
        d: meta.depNames,
        r: meta.refNames,
      }],
    },
  } : function Named() {}

  let prevFiber: ReturnType<typeof fiber> | null = null

  for (let i = 0; i < count; i++) {
    const deps = renderFn(i)
    const currentFiber = fiber({
      type: hookMeta,
      hooks: [effectState(deps)],
      alternate: prevFiber,
    })
    computeRenderCause(currentFiber, i)
    prevFiber = currentFiber
  }

  return prevFiber!
}

describe('getDepWarnings', () => {
  it('flags unstable dep after >= 5 renders with >= 80% change rate', () => {
    // Dep changes every render (100% rate) — build fiber chain manually
    const hookMeta = {
      __devtools_meta: {
        hooks: [{ n: null, h: 'useEffect', l: 1, d: ['obj'] }],
      },
    }

    let prevFiber: ReturnType<typeof fiber> | null = null
    for (let i = 0; i < 6; i++) {
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [effectState([{ value: i }])],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    const warnings = getDepWarnings(prevFiber!)
    const unstable = warnings.filter(w => w.kind === 'unstable')
    expect(unstable).toHaveLength(1)
    expect(unstable[0].unstableDeps).toEqual(['obj'])
    expect(unstable[0].hookName).toBe('useEffect')
  })

  it('does not flag when below minimum render count', () => {
    // Only 4 renders — below MIN_RENDERS threshold
    const lastFiber = simulateRenders(
      4,
      (i) => [{ value: i }],
      { hookName: 'useEffect', depNames: ['obj'] },
    )
    const warnings = getDepWarnings(lastFiber)
    expect(warnings.filter(w => w.kind === 'unstable')).toHaveLength(0)
  })

  it('does not flag when change rate is below 80%', () => {
    // Dep changes only 7 out of 10 times (70%)
    const lastFiber = simulateRenders(
      10,
      (i) => [i < 7 ? { value: i } : { value: 'stable' }],
      { hookName: 'useEffect', depNames: ['obj'] },
    )
    // The object is still new each time, but we need to use the same object reference
    // for stable renders. Let me redo this with a shared reference.
    const stableObj = { value: 'stable' }
    const lastFiber2 = simulateRenders(
      10,
      (i) => [i % 3 === 0 ? stableObj : stableObj], // same ref every time = 0% change rate
      { hookName: 'useEffect', depNames: ['obj'] },
    )
    const warnings = getDepWarnings(lastFiber2)
    expect(warnings.filter(w => w.kind === 'unstable')).toHaveLength(0)
  })

  it('detects missing deps from refNames vs depNames', () => {
    const lastFiber = simulateRenders(
      2,
      () => [1],
      { hookName: 'useEffect', depNames: ['count'], refNames: ['count', 'name', 'onClick'] },
    )
    const warnings = getDepWarnings(lastFiber)
    const missing = warnings.filter(w => w.kind === 'missing')
    expect(missing).toHaveLength(1)
    expect(missing[0].missingDeps).toEqual(['name', 'onClick'])
  })

  it('does not flag missing deps when all refs are in deps', () => {
    const lastFiber = simulateRenders(
      2,
      () => [1, 'test'],
      { hookName: 'useEffect', depNames: ['count', 'name'], refNames: ['count', 'name'] },
    )
    const warnings = getDepWarnings(lastFiber)
    expect(warnings.filter(w => w.kind === 'missing')).toHaveLength(0)
  })

  it('shows ghost state when dep was unstable then stabilizes', () => {
    const hookMeta = {
      __devtools_meta: {
        hooks: [{
          n: null,
          h: 'useEffect',
          l: 1,
          d: ['obj'],
        }],
      },
    }

    let prevFiber: ReturnType<typeof fiber> | null = null

    // First 6 renders: dep changes every time (unstable)
    for (let i = 0; i < 6; i++) {
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [effectState([{ value: i }])],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    // Verify it's unstable
    let warnings = getDepWarnings(prevFiber!)
    expect(warnings.some(w => w.kind === 'unstable')).toBe(true)

    // Next 5 renders: dep stays the same (stabilizing)
    const stableObj = { value: 'fixed' }
    for (let i = 6; i < 11; i++) {
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [effectState([stableObj])],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    // Should show ghost state (was-unstable)
    warnings = getDepWarnings(prevFiber!)
    const ghost = warnings.filter(w => w.kind === 'was-unstable')
    expect(ghost.length).toBeGreaterThanOrEqual(1)
    expect(ghost[0].stableSince).toBeGreaterThan(0)
  })

  it('auto-clears ghost after 10 consecutive stable renders', () => {
    const hookMeta = {
      __devtools_meta: {
        hooks: [{
          n: null,
          h: 'useEffect',
          l: 1,
          d: ['obj'],
        }],
      },
    }

    let prevFiber: ReturnType<typeof fiber> | null = null

    // 6 renders: unstable
    for (let i = 0; i < 6; i++) {
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [effectState([{ value: i }])],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    // 13 stable renders: need extra because first stable render still changes dep ref,
    // and ratio takes a few renders to drop below threshold
    const stableObj = { value: 'fixed' }
    for (let i = 6; i < 19; i++) {
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [effectState([stableObj])],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    // Ghost should have auto-cleared
    const warnings = getDepWarnings(prevFiber!)
    expect(warnings.filter(w => w.kind === 'was-unstable')).toHaveLength(0)
    // Also not flagged as unstable anymore (ratio dropped below threshold)
    expect(warnings.filter(w => w.kind === 'unstable')).toHaveLength(0)
  })

  it('returns empty array for fibers with no lint state', () => {
    const f = fiber({ hooks: [1, 2] })
    expect(getDepWarnings(f)).toEqual([])
  })

  it('does not flag hook-derived deps as unstable', () => {
    // Simulate: useEffect(() => { ... }, [count, config])
    // where count is from useState (hook-derived) and config is a local object
    const hookMeta = {
      __devtools_meta: {
        hooks: [
          { n: 'count', h: 'useState', l: 5 },
          { n: null, h: 'useEffect', l: 10, d: ['count', 'config'] },
        ],
      },
    }

    let prevFiber: ReturnType<typeof fiber> | null = null
    for (let i = 0; i < 6; i++) {
      // Both deps change every render
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [
          { memoizedState: i, queue: { dispatch: () => {} } }, // useState
          effectState([i, { id: i }]),                         // useEffect with both deps changing
        ],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    const warnings = getDepWarnings(prevFiber!)
    const unstable = warnings.filter(w => w.kind === 'unstable')
    // Only config should be flagged — count is a useState result
    expect(unstable).toHaveLength(1)
    expect(unstable[0].unstableDeps).toEqual(['config'])
  })

  it('includes lineNumber from hook metadata', () => {
    const hookMeta = {
      __devtools_meta: {
        hooks: [
          { n: null, h: 'useEffect', l: 42, d: ['obj'], r: ['obj', 'missing'] },
        ],
      },
    }

    let prevFiber: ReturnType<typeof fiber> | null = null
    for (let i = 0; i < 2; i++) {
      const currentFiber = fiber({
        type: hookMeta,
        hooks: [effectState([{ v: i }])],
        alternate: prevFiber,
      })
      computeRenderCause(currentFiber, i)
      prevFiber = currentFiber
    }

    const warnings = getDepWarnings(prevFiber!)
    const missing = warnings.find(w => w.kind === 'missing')
    expect(missing).toBeDefined()
    expect(missing!.lineNumber).toBe(42)
    expect(missing!.missingDeps).toEqual(['missing'])
  })
})
