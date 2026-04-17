/**
 * Vue render-cause detection using Vue 3's onRenderTriggered lifecycle hook.
 * Unlike React's fiber diff approach, Vue's reactivity system tells us exactly
 * which reactive source triggered the re-render.
 */
import type { RenderCauseKind, CommitComponentEntry } from '../../core/types'
import { safeStringify, prettyStringify } from '../../shared/preview-value'

/** Pending triggers for the current update batch, keyed by component uid */
const pendingTriggers = new Map<number, TriggerEvent[]>()

/** Track which UIDs have been seen — first appearance = mount */
const seenUids = new Set<number>()

interface TriggerEvent {
  type: 'set' | 'get' | 'add' | 'delete' | 'clear' | 'has' | 'iterate'
  key: string | symbol | undefined
  newValue?: unknown
  oldValue?: unknown
  target: object
}

/**
 * Record a render trigger event for a component instance.
 * Called from the onRenderTriggered hook patched onto each component.
 */
export function recordTrigger(uid: number, event: any): void {
  if (!pendingTriggers.has(uid)) pendingTriggers.set(uid, [])
  pendingTriggers.get(uid)!.push({
    type: event.type,
    key: event.key,
    newValue: event.newValue,
    oldValue: event.oldValue,
    target: event.target,
  })
}

/**
 * Clear mount tracking for a component that was removed.
 */
export function clearSeen(uid: number): void {
  seenUids.delete(uid)
}

/**
 * Flush pending triggers for a component and build a CommitComponentEntry.
 * Called during the tree walk for each component that updated.
 */
export function flushTriggers(
  uid: number,
  name: string,
  source: { fileName: string; lineNumber: number; columnNumber: number } | null,
  persistentId: number,
  instance: any,
  includeValues: boolean,
): CommitComponentEntry | null {
  const triggers = pendingTriggers.get(uid)
  pendingTriggers.delete(uid)

  // Mount detection: first time we see this uid
  const isMount = !seenUids.has(uid)
  if (isMount) {
    seenUids.add(uid)
    return {
      persistentId,
      name,
      source,
      cause: 'mount',
      contributors: ['mount'],
    }
  }

  if (!triggers || triggers.length === 0) {
    return null
  }

  const cause = classifyTriggers(triggers, instance)

  const entry: CommitComponentEntry = {
    persistentId,
    name,
    source,
    cause: cause.primary,
    contributors: cause.contributors,
    changedProps: cause.changedProps?.length ? cause.changedProps : undefined,
    changedHooks: cause.changedHooks?.length ? cause.changedHooks : undefined,
    changedContexts: cause.changedContexts?.length ? cause.changedContexts : undefined,
  }

  // Value diffs
  if (includeValues) {
    buildValueDiffs(entry, cause, cause.ownTargets)
  }

  // Effect/watcher correlation
  const effectChanges = correlateWatcherDeps(triggers, instance)
  if (effectChanges.length > 0) {
    entry.effectChanges = effectChanges
  }

  return entry
}

/**
 * Unwrap a Vue reactive proxy to its raw target.
 */
function toRaw(value: any): any {
  if (value && typeof value === 'object') {
    const raw = value.__v_raw
    return raw ? toRaw(raw) : value
  }
  return value
}

/**
 * Build maps for classifying trigger targets:
 * - ownTargets: raw target → variable name (from setupState)
 * - contextTargets: raw target → inject key name (from provides chain, not in own state)
 *
 * For Composition API inject(), instance.type.inject is NOT set.
 * Instead, we detect context by checking if a trigger target matches a value
 * from the provides chain but is NOT in the component's own setupState.
 */
