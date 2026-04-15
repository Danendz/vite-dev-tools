import type { NormalizedNode, InspectorSection, InspectorItem } from '../../core/types'

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

/** Maps node IDs to live fiber references — rebuilt on every tree walk */
export const fiberRefMap = new Map<string, any>()

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
 * Look up usage-site source from the compile-time usage map (__DEVTOOLS_USAGE_MAP__).
 * Walks up the fiber tree to find the parent component's file, then looks up
 * the current component name in that file's usage map.
 * Populated by the Vite transform for React 19+ (where _debugSource is unavailable).
 */
function parseUsageSourceFromMap(fiber: any): { fileName: string; lineNumber: number; columnNumber: number } | null {
  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  const componentName = getComponentName(fiber)

  // Walk up fiber tree — skip library components (no __devtools_source) until
  // we find an ancestor whose file has a matching usage entry
  let parent = fiber.return
  while (parent) {
    if (COMPONENT_TAGS.has(parent.tag)) {
      const parentFile = parent.type?.__devtools_source?.fileName
      if (parentFile) {
        for (const [filePath, fileUsages] of Object.entries(map)) {
          if (!parentFile.endsWith(filePath)) continue

          const locations = (fileUsages as any)[componentName]
          if (locations && locations.length > 0) {
            return {
              fileName: filePath.startsWith('/') ? filePath : `/${filePath}`,
              lineNumber: locations[0].line,
              columnNumber: locations[0].col,
            }
          }
        }
      }
    }
    parent = parent.return
  }

  return null
}

/**
 * Get the React-provided usage-site source (where component is rendered in parent JSX).
 * Returns from _debugSource (React 18), compile-time usage map, or _debugStack (React 19+).
 */
