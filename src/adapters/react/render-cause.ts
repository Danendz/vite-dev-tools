import type { ChangedHook, RenderCause, RenderCauseKind } from '../../core/types'
import { inferHookType } from './fiber-walker'
import { isKnownFiber } from './persistent-id'

/**
 * React's `PerformedWork` flag. When this bit is NOT set on a committed fiber,
 * the fiber bailed out (render function didn't run this commit).
 * Value is stable across React 16–19.
 */
export const PERFORMED_WORK_FLAG = 0b1

// Fiber tag constants (duplicated from fiber-walker to keep this module standalone)
const FunctionComponent = 0
const ClassComponent = 1
const ForwardRef = 11
const MemoComponent = 14
const SimpleMemoComponent = 15

const COMPONENT_TAGS = new Set([
  FunctionComponent,
  ClassComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
])

/**
 * Cross-walk snapshot of each fiber's props/state references.
 * Keyed by fiber object — works because skipped-subtree fibers are the SAME
 * object across walks (React never clones them). WeakMap allows GC on unmount.
 */
const fiberSnapshot = new WeakMap<object, { props: any; state: any }>()

/**
 * Tracks the last commit index where each fiber actually rendered (non-bailout).
 * Used to populate `lastRenderedCommit` on bailout causes.
 */
const lastRenderedCommitMap = new WeakMap<object, number>()

/**
 * Given a current-commit fiber, decide WHY it re-rendered.
 * Assumes the fiber is a component fiber (not host). Callers should filter.
 */
export function computeRenderCause(fiber: any, commitIndex: number): RenderCause {
  // Read previous snapshot before updating it
  const prevSnap = fiberSnapshot.get(fiber)
  fiberSnapshot.set(fiber, { props: fiber.memoizedProps, state: fiber.memoizedState })

  // Snapshot bailout: if this is the same fiber object as the last walk and its
  // props/state refs are identical, the fiber was part of a skipped subtree —
  // React never cloned it this commit. This catches cases where the alternate
  // has stale data from a prior commit that would cause false diffs.
  if (prevSnap && fiber.memoizedProps === prevSnap.props && fiber.memoizedState === prevSnap.state) {
    const lastRendered = lastRenderedCommitMap.get(fiber)
    return { primary: 'bailout', contributors: ['bailout'], commitIndex, lastRenderedCommit: lastRendered }
  }

  // Mount — but only if we haven't seen this fiber before.
  // React 19 aggressively detaches fiber.alternate after commits to save memory,
  // so alternate === null does NOT always mean "first mount".
  if (!fiber.alternate) {
    if (isKnownFiber(fiber)) {
      lastRenderedCommitMap.set(fiber, commitIndex)
      return { primary: 'parent', contributors: ['parent'], commitIndex }
    }
    lastRenderedCommitMap.set(fiber, commitIndex)
    return { primary: 'mount', contributors: ['mount'], commitIndex }
  }

  const alternate = fiber.alternate
  const contributors: RenderCauseKind[] = []

  const changedProps = diffProps(alternate.memoizedProps, fiber.memoizedProps)
  // For memo() components, __devtools_meta is on elementType (the memo wrapper), not type (the inner fn)
  const fiberTypeWithMeta = fiber.type?.__devtools_meta ? fiber.type : (fiber.elementType ?? fiber.type)
  const changedHooks = diffHooks(alternate.memoizedState, fiber.memoizedState, fiberTypeWithMeta)
  const changedContexts = diffContexts(alternate.dependencies, fiber.dependencies)

  // Exclude hooks we can positively identify as effects/memos — their memoizedState
  // always changes each render and they're consequences, not causes.
  const NON_STATE_HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useMemo', 'useCallback'])
  const stateHooks = changedHooks.filter(h => !NON_STATE_HOOKS.has(h.hookName))
  if (stateHooks.length > 0) contributors.push('state')
  if (changedContexts.length > 0) contributors.push('context')
  if (changedProps.length > 0) contributors.push('props')

  // Pre-compute effect dep diffs (attached to all non-bailout causes)
  const effectHooks = changedHooks.filter(h => NON_STATE_HOOKS.has(h.hookName) && h.changedDeps && h.changedDeps.length > 0)
  const effectChanges = effectHooks.length > 0
    ? effectHooks.map(h => ({ hookIndex: h.index, hookName: h.hookName, varName: h.varName, changedDeps: h.changedDeps! }))
    : undefined

  // Bailout: no PerformedWork flag + nothing locally changed.
  // React doesn't clear flags on bailed-out subtrees, so PerformedWork can be
  // stale from a prior commit. Cross-check: if both memoizedProps and
  // memoizedState are referentially identical to the alternate, no new work
  // was created for this fiber — it was part of a skipped subtree.
  const performedWork = (fiber.flags & PERFORMED_WORK_FLAG) !== 0
  const propsIdentical = fiber.memoizedProps === alternate.memoizedProps
  const stateIdentical = fiber.memoizedState === alternate.memoizedState

  if (contributors.length === 0 && (!performedWork || (propsIdentical && stateIdentical))) {
    const lastRendered = lastRenderedCommitMap.get(fiber) ?? lastRenderedCommitMap.get(alternate)
    return { primary: 'bailout', contributors: ['bailout'], commitIndex, lastRenderedCommit: lastRendered }
  }

  const isMemo = fiber.tag === MemoComponent || fiber.tag === SimpleMemoComponent

  if (contributors.length === 0) {
    // Re-rendered but no local cause ⇒ parent cascade
    lastRenderedCommitMap.set(fiber, commitIndex)
    if (fiber.alternate) lastRenderedCommitMap.set(fiber.alternate, commitIndex)
    return { primary: 'parent', contributors: ['parent'], commitIndex, isMemo: isMemo || undefined, effectChanges }
  }

  // Precedence: state > context > props
  const primary: RenderCauseKind = contributors[0]

  lastRenderedCommitMap.set(fiber, commitIndex)
  if (fiber.alternate) lastRenderedCommitMap.set(fiber.alternate, commitIndex)
  const cause: RenderCause = { primary, contributors, commitIndex, isMemo: isMemo || undefined }
  if (changedProps.length > 0) cause.changedProps = changedProps
  if (stateHooks.length > 0) cause.changedHooks = stateHooks
  if (changedContexts.length > 0) cause.changedContexts = changedContexts
  if (effectChanges) cause.effectChanges = effectChanges

  return cause
}

