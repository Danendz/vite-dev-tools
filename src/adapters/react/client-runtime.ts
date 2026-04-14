/**
 * React-specific client runtime.
 * Listens for fiber tree commits and sends normalized tree data to the overlay.
 */
import { walkFiberTree, fiberRefMap } from './fiber-walker'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastFiberRoot: any = null

/**
 * Stores unsaved prop edits so they survive HMR-triggered tree re-walks.
 * Key: nodeId, Value: Map of propKey → edited value.
 */
const pendingPropEdits = new Map<string, Map<string, unknown>>()

/** Stores unsaved text edits so they survive HMR-triggered tree re-walks.
 *  Key: nodeId, Value: Map of fragmentIndex → edited text */
const pendingTextEdits = new Map<string, Map<number, string>>()

function getHideLibrary(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HIDE_LIBRARY) !== 'false'
}

function getHideProviders(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HIDE_PROVIDERS) !== 'false'
}

function reapplyPendingEdits(nodes: import('../../core/types').NormalizedNode[]) {
  for (const node of nodes) {
    // Re-apply text fragment edits
    const textEdits = pendingTextEdits.get(node.id)
    if (textEdits && node._textFibers && node.textFragments) {
      for (const [idx, newValue] of textEdits) {
        const fiber = node._textFibers[idx]
        if (fiber && fiber.memoizedProps !== newValue) {
          fiber.memoizedProps = newValue
          fiber.pendingProps = newValue
          if (fiber.stateNode && fiber.stateNode.textContent !== undefined) {
            fiber.stateNode.textContent = newValue
          }
        }
        if (node.textFragments[idx] !== undefined) {
          node.textFragments[idx] = newValue
        }
      }
      node.textContent = node.textFragments.join(' ')
    }

    // Re-apply prop edits
    const edits = pendingPropEdits.get(node.id)
    if (edits) {
      const fiber = fiberRefMap.get(node.id)
      if (fiber?.tag === 5 && fiber.stateNode instanceof HTMLElement) {
        // Host element: reapply via direct DOM manipulation
        for (const [propKey, value] of edits) {
          node.props[propKey] = value
          if (value === false || value === null) {
            fiber.stateNode.removeAttribute(propKey)
          } else {
            fiber.stateNode.setAttribute(propKey, String(value))
          }
        }
      } else {
        for (const [propKey, value] of edits) {
          node.props[propKey] = value
          if (fiber?.memoizedProps && fiber.memoizedProps[propKey] !== value) {
            const renderer = (window as any).__DANENDZ_DEVTOOLS_RENDERER__
            if (renderer?.overrideProps) {
              renderer.overrideProps(fiber, [propKey], value)
            } else {
              if (fiber.pendingProps) fiber.pendingProps[propKey] = value
              if (fiber.memoizedProps) fiber.memoizedProps[propKey] = value
            }
          }
        }
      }
    }
    reapplyPendingEdits(node.children)
  }
}

function walkAndDispatch() {
  if (!lastFiberRoot) return
  const tree = walkFiberTree(lastFiberRoot, getHideLibrary(), getHideProviders())

  if (pendingPropEdits.size > 0 || pendingTextEdits.size > 0) {
    reapplyPendingEdits(tree)
  }

  window.dispatchEvent(
    new CustomEvent(EVENTS.TREE_UPDATE, { detail: { tree } }),
  )
}

function handleCommit(event: Event) {
  const { root } = (event as CustomEvent).detail

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

  if (!pendingPropEdits.has(nodeId)) pendingPropEdits.set(nodeId, new Map())
  pendingPropEdits.get(nodeId)!.set(propKey, newValue)

  const fiber = fiberRefMap.get(nodeId)
  if (!fiber) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Fiber not found for prop edit (node: ${nodeId})` },
    }))
    return
  }

  // Host element (tag 5) — apply via direct DOM manipulation
  if (fiber.tag === 5 && fiber.stateNode instanceof HTMLElement) {
    if (newValue === false || newValue === null) {
      fiber.stateNode.removeAttribute(propKey)
    } else {
      fiber.stateNode.setAttribute(propKey, String(newValue))
    }
    walkAndDispatch()
    return
  }

  const renderer = (window as any).__DANENDZ_DEVTOOLS_RENDERER__
  if (renderer?.overrideProps) {
    renderer.overrideProps(fiber, [propKey], newValue)
  } else {
    if (fiber.pendingProps) fiber.pendingProps[propKey] = newValue
    if (fiber.memoizedProps) fiber.memoizedProps[propKey] = newValue
    walkAndDispatch()
  }
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

  if (editHint?.kind !== 'react-hook') return

  const { hookIndex, hookType } = editHint

  const fiber = fiberRefMap.get(nodeId)
  if (!fiber) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Fiber not found for hook edit (node: ${nodeId})` },
    }))
    return
  }

  // Walk memoizedState linked list to the target hookIndex
  let hook = fiber.memoizedState
  for (let i = 0; i < hookIndex; i++) {
    if (!hook) break
    hook = hook.next
  }

  if (!hook) {
    window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
      detail: { type: 'error', message: `Hook not found at index ${hookIndex}` },
    }))
    return
  }

  if (hookType === 'useState') {
    if (hook.queue?.dispatch) {
      hook.queue.dispatch(newValue)
    } else {
      window.dispatchEvent(new CustomEvent(EVENTS.TOAST, {
        detail: { type: 'error', message: `No dispatch function found on useState hook at index ${hookIndex}` },
      }))
    }
  } else if (hookType === 'useRef') {
    hook.memoizedState.current = newValue
    walkAndDispatch()
  }
})

// Listen for text edit requests from the overlay
window.addEventListener(EVENTS.TEXT_EDIT, (event: Event) => {
  const { nodeId, fragmentIndex, newValue } = (event as CustomEvent).detail

  if (!pendingTextEdits.has(nodeId)) pendingTextEdits.set(nodeId, new Map())
  pendingTextEdits.get(nodeId)!.set(fragmentIndex, newValue)

  walkAndDispatch()
})