function getReactSource(fiber: any) {
  if (fiber._debugSource) {
    return {
      fileName: fiber._debugSource.fileName,
      lineNumber: fiber._debugSource.lineNumber ?? 1,
      columnNumber: fiber._debugSource.columnNumber ?? 1,
    }
  }

  // Try compile-time usage map (accurate source positions for React 19+)
  const mapSource = parseUsageSourceFromMap(fiber)
  if (mapSource) return mapSource

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

type ParsedStack = { fileName: string; lineNumber: number; columnNumber: number } | null

// Cache parsed stack results to avoid re-parsing the same stack
const stackCache = new WeakMap<object, ParsedStack>()

function parseDebugStack(stack: Error | string): ParsedStack {
  const stackObj = typeof stack === 'string' ? null : stack
  if (stackObj && stackCache.has(stackObj)) {
    return stackCache.get(stackObj)!
  }

  const stackStr = typeof stack === 'string' ? stack : stack.stack
  if (!stackStr) return null

  // Parse stack frames — look for the first frame that points to user source code
  const lines = stackStr.split('\n')
  for (const line of lines) {
    if (!line.includes('at ')) continue
    if (line.includes('node_modules/')) continue
    if (line.includes('.vite/deps/')) continue
    if (line.includes('.vite/')) continue
    if (line.includes('react-stack-top-frame')) continue
    if (line.includes('chunk-')) continue

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

function getHooksSection(fiber: any): InspectorSection | null {
  // Only function components have hooks in memoizedState as linked list
  if (fiber.tag !== FunctionComponent) return null

  const items: InspectorItem[] = []
  const rawHookData: unknown[] | undefined = fiber.type?.__devtools_hooks
  let hookIndex = 0
  let hook = fiber.memoizedState
  while (hook !== null && hook !== undefined) {
    const inferred = inferHookType(hook)
    const entry = rawHookData?.[hookIndex]

    let varName: string | undefined
    let lineNumber: number | undefined

    if (Array.isArray(entry)) {
      varName = entry[0] ?? undefined
      lineNumber = entry[1]
    } else if (typeof entry === 'string') {
      varName = entry
    }

    const editable =
      (inferred.name === 'useState' && typeof inferred.value !== 'function' && typeof hook.queue?.dispatch === 'function') ||
      inferred.name === 'useRef'

    const persistable = inferred.name === 'useState' && editable

    items.push({
      key: varName ?? inferred.name,
      value: inferred.value,
      editable,
      persistable,
      editHint: editable ? {
        kind: 'react-hook',
        hookIndex,
        hookType: inferred.name as 'useState' | 'useRef',
      } : undefined,
      badge: varName ? inferred.name : undefined,
      lineNumber,
    })
    hookIndex++
    hook = hook.next
  }

  return items.length > 0 ? { id: 'hooks', label: 'Hooks', items } : null
}

function getStateSection(fiber: any): InspectorSection | null {
  if (fiber.tag !== ClassComponent || !fiber.stateNode?.state) return null

  const state = fiber.stateNode.state
  if (typeof state !== 'object' || state === null) {
    return {
      id: 'state',
      label: 'State',
      items: [{ key: 'state', value: state, editable: false, persistable: false }],
    }
  }

  const items: InspectorItem[] = Object.entries(state).map(([key, value]) => ({
    key,
    value,
    editable: false,
    persistable: false,
  }))

  return items.length > 0 ? { id: 'state', label: 'State', items } : null
}

function getProps(fiber: any): Record<string, unknown> {
  const props = fiber.memoizedProps
  if (!props || typeof props !== 'object') return {}

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (key === 'children') continue
    const value = props[key]
    if (typeof value === 'function') {
      result[key] = `fn()`
    } else if (typeof value === 'object' && value !== null) {
      try {
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

const HOST_SKIP_KEYS = new Set(['children', '__source', '__self', 'key', 'ref'])

function getHostElementProps(fiber: any): Record<string, unknown> {
  const props = fiber.memoizedProps
  if (!props || typeof props !== 'object') return {}

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (HOST_SKIP_KEYS.has(key) || /^\d+$/.test(key)) continue
    const value = props[key]
    if (typeof value === 'function') {
      result[key] = `fn()`
    } else if (key === 'style' && typeof value === 'object' && value !== null) {
      try {
        result[key] = JSON.parse(JSON.stringify(value))
      } catch {
        result[key] = `[Style]`
      }
    } else if (typeof value === 'object' && value !== null) {
      try {
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

/**
 * Get source location for a HostComponent fiber.
 * React 18: _debugSource on host fibers.
 * React 19+: injected __source string prop "fileName:line:col".
 */
function getHostElementSource(fiber: any): ReturnType<typeof getReactSource> {
  if (fiber._debugSource) {
    return {
      fileName: fiber._debugSource.fileName,
      lineNumber: fiber._debugSource.lineNumber ?? 1,
      columnNumber: fiber._debugSource.columnNumber ?? 1,
    }
  }

  const sourceProp = fiber.memoizedProps?.__source
  if (sourceProp) {
    // Clean up __source from DOM — React 19 passes unknown JSX props through
    if (fiber.stateNode instanceof HTMLElement && fiber.stateNode.hasAttribute('__source')) {
      fiber.stateNode.removeAttribute('__source')
    }
    if (typeof sourceProp === 'object' && sourceProp.fileName) {
      return {
        fileName: sourceProp.fileName,
        lineNumber: sourceProp.lineNumber ?? 1,
        columnNumber: sourceProp.columnNumber ?? 1,
      }
    }
    if (typeof sourceProp === 'string') {
      const lastColon = sourceProp.lastIndexOf(':')
      const secondLastColon = sourceProp.lastIndexOf(':', lastColon - 1)
      if (secondLastColon > 0) {
        return {
          fileName: sourceProp.slice(0, secondLastColon),
          lineNumber: parseInt(sourceProp.slice(secondLastColon + 1, lastColon), 10),
          columnNumber: parseInt(sourceProp.slice(lastColon + 1), 10),
        }
      }
    }
  }

  if (fiber._debugStack) {
    return parseDebugStack(fiber._debugStack)
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
      elements.push(fiber.stateNode)
    } else {
      collectDOMElements(fiber.child, elements)
    }
    fiber = fiber.sibling
  }
}

function isComponentFiber(fiber: any): boolean {
  return COMPONENT_TAGS.has(fiber.tag)
}

/**
 * Collect HostText content directly from a component fiber's subtree.
 * Traverses through HostComponents and library components (node_modules),
 * but stops at user component boundaries (they'll collect their own text).
 */
function collectDirectText(fiber: any): { texts: string[]; fibers: any[] } {
  const texts: string[] = []
  const fibers: any[] = []
  let child = fiber.child
  while (child) {
    if (child.tag === 6) {
      const text = typeof child.memoizedProps === 'string' ? child.memoizedProps : ''
      if (text.trim() !== '') {
        texts.push(text)
        fibers.push(child)
      }
    } else if (isComponentFiber(child)) {
      if (isFromNodeModules(child)) {
        const sub = collectDirectText(child)
        texts.push(...sub.texts)
        fibers.push(...sub.fibers)
      }
    } else {
      const sub = collectDirectText(child)
      if (sub.texts.length > 0) {
        texts.push(...sub.texts)
        fibers.push(...sub.fibers)
      } else if (!child.child && child.stateNode) {
        const domText = child.stateNode.textContent
        if (typeof domText === 'string' && domText.trim() !== '') {
          texts.push(domText)
          fibers.push(child)
        }
      }
    }
    child = child.sibling
  }
  return { texts, fibers }
}

/**
 * Collect only immediate HostText children of a fiber (no recursion into nested elements).
 * Also handles React's optimization where single text children are stored as a string
 * in memoizedProps.children instead of creating a HostText fiber.
 */
function collectImmediateText(fiber: any): { texts: string[]; fibers: any[] } {
  const texts: string[] = []
  const fibers: any[] = []
  let child = fiber.child
  while (child) {
    if (child.tag === 6) {
      const text = typeof child.memoizedProps === 'string' ? child.memoizedProps : ''
      if (text.trim() !== '') {
        texts.push(text)
        fibers.push(child)
      }
    }
    child = child.sibling
  }

  // React optimizes single text children — no HostText fiber is created,
  // text is stored directly in memoizedProps.children as a string
  if (texts.length === 0) {
    const children = fiber.memoizedProps?.children
    if (typeof children === 'string' && children.trim() !== '') {
      texts.push(children)
      fibers.push(fiber)
    }
  }

  return { texts, fibers }
}

function walkFiberChildren(fiber: any, hideLibrary: boolean, hideProviders: boolean, parentUsageSource?: import('../../core/types').SourceLocation): NormalizedNode[] {
  const nodes: NormalizedNode[] = []
  let child = fiber.child

  while (child) {
    if (isComponentFiber(child)) {
      const name = getComponentName(child)
      if (name.startsWith('__DevTools')) {
        // skip devtools own components
      } else if (hideLibrary && isFromNodeModules(child)) {
        nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource))
      } else if (hideProviders && name.endsWith('Provider')) {
        nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource))
      } else {
        const locations = getSourceLocations(child)
        const componentSource = locations.usageSource ?? locations.source
        const children = walkFiberChildren(child, hideLibrary, hideProviders, componentSource ?? undefined)

        const { texts, fibers: textFibers } = collectDirectText(child)

        const sections: InspectorSection[] = []
        const hooksSection = getHooksSection(child)
        if (hooksSection) sections.push(hooksSection)
        const stateSection = getStateSection(child)
        if (stateSection) sections.push(stateSection)

        const node: NormalizedNode = {
          id: `fiber_${nodeIdCounter++}`,
          name,
          source: locations.source,
          usageSource: locations.usageSource ?? undefined,
          props: getProps(child),
          sections,
          children,
          isFromNodeModules: isFromNodeModules(child),
          _domElements: findDOMElements(child),
          textContent: texts.join(' ') || undefined,
          textFragments: texts.length > 0 ? texts : undefined,
          _textFibers: textFibers.length > 0 ? textFibers : undefined,
        }
        fiberRefMap.set(node.id, child)
        nodes.push(node)
      }
    } else if (child.tag === HostComponent) {
      // Include host element as a node in the tree
      const tagName = child.stateNode?.tagName?.toLowerCase() ?? (typeof child.type === 'string' ? child.type : 'unknown')
      const { texts, fibers: textFibers } = collectImmediateText(child)
      const hostSource = getHostElementSource(child)

      const hostNode: NormalizedNode = {
        id: `fiber_${nodeIdCounter++}`,
        name: tagName,
        source: hostSource,
        _parentSource: !hostSource && parentUsageSource ? parentUsageSource : undefined,
        props: getHostElementProps(child),
        sections: [],
        children: walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource),
        isFromNodeModules: false,
        isHostElement: true,
        _domElements: child.stateNode instanceof HTMLElement ? [child.stateNode] : [],
        textContent: texts.join(' ') || undefined,
        textFragments: texts.length > 0 ? texts : undefined,
        _textFibers: textFibers.length > 0 ? textFibers : undefined,
      }
      fiberRefMap.set(hostNode.id, child)
      nodes.push(hostNode)
    } else if (child.tag !== 6) {
      nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource))
    }
    child = child.sibling
  }

  return nodes
}


export function walkFiberTree(rootFiber: any, hideLibrary = false, hideProviders = false): NormalizedNode[] {
  nodeIdCounter = 0
  fiberRefMap.clear()
  return walkFiberChildren(rootFiber, hideLibrary, hideProviders)
}
