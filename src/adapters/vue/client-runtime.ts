/**
 * Vue-specific client runtime.
 * Listens for component update events and sends normalized tree data to the overlay.
 */
import { walkInstanceTree, instanceRefMap, hostElementRefMap } from './instance-walker'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'
import { recordTrigger, flushTriggers, getVuePersistentId, setLastRenderedCommit } from './render-cause'
import { getRenderHistory } from './render-history'
import type { CommitRecord, CommitComponentEntry } from '../../core/types'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let appInstance: any = null

/** Tracks which component UIDs have been patched with onRenderTriggered */
const patchedComponents = new WeakSet<object>()

/** Components that updated in the current batch (for commit record building) */
const updatedComponentBatch = new Map<number, any>()

/**
 * Stores unsaved prop edits so they survive HMR-triggered tree re-walks.
 */
const pendingPropEdits = new Map<string, Map<string, unknown>>()

/** Stores unsaved text edits so they survive HMR-triggered tree re-walks.
 *  Key: nodeId, Value: Map of fragmentIndex → edited text */
const pendingTextEdits = new Map<string, Map<number, string>>()

function getHideLibrary(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HIDE_LIBRARY) !== 'false'
}

function isRenderCauseEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.RENDER_CAUSE_ENABLED) !== 'false'
}

/**
 * Patch a component instance to record render triggers.
 * Uses Vue 3's onRenderTriggered lifecycle hook.
 */
function patchComponentForRenderCause(instance: any): void {
  if (!instance || patchedComponents.has(instance)) return
  patchedComponents.add(instance)

  // Vue 3 stores lifecycle hooks as arrays on the instance
  // onRenderTriggered hooks are at instance.rtg (render triggered)
  const rtgKey = 'rtg' // Vue 3 internal key for onRenderTriggered
  if (!instance[rtgKey]) instance[rtgKey] = []
  instance[rtgKey].push((event: any) => {
    if (isRenderCauseEnabled()) {
      recordTrigger(instance.uid, event)
    }
  })
}

/**
 * Build a CommitRecord from the current batch of updated components.
 */
function buildCommitRecord(): CommitRecord | null {
  if (updatedComponentBatch.size === 0) return null
  if (!isRenderCauseEnabled()) return null

  const history = getRenderHistory()
  const commitIndex = history.advanceCommitIndex()
  const components: CommitComponentEntry[] = []

  for (const [uid, instance] of updatedComponentBatch) {
    const name = instance.type?.__name ?? instance.type?.name ?? 'Anonymous'
    const filePath = instance.type?.__file
    const source = filePath
      ? { fileName: filePath, lineNumber: 1, columnNumber: 1 }
      : null
    const persistentId = getVuePersistentId(uid)

    const entry = flushTriggers(uid, name, source, persistentId)
    if (entry) {
      setLastRenderedCommit(uid, commitIndex)
      components.push(entry)
    } else {
      // Updated but no trigger info — parent cascade
      setLastRenderedCommit(uid, commitIndex)
      components.push({
        persistentId,
        name,
        source,
        cause: 'parent',
        contributors: ['parent'],
      })
    }
  }

  updatedComponentBatch.clear()

  if (components.length === 0) return null

  const commit: CommitRecord = { commitIndex, timestampMs: Date.now(), components }
  history.record(commit)
  return commit
}

function reapplyPendingEdits(nodes: import('../../core/types').NormalizedNode[]): Array<{nodeId: string, propKey: string}> {
  const reverted: Array<{nodeId: string, propKey: string}> = []

  for (const node of nodes) {
    const edits = pendingPropEdits.get(node.id)
    if (edits) {
      if (node.isHostElement) {
        // Host elements: reapply via direct DOM manipulation
        const el = hostElementRefMap.get(node.id)
        if (el) {
          for (const [propKey, value] of edits) {
            if (value === false || value === null) {
              el.removeAttribute(propKey)
            } else {
              el.setAttribute(propKey, String(value))
            }
            node.props[propKey] = value
          }
        }
      } else {
        for (const [propKey, value] of edits) {
          const freshValue = node.props[propKey]
          // Compare serialized values to handle objects/arrays
          if (JSON.stringify(freshValue) !== JSON.stringify(value)) {
            // Vue re-rendered with a different value — edit was overridden
            edits.delete(propKey)
            reverted.push({ nodeId: node.id, propKey })
          }
          // If equal, getProps() already has the correct value — no override needed
        }
        if (edits.size === 0) pendingPropEdits.delete(node.id)
      }
    }

    // Re-apply text fragment edits
    const textEdits = pendingTextEdits.get(node.id)
    if (textEdits && node.textFragments && node._domElements?.[0]) {
      for (const [idx, newValue] of textEdits) {
        if (idx < node.textFragments.length) {
          node.textFragments[idx] = newValue
          // Update the actual DOM text
          const el = node._domElements[0]
          for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === 3) { // Text node
              child.textContent = newValue
              break
            }
          }
        }
      }
      node.textContent = node.textFragments.join('')
    }

    reverted.push(...reapplyPendingEdits(node.children))
  }

  return reverted
}

