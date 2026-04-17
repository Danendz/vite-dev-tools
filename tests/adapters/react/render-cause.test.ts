import { describe, it, expect } from 'vitest'
import { computeRenderCause, PERFORMED_WORK_FLAG } from '@/adapters/react/render-cause'

// ---- helpers to build fake fibers ----

interface FakeHook {
  memoizedState: unknown
  next: FakeHook | null
}

function makeHooks(values: unknown[]): FakeHook | null {
  if (values.length === 0) return null
  const nodes: FakeHook[] = values.map((v) => ({ memoizedState: v, next: null }))
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
  contexts?: Array<{ name?: string; value: unknown }>
  flags?: number
  tag?: number
}) {
  return {
    tag: opts.tag ?? 0, // FunctionComponent
    type: opts.type ?? function Named() {},
    memoizedProps: opts.memoizedProps ?? {},
    memoizedState: opts.hooks ? makeHooks(opts.hooks) : null,
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

  it('returns empty changedProps and falls through to parent when props ref-equal', () => {
    const props = { a: 1 }
    const prev = fiber({ memoizedProps: props })
    const next = fiber({ memoizedProps: props, alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('parent')
    expect(cause.changedProps).toBeUndefined()
  })

  it('detects useState change and attaches varName from __devtools_hooks', () => {
    const type = function User() {}
    ;(type as any).__devtools_hooks = [['count', 10]]
    const prev = fiber({ type, hooks: [0] })
    const next = fiber({ type, hooks: [1], alternate: prev })
    const cause = computeRenderCause(next, 1)
    expect(cause.primary).toBe('state')
    expect(cause.changedHooks).toEqual([{ index: 0, hookName: 'hook', varName: 'count' }])
  })

  it('falls back to index-only label when varName metadata is missing', () => {
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
})
