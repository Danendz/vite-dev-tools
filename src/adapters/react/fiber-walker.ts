import type { NormalizedNode, HookInfo } from '../../core/types'
import { getOverrides } from '../../core/collapse'

// React fiber tag constants
const FunctionComponent = 0
const ClassComponent = 1
const HostRoot = 3
const HostComponent = 5
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

let nodeIdCounter = 0

function getComponentName(fiber: any): string {
  const type = fiber.type
  if (!type) return 'Unknown'

  if (typeof type === 'string') return type

  if (type.displayName) return type.displayName
  if (type.name) return type.name

  // ForwardRef
  if (type.render) {
    return type.render.displayName || type.render.name || 'ForwardRef'
  }

  // Memo
  if (type.type) {
    return type.type.displayName || type.type.name || 'Memo'
  }

  return 'Anonymous'
}

/**
 * Get the React-provided usage-site source (where component is rendered in parent JSX).
 * Returns from _debugSource (React 18) or _debugStack (React 19+).
 */
function getReactSource(fiber: any) {
  if (fiber._debugSource) {
    return {
      fileName: fiber._debugSource.fileName,
      lineNumber: fiber._debugSource.lineNumber ?? 1,
      columnNumber: fiber._debugSource.columnNumber ?? 1,
    }
  }

  if (fiber._debugStack) {
    const parsed = parseDebugStack(fiber._debugStack)
    if (parsed) return parsed
  }

  return null
}

/**
 * Parse source locations from fiber.
 * Returns both definition-site and usage-site when available.
 * - source: __devtools_source (definition) if available, else React source (usage)
 * - usageSource: React source (usage) only when __devtools_source was used as primary
 */
function getSourceLocations(fiber: any): { source: ReturnType<typeof getReactSource>, usageSource: ReturnType<typeof getReactSource> } {
  const definitionSource = fiber.type?.__devtools_source ?? null
  const reactSource = getReactSource(fiber)

  if (definitionSource) {
    return { source: definitionSource, usageSource: reactSource }
  }
  return { source: reactSource, usageSource: null }
}

// Cache parsed stack results to avoid re-parsing the same stack
const stackCache = new WeakMap<object, ReturnType<typeof parseDebugStack>>()

function parseDebugStack(stack: Error | string) {
  const stackObj = typeof stack === 'string' ? null : stack
  if (stackObj && stackCache.has(stackObj)) {
    return stackCache.get(stackObj)!
  }

  const stackStr = typeof stack === 'string' ? stack : stack.stack
  if (!stackStr) return null

  // Parse stack frames — look for the first frame that points to user source code
  // Stack format: "    at ComponentName (http://localhost:5173/src/App.tsx?t=123:15:3)"
  // Or:           "    at http://localhost:5173/src/App.tsx:15:3"
  const lines = stackStr.split('\n')
  for (const line of lines) {
    // Skip non-frame lines, React internals, and Vite pre-bundled deps
    if (!line.includes('at ')) continue
    if (line.includes('node_modules/')) continue
    if (line.includes('.vite/deps/')) continue
    if (line.includes('.vite/')) continue
    if (line.includes('react-stack-top-frame')) continue
    if (line.includes('chunk-')) continue

    // Match: "at Name (url:line:col)" or "at url:line:col"
    const match = line.match(/(?:https?:\/\/[^/]+)?(\/[^:?]+)(?:\?[^:]*)?:(\d+):(\d+)/)
    if (match) {
      const result = {
        fileName: match[1],
        lineNumber: parseInt(match[2], 10),
        columnNumber: parseInt(match[3], 10),
      }
      if (stackObj) stackCache.set(stackObj, result)
      return result
    }
  }

  if (stackObj) stackCache.set(stackObj, null)
  return null
}

function isFromNodeModules(fiber: any): boolean {
  const { source } = getSourceLocations(fiber)
  // No source info → no __devtools_source injected → not a user file → library component
  if (!source?.fileName) return true
  return source.fileName.includes('node_modules/') || source.fileName.includes('.vite/deps/')
}

/**
 * Infer hook type and extract meaningful display value from React's internal hook structure.
 */