function walkAndDispatch() {
  // Re-read the app instance in case HMR replaced it
  const app = (window as any).__DANENDZ_DEVTOOLS_VUE_APP__
  if (app?._instance) {
    appInstance = app._instance
  }
  if (!appInstance) return
  const tree = walkInstanceTree(appInstance, getHideLibrary())

  let reverted: Array<{nodeId: string, propKey: string}> = []
  if (pendingPropEdits.size > 0 || pendingTextEdits.size > 0) {
    reverted = reapplyPendingEdits(tree)
  }

  // Build commit record from batched component updates
  const commit = buildCommitRecord()

  window.dispatchEvent(
    new CustomEvent(EVENTS.TREE_UPDATE, { detail: { tree, commit } }),
  )

  // Notify overlay to clear "edited" highlight for reverted props
  for (const { nodeId, propKey } of reverted) {
    window.dispatchEvent(new CustomEvent(EVENTS.PROP_PERSISTED, {
      detail: { nodeId, propKey },
    }))
  }
}

function scheduleWalk() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    walkAndDispatch()
  }, 100)
}

// Listen for Vue app initialization
window.addEventListener('__danendz_devtools_vue_init__', (event: Event) => {
  const { app } = (event as CustomEvent).detail
  if (app?._instance) {
    appInstance = app._instance
    patchComponentForRenderCause(appInstance)
    scheduleWalk()
  }
})

// Listen for component updates
window.addEventListener('__danendz_devtools_vue_update__', (event: Event) => {
  if (!appInstance) {
    const app = (window as any).__DANENDZ_DEVTOOLS_VUE_APP__
    if (app?._instance) {
      appInstance = app._instance
    }
  }

  // Track the updated component for commit record building
  const detail = (event as CustomEvent).detail
  if (detail?.instance) {
    patchComponentForRenderCause(detail.instance)
    if (isRenderCauseEnabled()) {
      updatedComponentBatch.set(detail.instance.uid, detail.instance)
    }
  }

  scheduleWalk()
})

// Listen for re-walk requests (e.g. when hide-library setting changes)
window.addEventListener(EVENTS.REWALK, () => {
  walkAndDispatch()
})

// Listen for prop edit requests from the overlay
window.addEventListener(EVENTS.PROP_EDIT, (event: Event) => {
  const { nodeId, propKey, newValue } = (event as CustomEvent).detail

  if (!pendingPropEdits.has(nodeId)) pendingPropEdits.set(nodeId, new Map())
  pendingPropEdits.get(nodeId)!.set(propKey, newValue)

  // Check if this is a host element edit — apply via direct DOM manipulation
  const hostEl = hostElementRefMap.get(nodeId)
  if (hostEl) {
    if (newValue === false || newValue === null) {
      hostEl.removeAttribute(propKey)
    } else {
      hostEl.setAttribute(propKey, String(newValue))
    }
    walkAndDispatch()
    return
  }

  const instance = instanceRefMap.get(nodeId)
  if (!instance) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Component instance not found for prop edit (node: ${nodeId})` },
    }))
    return
  }

  // Vue 3 wraps instance.props in readonly(shallowReactive(raw)).
  // Drill through __v_raw to reach the raw props object, set the value,
  // then force the component to re-render via instance.update().
  let propsTarget = instance.props
  try {
    // Two __v_raw hops: readonly proxy → shallowReactive proxy → raw object
    const reactive = propsTarget?.__v_raw
    if (reactive) {
      const raw = reactive.__v_raw
      propsTarget = raw || reactive
    }
  } catch {}
  propsTarget[propKey] = newValue

  if (typeof instance.update === 'function') {
    instance.update()
  }

  walkAndDispatch()
})

// When a prop is persisted to source, remove it from pending edits
window.addEventListener(EVENTS.PROP_PERSISTED, (event: Event) => {
  const { nodeId, propKey } = (event as CustomEvent).detail
  const nodeEdits = pendingPropEdits.get(nodeId)
  if (nodeEdits) {
    nodeEdits.delete(propKey)
    if (nodeEdits.size === 0) pendingPropEdits.delete(nodeId)
  }
})

// Listen for text edit requests from the overlay
window.addEventListener(EVENTS.TEXT_EDIT, (event: Event) => {
  const { nodeId, fragmentIndex, newValue } = (event as CustomEvent).detail

  if (!pendingTextEdits.has(nodeId)) pendingTextEdits.set(nodeId, new Map())
  pendingTextEdits.get(nodeId)!.set(fragmentIndex, newValue)

  walkAndDispatch()
})

// Listen for VALUE_EDIT (generic section edits with editHint)
window.addEventListener(EVENTS.VALUE_EDIT, (event: Event) => {
  const { nodeId, editHint, newValue } = (event as CustomEvent).detail

  const instance = instanceRefMap.get(nodeId)
  if (!instance) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Component instance not found for edit (node: ${nodeId})` },
    }))
    return
  }

  try {
    if (editHint?.kind === 'vue-path') {
      const { path, stateType } = editHint
      if (stateType === 'setup' && instance.setupState) {
        const key = path[0]
        instance.setupState[key] = newValue
      } else if (stateType === 'data' && instance.data) {
        const key = path[0]
        instance.data[key] = newValue
      }
    } else if (editHint?.kind === 'vue-reactive-path') {
      const { varName, propertyPath } = editHint
      if (instance.setupState) {
        // Navigate the reactive proxy via the property path
        let target = instance.setupState[varName]
        if (target && propertyPath.length > 0) {
          for (let i = 0; i < propertyPath.length - 1; i++) {
            target = target[propertyPath[i]]
            if (!target) break
          }
          if (target) {
            target[propertyPath[propertyPath.length - 1]] = newValue
          }
        } else if (target !== undefined && propertyPath.length === 0) {
          // Replacing the entire reactive object value
          instance.setupState[varName] = newValue
        }
      }
    }

    // Vue's reactivity will trigger a re-render, which will fire component:updated
    // and our debounced re-walk will pick up the change
  } catch (err: any) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Failed to edit value: ${err.message}` },
    }))
  }
})
