/**
 * Vue-specific client runtime.
 * Listens for component update events and sends normalized tree data to the overlay.
 */
import { walkInstanceTree, instanceRefMap } from './instance-walker'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let appInstance: any = null

/**
 * Stores unsaved prop edits so they survive HMR-triggered tree re-walks.
 */
const pendingPropEdits = new Map<string, Map<string, unknown>>()

function getHideLibrary(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HIDE_LIBRARY) !== 'false'
}

function reapplyPendingEdits(nodes: import('../../core/types').NormalizedNode[]) {
  for (const node of nodes) {
    const edits = pendingPropEdits.get(node.id)
    if (edits) {
      for (const [propKey, value] of edits) {
        node.props[propKey] = value
      }
    }
    reapplyPendingEdits(node.children)
  }
}

function walkAndDispatch() {
  // Re-read the app instance in case HMR replaced it
  const app = (window as any).__DANENDZ_DEVTOOLS_VUE_APP__
  if (app?._instance) {
    appInstance = app._instance
  }
  if (!appInstance) return
  const tree = walkInstanceTree(appInstance, getHideLibrary())

  if (pendingPropEdits.size > 0) {
    reapplyPendingEdits(tree)
  }

  window.dispatchEvent(
    new CustomEvent(EVENTS.TREE_UPDATE, { detail: { tree } }),
  )
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
    scheduleWalk()
  }
})

// Listen for component updates
window.addEventListener('__danendz_devtools_vue_update__', () => {
  if (!appInstance) {
    // Try to get the app instance if we haven't captured it yet
    const app = (window as any).__DANENDZ_DEVTOOLS_VUE_APP__
    if (app?._instance) {
      appInstance = app._instance
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

  const instance = instanceRefMap.get(nodeId)
  if (!instance) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Component instance not found for prop edit (node: ${nodeId})` },
    }))
    return
  }

  // Props are read-only in Vue — editing props means editing the parent's binding.
  // For now, update the normalized node display. Full prop editing would require
  // finding the parent instance and modifying its setupState/data that feeds the prop.
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

// Listen for VALUE_EDIT (generic section edits with editHint)
window.addEventListener(EVENTS.VALUE_EDIT, (event: Event) => {
  const { nodeId, editHint, newValue } = (event as CustomEvent).detail

  if (editHint?.kind !== 'vue-path') return

  const { path, stateType } = editHint
  const instance = instanceRefMap.get(nodeId)
  if (!instance) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Component instance not found for edit (node: ${nodeId})` },
    }))
    return
  }

  try {
    if (stateType === 'setup' && instance.setupState) {
      // setupState uses proxyRefs — assigning to it auto-unwraps refs
      const key = path[0]
      instance.setupState[key] = newValue
    } else if (stateType === 'data' && instance.data) {
      const key = path[0]
      instance.data[key] = newValue
    }

    // Vue's reactivity will trigger a re-render, which will fire component:updated
    // and our debounced re-walk will pick up the change
  } catch (err: any) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Failed to edit value: ${err.message}` },
    }))
  }
})
