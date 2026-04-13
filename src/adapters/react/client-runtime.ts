/**
 * React-specific client runtime.
 * Listens for fiber tree commits and sends normalized tree data to the overlay.
 */
import { walkFiberTree } from './fiber-walker'
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
