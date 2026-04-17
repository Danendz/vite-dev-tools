/**
 * Vue render-cause detection using Vue 3's onRenderTriggered lifecycle hook.
 * Unlike React's fiber diff approach, Vue's reactivity system tells us exactly
 * which reactive source triggered the re-render.
 */
import type { RenderCauseKind, CommitComponentEntry } from '../../core/types'

/** Pending triggers for the current update batch, keyed by component uid */
const pendingTriggers = new Map<number, TriggerEvent[]>()

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
 * Flush pending triggers for a component and build a CommitComponentEntry.
 * Called after the component finishes updating.
 */
export function flushTriggers(
  uid: number,
  name: string,
  source: { fileName: string; lineNumber: number; columnNumber: number } | null,
  persistentId: number,
): CommitComponentEntry | null {
  const triggers = pendingTriggers.get(uid)
  pendingTriggers.delete(uid)

  if (!triggers || triggers.length === 0) {
    return null
  }

  const cause = classifyTriggers(triggers)

  return {
    persistentId,
    name,
    source,
    cause: cause.primary,
    contributors: cause.contributors,
    changedProps: cause.changedProps?.length ? cause.changedProps : undefined,
    changedHooks: cause.changedHooks?.length ? cause.changedHooks : undefined,
  }
}

/**
 * Classify trigger events into render cause categories.
 * Vue trigger types map to: ref/reactive mutation → 'state', prop change → 'props'.
 */
function classifyTriggers(triggers: TriggerEvent[]): {
  primary: RenderCauseKind
  contributors: RenderCauseKind[]
  changedProps?: string[]
  changedHooks?: Array<{ index: number; hookName: string; varName?: string }>
} {
  const contributors: Set<RenderCauseKind> = new Set()
  const changedKeys: string[] = []

  for (const trigger of triggers) {
    const keyStr = trigger.key != null ? String(trigger.key) : undefined

    // Check if the target is a props object (has __v_isReadonly and was passed from parent)
    if (trigger.target && (trigger.target as any).__v_isReadonly) {
      contributors.add('props')
      if (keyStr) changedKeys.push(keyStr)
    } else {
      // ref/reactive mutations are state changes
      contributors.add('state')
      if (keyStr) changedKeys.push(keyStr)
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
    changedProps: contributorArray.includes('props') ? changedKeys : undefined,
    changedHooks: contributorArray.includes('state')
      ? changedKeys.map((k, i) => ({ index: i, hookName: 'ref', varName: k }))
      : undefined,
  }
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

/** Simple counter for persistent IDs in Vue (like React's WeakMap approach) */
const vueIdMap = new Map<number, number>()
let nextVueId = 1

export function getVuePersistentId(uid: number): number {
  let id = vueIdMap.get(uid)
  if (id === undefined) {
    id = nextVueId++
    vueIdMap.set(uid, id)
  }
  return id
}
