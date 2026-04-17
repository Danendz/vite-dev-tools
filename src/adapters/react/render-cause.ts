import type { ChangedHook, RenderCause, RenderCauseKind } from '../../core/types'
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
 * Pure — given a current-commit fiber, decide WHY it re-rendered.
 * Assumes the fiber is a component fiber (not host). Callers should filter.
 */
export function computeRenderCause(fiber: any, commitIndex: number): RenderCause {
  // Mount — but only if we haven't seen this fiber before.
  // React 19 aggressively detaches fiber.alternate after commits to save memory,
  // so alternate === null does NOT always mean "first mount".
  if (!fiber.alternate) {
    if (isKnownFiber(fiber)) {
      // We've seen this fiber in a prior walk — React just detached its alternate.
      // Without the alternate we can't diff, so label as parent cascade.
      return { primary: 'parent', contributors: ['parent'], commitIndex }
    }
    return { primary: 'mount', contributors: ['mount'], commitIndex }
  }

  const alternate = fiber.alternate
  const contributors: RenderCauseKind[] = []

  const changedProps = diffProps(alternate.memoizedProps, fiber.memoizedProps)
  const changedHooks = diffHooks(alternate.memoizedState, fiber.memoizedState, fiber.type)
  const changedContexts = diffContexts(alternate.dependencies, fiber.dependencies)

  if (changedHooks.length > 0) contributors.push('state')
  if (changedContexts.length > 0) contributors.push('context')
  if (changedProps.length > 0) contributors.push('props')

  // Bailout: no PerformedWork flag + nothing locally changed
  const performedWork = (fiber.flags & PERFORMED_WORK_FLAG) !== 0
  if (!performedWork && contributors.length === 0) {
    return { primary: 'bailout', contributors: ['bailout'], commitIndex }
  }

  if (contributors.length === 0) {
    // Re-rendered but no local cause ⇒ parent cascade
    return { primary: 'parent', contributors: ['parent'], commitIndex }
  }

  // Precedence: state > context > props
  const primary: RenderCauseKind = contributors[0]

  const cause: RenderCause = { primary, contributors, commitIndex }
  if (changedProps.length > 0) cause.changedProps = changedProps
  if (changedHooks.length > 0) cause.changedHooks = changedHooks
  if (changedContexts.length > 0) cause.changedContexts = changedContexts
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

/** Walk two hook linked lists in lockstep, report indices whose memoizedState differs. */
export function diffHooks(prevHead: any, nextHead: any, fiberType: any): ChangedHook[] {
  const changed: ChangedHook[] = []
  let a = prevHead
  let b = nextHead
  let index = 0
  const hookMeta: unknown[] | undefined = fiberType?.__devtools_hooks
  while (a && b) {
    if (a.memoizedState !== b.memoizedState) {
      const entry: ChangedHook = { index, hookName: 'hook' }
      const meta = hookMeta?.[index]
      if (Array.isArray(meta)) {
        if (typeof meta[0] === 'string') entry.varName = meta[0]
      } else if (typeof meta === 'string') {
        entry.varName = meta
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
