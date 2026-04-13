/**
 * React-specific client runtime.
 * Listens for fiber tree commits and sends normalized tree data to the overlay.
 */
import { walkFiberTree, fiberRefMap } from './fiber-walker'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastFiberRoot: any = null

function getHideLibrary(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HIDE_LIBRARY) !== 'false'
}

function getHideProviders(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HIDE_PROVIDERS) !== 'false'
}

function walkAndDispatch() {
  if (!lastFiberRoot) return
  const tree = walkFiberTree(lastFiberRoot, getHideLibrary(), getHideProviders())
  window.dispatchEvent(
    new CustomEvent(EVENTS.TREE_UPDATE, { detail: { tree } }),
  )
}

function handleCommit(event: Event) {
  const { root } = (event as CustomEvent).detail

  // Debounce: React can commit multiple times in quick succession
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const fiberRoot = root.current
    if (!fiberRoot) return

    lastFiberRoot = fiberRoot
    walkAndDispatch()
  }, 100)
}

// Listen for fiber commits from the hook
window.addEventListener('__danendz_devtools_commit__', handleCommit)

// Listen for re-walk requests (e.g. when hide-library setting changes)
window.addEventListener(EVENTS.REWALK, () => {
  walkAndDispatch()
})

// Listen for prop edit requests from the overlay
window.addEventListener(EVENTS.PROP_EDIT, (event: Event) => {
  const { nodeId, propKey, newValue } = (event as CustomEvent).detail

  const fiber = fiberRefMap.get(nodeId)
  if (!fiber) {
    console.warn('[devtools] Fiber not found for nodeId:', nodeId)
    return
  }

  const renderer = (window as any).__DANENDZ_DEVTOOLS_RENDERER__
  if (renderer?.overrideProps) {
    renderer.overrideProps(fiber, [propKey], newValue)
  } else {
    // Fallback: direct mutation
    if (fiber.pendingProps) fiber.pendingProps[propKey] = newValue
    if (fiber.memoizedProps) fiber.memoizedProps[propKey] = newValue
    walkAndDispatch()
  }
})

// Listen for hook edit requests from the overlay
window.addEventListener(EVENTS.HOOK_EDIT, (event: Event) => {
  const { nodeId, hookIndex, newValue, hookType } = (event as CustomEvent).detail

  const fiber = fiberRefMap.get(nodeId)
  if (!fiber) {
    console.warn('[devtools] Fiber not found for nodeId:', nodeId)
    return
  }

  // Walk memoizedState linked list to the target hookIndex
  let hook = fiber.memoizedState
  for (let i = 0; i < hookIndex; i++) {
    if (!hook) break
    hook = hook.next
  }

  if (!hook) {
    console.warn('[devtools] Hook not found at index:', hookIndex)
    return
  }

  if (hookType === 'useState') {
    if (hook.queue?.dispatch) {
      hook.queue.dispatch(newValue)
    } else {
      console.warn('[devtools] No dispatch function found on useState hook at index:', hookIndex)
    }
  } else if (hookType === 'useRef') {
    hook.memoizedState.current = newValue
    walkAndDispatch()
  }
})