function inferHookType(hook: any): { name: string; value: unknown } {
  const { memoizedState, queue } = hook

  // useState / useReducer: has an update queue
  if (queue !== null && queue !== undefined) {
    return { name: 'useState', value: memoizedState }
  }

  // useEffect / useLayoutEffect / useInsertionEffect: effect object
  if (
    memoizedState !== null &&
    typeof memoizedState === 'object' &&
    !Array.isArray(memoizedState) &&
    'create' in memoizedState &&
    'destroy' in memoizedState
  ) {
    // tag flags: HookInsertion=2, HookLayout=4, HookPassive=8
    const tag = memoizedState.tag
    const name = tag & 4 ? 'useLayoutEffect' : tag & 2 ? 'useInsertionEffect' : 'useEffect'
    return { name, value: memoizedState.deps }
  }

  // useRef: { current: value }
  if (
    memoizedState !== null &&
    typeof memoizedState === 'object' &&
    !Array.isArray(memoizedState) &&
    'current' in memoizedState &&
    Object.keys(memoizedState).length === 1
  ) {
    return { name: 'useRef', value: memoizedState.current }
  }

  // useMemo / useCallback: [value, deps]
  if (Array.isArray(memoizedState) && memoizedState.length === 2) {
    if (typeof memoizedState[0] === 'function') {
      return { name: 'useCallback', value: 'ƒ()' }
    }
    return { name: 'useMemo', value: memoizedState[0] }
  }

  return { name: 'hook', value: memoizedState }
}

function getHooks(fiber: any): HookInfo[] {
  const hooks: HookInfo[] = []

  // Only function components have hooks in memoizedState as linked list
  if (fiber.tag !== FunctionComponent) return hooks

  const rawHookData: unknown[] | undefined = fiber.type?.__devtools_hooks
  let hookIndex = 0
  let hook = fiber.memoizedState
  while (hook !== null && hook !== undefined) {
    const inferred = inferHookType(hook)
    const entry = rawHookData?.[hookIndex]

    let varName: string | undefined
    let lineNumber: number | undefined

    if (Array.isArray(entry)) {
      // New format: [varName, lineNumber]
      varName = entry[0] ?? undefined
      lineNumber = entry[1]
    } else if (typeof entry === 'string') {
      // Old format: just the variable name
      varName = entry
    }

    hooks.push({
      name: inferred.name,
      value: inferred.value,
      varName,
      lineNumber,
    })
    hookIndex++
    hook = hook.next
  }
  return hooks
}

function getProps(fiber: any): Record<string, unknown> {
  const props = fiber.memoizedProps
  if (!props || typeof props !== 'object') return {}

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (key === 'children') continue // skip children prop for cleaner display
    const value = props[key]
    // Only include serializable values
    if (typeof value === 'function') {
      result[key] = `fn()`
    } else if (typeof value === 'object' && value !== null) {
      try {
        // Shallow representation to avoid circular refs
        result[key] = JSON.parse(JSON.stringify(value))
      } catch {
        result[key] = `[Object]`
      }
    } else {
      result[key] = value
    }
  }
  return result
}

function getState(fiber: any): unknown {
  if (fiber.tag === ClassComponent && fiber.stateNode) {
    return fiber.stateNode.state
  }
  return null
}

function findDOMElements(fiber: any): HTMLElement[] {
  const elements: HTMLElement[] = []
  collectDOMElements(fiber.child, elements)
  return elements
}

function collectDOMElements(fiber: any, elements: HTMLElement[]): void {
  while (fiber) {
    if (fiber.tag === HostComponent && fiber.stateNode instanceof HTMLElement) {
      // DOM element — add it (no need to recurse, it visually contains its children)
      elements.push(fiber.stateNode)
    } else {
      // Component, fragment, or other non-DOM fiber — recurse into children
      collectDOMElements(fiber.child, elements)
    }
    fiber = fiber.sibling
  }
}

function isComponentFiber(fiber: any): boolean {
  return COMPONENT_TAGS.has(fiber.tag)
}

function walkFiberChildren(fiber: any, hideLibrary: boolean, hideProviders: boolean): NormalizedNode[] {
  const nodes: NormalizedNode[] = []
  let child = fiber.child

  while (child) {
    if (isComponentFiber(child)) {
      const name = getComponentName(child)
      // Skip devtools own components
      if (name.startsWith('__DevTools')) {
        // skip entirely
      } else if (hideLibrary && isFromNodeModules(child)) {
        // Hide library components — re-parent their children to this level
        nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders))
      } else if (hideProviders && name.endsWith('Provider') && !getOverrides().alwaysShow.includes(name)) {
        // Hide provider wrappers — re-parent their children
        nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders))
      } else {
        const locations = getSourceLocations(child)
        const node: NormalizedNode = {
          id: `fiber_${nodeIdCounter++}`,
          name,
          source: locations.source,
          usageSource: locations.usageSource ?? undefined,
          props: getProps(child),
          hooks: getHooks(child),
          state: getState(child),
          children: walkFiberChildren(child, hideLibrary, hideProviders),
          isFromNodeModules: isFromNodeModules(child),
          _domElements: findDOMElements(child),
        }
        nodes.push(node)
      }
    } else {
      // Not a component fiber — skip it but walk its children
      nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders))
    }
    child = child.sibling
  }

  return nodes
}

export function walkFiberTree(rootFiber: any, hideLibrary = false, hideProviders = false): NormalizedNode[] {
  nodeIdCounter = 0
  return walkFiberChildren(rootFiber, hideLibrary, hideProviders)
}