function buildTargetMaps(instance: any): {
  ownTargets: Map<object, string>
  contextTargets: Map<object, string>
} {
  const ownTargets = new Map<object, string>()
  const contextTargets = new Map<object, string>()

  // Map own setupState values → variable names
  const setupState = instance.setupState
  if (setupState) {
    const raw = setupState.__v_raw ?? setupState
    for (const key of Object.keys(raw)) {
      if (key.startsWith('__') || key.startsWith('$')) continue
      const val = raw[key]
      if (val !== null && typeof val === 'object') {
        ownTargets.set(toRaw(val), key)
      }
    }
  }

  // Walk the provides chain to find injected reactive values.
  // A value is "injected" if it's in an ancestor's provides but NOT in our own setupState.
  const parentProvides = instance.parent?.provides
  if (parentProvides && typeof parentProvides === 'object') {
    for (const key of Reflect.ownKeys(parentProvides)) {
      const val = parentProvides[key]
      if (val !== null && typeof val === 'object') {
        const rawVal = toRaw(val)
        if (!ownTargets.has(rawVal)) {
          contextTargets.set(rawVal, typeof key === 'symbol' ? key.description ?? 'inject' : String(key))
        }
      }
    }
  }

  return { ownTargets, contextTargets }
}

interface ClassifyResult {
  primary: RenderCauseKind
  contributors: RenderCauseKind[]
  changedProps?: string[]
  changedHooks?: Array<{ index: number; hookName: string; varName?: string }>
  changedContexts?: string[]
  /** Triggers grouped by cause type for value diff building */
  propTriggers: TriggerEvent[]
  stateTriggers: TriggerEvent[]
  contextTriggers: TriggerEvent[]
  /** Raw target → variable name map from setupState */
  ownTargets: Map<object, string>
}

/**
 * Classify trigger events into render cause categories.
 * Vue trigger types map to: ref/reactive mutation → 'state', prop change → 'props',
 * injected reactive change → 'context'.
 */
function classifyTriggers(triggers: TriggerEvent[], instance: any): ClassifyResult {
  const contributors: Set<RenderCauseKind> = new Set()
  const propKeys: string[] = []
  const stateKeys: string[] = []
  const contextKeys: string[] = []
  const propTriggers: TriggerEvent[] = []
  const stateTriggers: TriggerEvent[] = []
  const contextTriggers: TriggerEvent[] = []

  const { ownTargets, contextTargets } = buildTargetMaps(instance)

  for (const trigger of triggers) {
    // Skip triggers with no key (spurious events)
    if (trigger.key == null) continue

    const keyStr = String(trigger.key)
    const rawTarget = toRaw(trigger.target)

    // Check if this trigger is from an injected/provided reactive value
    const contextLabel = contextTargets.get(rawTarget)
    if (contextLabel) {
      contributors.add('context')
      if (!contextKeys.includes(contextLabel)) contextKeys.push(contextLabel)
      contextTriggers.push(trigger)
    } else if (trigger.target && (trigger.target as any).__v_isReadonly) {
      // Props object (readonly proxy)
      contributors.add('props')
      if (!propKeys.includes(keyStr)) propKeys.push(keyStr)
      propTriggers.push(trigger)
    } else {
      // ref/reactive mutations are state changes
      contributors.add('state')
      // Resolve variable name: for refs, trigger.key is "value" — map to actual var name
      const varName = ownTargets.get(rawTarget) ?? keyStr
      if (!stateKeys.includes(varName)) stateKeys.push(varName)
      stateTriggers.push(trigger)
    }
  }

  const contributorArray = Array.from(contributors) as RenderCauseKind[]
  // Precedence: state > context > props > parent
  const primary = contributorArray.includes('state') ? 'state'
    : contributorArray.includes('context') ? 'context'
    : contributorArray.includes('props') ? 'props'
    : 'parent'

  return {
    primary,
    contributors: contributorArray,
    changedProps: propKeys.length > 0 ? propKeys : undefined,
    changedHooks: stateKeys.length > 0
      ? stateKeys.map((k, i) => ({ index: i, hookName: 'ref', varName: k }))
      : undefined,
    changedContexts: contextKeys.length > 0 ? contextKeys : undefined,
    propTriggers,
    stateTriggers,
    contextTriggers,
    ownTargets,
  }
}

/**
 * Build value diff fields on a CommitComponentEntry from trigger events.
 * Uses ownTargets to resolve variable names for ref triggers (key="value" → varName).
 */