/** Shallow ref-diff keys. React.memo semantics. */
export function diffProps(prev: any, next: any): string[] {
  if (prev === next) return []
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') {
    return []
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changed: string[] = []
  for (const k of keys) {
    if (prev[k] !== next[k]) changed.push(k)
  }
  return changed
}

/**
 * Flatten the __devtools_meta.hooks tree into a flat array aligned with React's hook list.
 * Custom hooks with inner hooks are expanded; only leaf hooks appear in the result.
 */
function flattenMetaHooks(hooks: any[]): Array<{ varName: string | null; hookName: string; depNames?: string[] }> {
  const flat: Array<{ varName: string | null; hookName: string; depNames?: string[] }> = []
  for (const h of hooks) {
    if (h.i && h.i.length > 0) {
      flat.push(...flattenMetaHooks(h.i))
    } else {
      flat.push({ varName: h.n, hookName: h.h, depNames: h.d })
    }
  }
  return flat
}

/** Extract the dependency array from a hook's memoizedState (effect or memo/callback) */
function extractDepsFromHook(hook: any): unknown[] | null {
  const ms = hook.memoizedState
  // Effect hooks: { create, destroy, deps, tag }
  if (ms && typeof ms === 'object' && !Array.isArray(ms) && 'deps' in ms) {
    return ms.deps
  }
  // Memo/callback hooks: [value, deps]
  if (Array.isArray(ms) && ms.length === 2 && Array.isArray(ms[1])) {
    return ms[1]
  }
  return null
}

/** Walk two hook linked lists in lockstep, report indices whose memoizedState differs. */
export function diffHooks(prevHead: any, nextHead: any, fiberType: any): ChangedHook[] {
  const changed: ChangedHook[] = []
  let a = prevHead
  let b = nextHead
  let index = 0

  // Try new metadata format first, fall back to legacy
  const devtoolsMeta = fiberType?.__devtools_meta
  const flatMeta = devtoolsMeta?.hooks ? flattenMetaHooks(devtoolsMeta.hooks) : null
  const legacyHookMeta: unknown[] | undefined = fiberType?.__devtools_hooks

  while (a && b) {
    if (a.memoizedState !== b.memoizedState) {
      const inferred = inferHookType(b)
      // Prefer metadata hook name over inferred (inferred misses React 19 effect structure)
      const metaEntry = flatMeta?.[index]
      const hookName = (inferred.name !== 'hook' ? inferred.name : metaEntry?.hookName) ?? inferred.name
      const entry: ChangedHook = { index, hookName }

      if (metaEntry) {
        const meta = metaEntry
        if (meta.varName) entry.varName = meta.varName

        // Dep-level diffing for effect/memo/callback hooks
        if (meta.depNames && meta.depNames.length > 0) {
          const prevDeps = extractDepsFromHook(a)
          const nextDeps = extractDepsFromHook(b)
          if (prevDeps && nextDeps) {
            const changedDeps: Array<{ name: string; prev: unknown; next: unknown }> = []
            const maxLen = Math.max(prevDeps.length, nextDeps.length)
            for (let di = 0; di < maxLen; di++) {
              if (!Object.is(prevDeps[di], nextDeps[di])) {
                changedDeps.push({
                  name: meta.depNames[di] ?? `dep[${di}]`,
                  prev: prevDeps[di],
                  next: nextDeps[di],
                })
              }
            }
            if (changedDeps.length > 0) entry.changedDeps = changedDeps
          }
        }
      } else if (legacyHookMeta) {
        const meta = legacyHookMeta[index]
        if (Array.isArray(meta)) {
          if (typeof meta[0] === 'string') entry.varName = meta[0]
        } else if (typeof meta === 'string') {
          entry.varName = meta
        }
      }

      changed.push(entry)
    }
    a = a.next
    b = b.next
    index++
  }
  return changed
}

/** Walk both fibers' context dependency lists and report which contexts changed. */
export function diffContexts(prevDeps: any, nextDeps: any): string[] {
  const prev = collectContexts(prevDeps?.firstContext)
  const next = collectContexts(nextDeps?.firstContext)
  const len = Math.max(prev.length, next.length)
  const changed: string[] = []
  for (let i = 0; i < len; i++) {
    const p = prev[i]
    const n = next[i]
    if (!p || !n) continue
    if (p.value !== n.value) {
      changed.push(n.name || p.name || 'Context')
    }
  }
  return changed
}

function collectContexts(head: any): Array<{ name?: string; value: unknown }> {
  const out: Array<{ name?: string; value: unknown }> = []
  let node = head
  while (node) {
    out.push({
      name: node.context?.displayName,
      value: node.memoizedValue,
    })
    node = node.next
  }
  return out
}

export function isComponentFiber(fiber: any): boolean {
  return COMPONENT_TAGS.has(fiber?.tag)
}