function buildValueDiffs(
  entry: CommitComponentEntry,
  cause: ClassifyResult,
  ownTargets: Map<object, string>,
): void {
  // Props value diffs
  if (cause.propTriggers.length > 0) {
    const prev: Record<string, string> = {}
    const next: Record<string, string> = {}
    const fullPrev: Record<string, string> = {}
    const fullNext: Record<string, string> = {}
    for (const t of cause.propTriggers) {
      if (t.key == null) continue
      const k = String(t.key)
      prev[k] = safeStringify(t.oldValue)
      next[k] = safeStringify(t.newValue)
      fullPrev[k] = prettyStringify(t.oldValue)
      fullNext[k] = prettyStringify(t.newValue)
    }
    entry.previousValues = prev
    entry.nextValues = next
    entry.fullPreviousValues = fullPrev
    entry.fullNextValues = fullNext
  }

  // State + context value diffs (both go into hook values)
  const hookTriggers = [...cause.stateTriggers, ...cause.contextTriggers]
  if (hookTriggers.length > 0) {
    const prev: Record<string, string> = {}
    const next: Record<string, string> = {}
    const fullPrev: Record<string, string> = {}
    const fullNext: Record<string, string> = {}
    for (const t of hookTriggers) {
      if (t.key == null) continue
      // Resolve variable name: for refs, trigger key is "value" — use setupState mapping
      const k = ownTargets.get(toRaw(t.target)) ?? String(t.key)
      prev[k] = safeStringify(t.oldValue)
      next[k] = safeStringify(t.newValue)
      fullPrev[k] = prettyStringify(t.oldValue)
      fullNext[k] = prettyStringify(t.newValue)
    }
    entry.previousHookValues = prev
    entry.nextHookValues = next
    entry.fullPreviousHookValues = fullPrev
    entry.fullNextHookValues = fullNext
  }
}

/**
 * Walk a Vue 3 ReactiveEffect's deps linked list and extract property key names.
 * Vue 3.4+ uses a doubly-linked list: effect.deps → link.nextDep, each link has link.dep.key.
 */
function getEffectDepKeys(effect: any): Set<string> {
  const keys = new Set<string>()
  let link = effect.deps
  while (link) {
    if (link.dep?.key != null) {
      keys.add(String(link.dep.key))
    }
    link = link.nextDep
  }
  return keys
}

/**
 * Correlate trigger events with watcher dependencies.
 * For each watcher effect, check if any trigger key matches a dep key.
 */
function correlateWatcherDeps(
  triggers: TriggerEvent[],
  instance: any,
): Array<{
  hookIndex: number
  hookName: string
  varName?: string
  changedDeps: Array<{ name: string; prev: unknown; next: unknown }>
}> {
  const scope = instance?.scope
  if (!scope?.effects) return []

  const changes: Array<{
    hookIndex: number
    hookName: string
    varName?: string
    changedDeps: Array<{ name: string; prev: unknown; next: unknown }>
  }> = []

  let watcherIndex = 0
  for (const effect of scope.effects) {
    if (typeof effect.fn !== 'function' || typeof effect.scheduler !== 'function') continue
    // Skip the component's own render effect
    if (effect === instance.effect) continue

    const hookName = 'watcher'
    const depKeys = getEffectDepKeys(effect)

    if (depKeys.size === 0) {
      watcherIndex++
      continue
    }

    const changedDeps: Array<{ name: string; prev: unknown; next: unknown }> = []
    for (const trigger of triggers) {
      const keyStr = trigger.key != null ? String(trigger.key) : undefined
      if (keyStr && depKeys.has(keyStr)) {
        // Avoid duplicates for the same key
        if (!changedDeps.some(d => d.name === keyStr)) {
          changedDeps.push({
            name: keyStr,
            prev: trigger.oldValue,
            next: trigger.newValue,
          })
        }
      }
    }

    if (changedDeps.length > 0) {
      changes.push({
        hookIndex: watcherIndex,
        hookName,
        varName: `${hookName} #${watcherIndex}`,
        changedDeps,
      })
    }

    watcherIndex++
  }

  return changes
}

/**
 * Reset all module-level state. Used by tests only.
 */
export function _resetForTesting(): void {
  pendingTriggers.clear()
  seenUids.clear()
  lastRenderedCommitMap.clear()
}

/**
 * Track the last commit index where each component rendered.
 */
const lastRenderedCommitMap = new Map<number, number>()

export function setLastRenderedCommit(uid: number, commitIndex: number): void {
  lastRenderedCommitMap.set(uid, commitIndex)
}

export function getLastRenderedCommit(uid: number): number | undefined {
  return lastRenderedCommitMap.get(uid)
}
