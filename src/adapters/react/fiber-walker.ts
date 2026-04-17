import type {
  NormalizedNode,
  InspectorSection,
  InspectorItem,
  CommitRecord,
  CommitComponentEntry,
  RenderCause,
} from '../../core/types'
import { computeRenderCause, isComponentFiber as isCauseComponentFiber } from './render-cause'
import { getPersistentId } from './persistent-id'
import { safeStringify, prettyStringify } from '../../shared/preview-value'

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
 * Count how many fibers with the same component name appear before `target`
 * in a DFS walk of `parentFiber`'s subtree. Stops at user component boundaries
 * (those with __devtools_source) since their JSX is in their own file's usage map.
 */
function countSameNameBefore(target: any, parentFiber: any, componentName: string): number {
  let count = 0
  function walk(f: any): boolean {
    let child = f.child
    while (child) {
      if (child === target) return true
      if (COMPONENT_TAGS.has(child.tag) && getComponentName(child) === componentName) {
        count++
      }
      // Don't recurse into other user components — their JSX is in their own file
      const hasSource = child.type?.__devtools_source || child.elementType?.__devtools_source
      if (COMPONENT_TAGS.has(child.tag) && hasSource) {
        // skip subtree
      } else {
        if (walk(child)) return true
      }
      child = child.sibling
    }
    return false
  }
  walk(parentFiber)
  return count
}

/**
 * Look up usage-site source from the compile-time usage map (__DEVTOOLS_USAGE_MAP__).
 * Walks up the fiber tree to find the parent component's file, then looks up
 * the current component name in that file's usage map.
 * For multi-usage components, disambiguates by counting same-name fibers in DFS order.
 * Populated by the Vite transform for React 19+ (where _debugSource is unavailable).
 */
function lookupUsageMapEntry(fiber: any): { line: number; col: number; propOrigins?: Record<string, any>; filePath: string } | null {
  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  const componentName = getComponentName(fiber)

  // Walk up fiber tree — skip library components (no __devtools_source) until
  // we find an ancestor whose file has a matching usage entry
  let parent = fiber.return
  while (parent) {
    if (COMPONENT_TAGS.has(parent.tag)) {
      const parentFile = parent.type?.__devtools_source?.fileName ?? parent.elementType?.__devtools_source?.fileName
      if (parentFile) {
        for (const [filePath, fileUsages] of Object.entries(map)) {
          if (!parentFile.endsWith(filePath)) continue

          const locations = (fileUsages as any)[componentName]
          if (locations && locations.length > 0) {
            if (locations.length === 1) return { ...locations[0], filePath }
            // Multiple usages — pick by position among same-name descendants
            const index = countSameNameBefore(fiber, parent, componentName)
            return { ...locations[Math.min(index, locations.length - 1)], filePath }
          }
        }
      }
    }
    parent = parent.return
  }

  return null
}

function parseUsageSourceFromMap(fiber: any): { fileName: string; lineNumber: number; columnNumber: number } | null {
  const entry = lookupUsageMapEntry(fiber)
  if (!entry) return null
  return {
    fileName: entry.filePath.startsWith('/') ? entry.filePath : `/${entry.filePath}`,
    lineNumber: entry.line,
    columnNumber: entry.col,
  }
}

function getPropOriginsFromMap(fiber: any): Record<string, any> | undefined {
  const entry = lookupUsageMapEntry(fiber)
  return entry?.propOrigins
}

/**
 * Get the React-provided usage-site source (where component is rendered in parent JSX).
 * Returns from _debugSource (React 18) or compile-time usage map (React 19+).
 */
function getReactSource(fiber: any) {
  if (fiber._debugSource) {
    return {
      fileName: fiber._debugSource.fileName,
      lineNumber: fiber._debugSource.lineNumber ?? 1,
      columnNumber: fiber._debugSource.columnNumber ?? 1,
    }
  }

  // Compile-time usage map — correct original-source line numbers
  const mapSource = parseUsageSourceFromMap(fiber)
  if (mapSource) return mapSource

  return null
}

/**
 * Parse source locations from fiber.
 * Returns both definition-site and usage-site when available.
 * - source: __devtools_source (definition) if available, else React source (usage)
 * - usageSource: React source (usage) only when __devtools_source was used as primary
 */
function getSourceLocations(fiber: any): { source: ReturnType<typeof getReactSource>, usageSource: ReturnType<typeof getReactSource> } {
  const definitionSource = fiber.type?.__devtools_source ?? fiber.elementType?.__devtools_source ?? null
  const reactSource = getReactSource(fiber)

  if (definitionSource) {
    return { source: definitionSource, usageSource: reactSource }
  }
  return { source: reactSource, usageSource: null }
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
export function inferHookType(hook: any): { name: string; value: unknown } {
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

  // Fallback: unknown hook type. The raw memoizedState may contain circular
  // references (e.g. effect objects with .next linked lists), so we must not
  // return it directly — it would crash JSON.stringify in the MCP bridge.
  if (memoizedState !== null && typeof memoizedState === 'object') {
    // Check for circular-prone structures (effect-like objects with .next)
    if ('next' in memoizedState) {
      return { name: 'hook', value: '[internal hook state]' }
    }
    try {
      // Quick serialization check — if it can't be stringified, use a placeholder
      JSON.stringify(memoizedState)
    } catch {
      return { name: 'hook', value: '[complex hook state]' }
    }
  }
  return { name: 'hook', value: memoizedState }
}

/** Compact metadata format injected at build time */
interface MetaHook {
  n: string | null  // varName
  h: string         // hookName
  l: number         // line
  d?: string[]      // depNames
  i?: MetaHook[]    // innerHooks
  f?: string        // sourceFile
}

interface DevtoolsMeta {
  hooks: MetaHook[]
  locals?: Array<{ n: string; l: number }>
}

/**
 * Collect all hooks from the fiber's memoizedState linked list into an array.
 */
function collectHookList(fiber: any): any[] {
  const hooks: any[] = []
  let hook = fiber.memoizedState
  while (hook !== null && hook !== undefined) {
    hooks.push(hook)
    hook = hook.next
  }
  return hooks
}

/**
 * Build InspectorItem[] from hook metadata, consuming hooks from the flat list.
 * When a custom hook has innerHooks, it groups consecutive hooks from the flat list
 * and nests them under the custom hook item.
 */
function buildHookItems(
  metaHooks: MetaHook[],
  flatHooks: any[],
  startIndex: { value: number },
): InspectorItem[] {
  const items: InspectorItem[] = []

  for (const meta of metaHooks) {
    if (meta.i && meta.i.length > 0) {
      // Custom hook with inner hooks — consume inner hooks from the flat list
      const innerItems = buildHookItems(meta.i, flatHooks, startIndex)
      items.push({
        key: meta.n ?? meta.h,
        value: null,
        editable: false,
        persistable: false,
        badge: meta.h,
        lineNumber: meta.l,
        innerHooks: innerItems,
        sourceFile: meta.f,
      })
    } else {
      // Leaf hook — consume one from the flat list
      const hook = flatHooks[startIndex.value]
      const hookIndex = startIndex.value
      startIndex.value++

      if (!hook) {
        // Hook metadata doesn't match runtime — skip gracefully
        items.push({
          key: meta.n ?? meta.h,
          value: '[unavailable]',
          editable: false,
          persistable: false,
          badge: meta.h,
          lineNumber: meta.l,
        })
        continue
      }

      const inferred = inferHookType(hook)

      const editable =
        (inferred.name === 'useState' && typeof inferred.value !== 'function' && typeof hook.queue?.dispatch === 'function') ||
        inferred.name === 'useRef'

      const persistable = inferred.name === 'useState' && editable

      // Prefer metadata hook type over inferred (inferred can miss React 19 effect structure)
      const hookName = inferred.name !== 'hook' ? inferred.name : (meta.h ?? 'hook')
      const value = inferred.name !== 'hook' ? inferred.value : undefined

      const item: InspectorItem = {
        key: meta.n ?? hookName,
        value,
        editable,
        persistable,
        editHint: editable ? {
          kind: 'react-hook',
          hookIndex,
          hookType: hookName as 'useState' | 'useRef',
        } : undefined,
        badge: meta.n ? hookName : undefined,
        lineNumber: meta.l,
      }

      // Attach dep names for effect/memo/callback hooks
      if (meta.d) {
        item.depNames = meta.d
        // Extract current dep values from hook state
        if (inferred.name === 'useEffect' || inferred.name === 'useLayoutEffect' || inferred.name === 'useInsertionEffect') {
          const effect = hook.memoizedState
          if (effect?.deps) item.depValues = effect.deps
        } else if (inferred.name === 'useMemo' || inferred.name === 'useCallback') {
          const ms = hook.memoizedState
          if (Array.isArray(ms) && ms.length === 2 && Array.isArray(ms[1])) {
            item.depValues = ms[1]
          }
        }
      }

      if (meta.f) item.sourceFile = meta.f

      items.push(item)
    }
  }

  return items
}

function getHooksSection(fiber: any): InspectorSection | null {
  // Only function components have hooks in memoizedState as linked list
  if (fiber.tag !== FunctionComponent && fiber.tag !== SimpleMemoComponent && fiber.tag !== MemoComponent) return null

  // For memo() components, __devtools_meta is on the memo wrapper (elementType), not the inner function (type)
  const meta: DevtoolsMeta | undefined = fiber.type?.__devtools_meta ?? fiber.elementType?.__devtools_meta
  const flatHooks = collectHookList(fiber)
  if (flatHooks.length === 0) return null

  let items: InspectorItem[]

  if (meta?.hooks && meta.hooks.length > 0) {
    // New path: use __devtools_meta for nested tree with dep info
    const indexRef = { value: 0 }
    items = buildHookItems(meta.hooks, flatHooks, indexRef)

    // If there are remaining unmatched hooks (metadata doesn't cover all), add them
    while (indexRef.value < flatHooks.length) {
      const hook = flatHooks[indexRef.value]
      const inferred = inferHookType(hook)
      const hookIndex = indexRef.value
      indexRef.value++

      const editable =
        (inferred.name === 'useState' && typeof inferred.value !== 'function' && typeof hook.queue?.dispatch === 'function') ||
        inferred.name === 'useRef'

      items.push({
        key: inferred.name,
        value: inferred.value,
        editable,
        persistable: inferred.name === 'useState' && editable,
        editHint: editable ? { kind: 'react-hook', hookIndex, hookType: inferred.name as 'useState' | 'useRef' } : undefined,
      })
    }
  } else {
    // Legacy path: __devtools_hooks or no metadata
    const rawHookData: unknown[] | undefined = fiber.type?.__devtools_hooks
    items = []
    let hookIndex = 0

    for (const hook of flatHooks) {
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
    }
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

export interface RenderCauseOptions {
  enabled: boolean
  commitIndex: number
  includeValues: boolean
  /** Output collector — filled in-place with component entries for the current commit */
  entries: CommitComponentEntry[]
}

function attachRenderCause(
  node: NormalizedNode,
  fiber: any,
  opts: RenderCauseOptions,
): void {
  if (!opts.enabled) return
  if (!isCauseComponentFiber(fiber)) return

  const cause: RenderCause = computeRenderCause(fiber, opts.commitIndex)
  node.persistentId = getPersistentId(fiber)
  node.renderCause = cause

  // Don't push bailouts into the commit record — they didn't re-render.
  if (cause.primary === 'bailout') return

  const entry: CommitComponentEntry = {
    persistentId: node.persistentId,
    name: node.name,
    source: node.source,
    cause: cause.primary,
    contributors: cause.contributors,
    changedProps: cause.changedProps,
    changedHooks: cause.changedHooks,
    changedContexts: cause.changedContexts,
    effectChanges: cause.effectChanges,
  }

  if (opts.includeValues && cause.changedProps && cause.changedProps.length > 0) {
    const prevProps = fiber.alternate?.memoizedProps ?? {}
    const nextProps = fiber.memoizedProps ?? {}
    const previousValues: Record<string, string> = {}
    const nextValues: Record<string, string> = {}
    const fullPrev: Record<string, string> = {}
    const fullNext: Record<string, string> = {}
    for (const key of cause.changedProps) {
      previousValues[key] = safeStringify(prevProps[key])
      nextValues[key] = safeStringify(nextProps[key])
      fullPrev[key] = prettyStringify(prevProps[key])
      fullNext[key] = prettyStringify(nextProps[key])
    }
    entry.previousValues = previousValues
    entry.nextValues = nextValues
    entry.fullPreviousValues = fullPrev
    entry.fullNextValues = fullNext
  }

  if (opts.includeValues && cause.changedHooks && cause.changedHooks.length > 0) {
    const changedIndices = new Set(cause.changedHooks.map((h) => h.index))
    const previousHookValues: Record<string, string> = {}
    const nextHookValues: Record<string, string> = {}
    const fullPrevHook: Record<string, string> = {}
    const fullNextHook: Record<string, string> = {}
    let prevHook = fiber.alternate?.memoizedState
    let nextHook = fiber.memoizedState
    let idx = 0
    while (prevHook && nextHook) {
      if (changedIndices.has(idx)) {
        const hookEntry: import('../../core/types').ChangedHook = cause.changedHooks.find((ch) => ch.index === idx)!
        const key = hookEntry.varName ? `${hookEntry.varName} (${hookEntry.hookName})` : `${hookEntry.hookName} #${idx}`
        const prevInferred = inferHookType(prevHook)
        const nextInferred = inferHookType(nextHook)
        previousHookValues[key] = safeStringify(prevInferred.value)
        nextHookValues[key] = safeStringify(nextInferred.value)
        fullPrevHook[key] = prettyStringify(prevInferred.value)
        fullNextHook[key] = prettyStringify(nextInferred.value)
      }
      prevHook = prevHook.next
      nextHook = nextHook.next
      idx++
    }
    entry.previousHookValues = previousHookValues
    entry.nextHookValues = nextHookValues
    entry.fullPreviousHookValues = fullPrevHook
    entry.fullNextHookValues = fullNextHook
  }

  opts.entries.push(entry)
}

function walkFiberChildren(
  fiber: any,
  hideLibrary: boolean,
  hideProviders: boolean,
  parentUsageSource?: import('../../core/types').SourceLocation,
  causeOpts?: RenderCauseOptions,
): NormalizedNode[] {
  const nodes: NormalizedNode[] = []
  let child = fiber.child

  while (child) {
    if (isComponentFiber(child)) {
      const name = getComponentName(child)
      if (name.startsWith('__DevTools')) {
        // skip devtools own components
      } else if (hideLibrary && isFromNodeModules(child)) {
        nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource, causeOpts))
      } else if (hideProviders && name.endsWith('Provider')) {
        nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource, causeOpts))
      } else {
        const locations = getSourceLocations(child)
        const componentSource = locations.usageSource ?? locations.source
        const children = walkFiberChildren(child, hideLibrary, hideProviders, componentSource ?? undefined, causeOpts)

        const { texts, fibers: textFibers } = collectDirectText(child)

        const sections: InspectorSection[] = []
        const hooksSection = getHooksSection(child)
        if (hooksSection) sections.push(hooksSection)
        const stateSection = getStateSection(child)
        if (stateSection) sections.push(stateSection)

        // Extract local variables from __devtools_meta (check elementType for memo() components)
        const metaLocals = (child.type?.__devtools_meta?.locals ?? child.elementType?.__devtools_meta?.locals) as Array<{ n: string; l: number }> | undefined
        const locals = metaLocals?.map((l: { n: string; l: number }) => ({ name: l.n, line: l.l }))

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
          locals: locals && locals.length > 0 ? locals : undefined,
          propOrigins: getPropOriginsFromMap(child),
        }
        fiberRefMap.set(node.id, child)
        if (causeOpts) attachRenderCause(node, child, causeOpts)
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
        children: walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource, causeOpts),
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
      nodes.push(...walkFiberChildren(child, hideLibrary, hideProviders, parentUsageSource, causeOpts))
    }
    child = child.sibling
  }

  return nodes
}


export interface WalkOptions {
  hideLibrary?: boolean
  hideProviders?: boolean
  /** When set, computes per-fiber render cause and collects a CommitRecord. */
  renderCause?: {
    commitIndex: number
    includeValues: boolean
  }
}

export interface WalkResult {
  tree: NormalizedNode[]
  commit: CommitRecord | null
}

export function walkFiberTree(rootFiber: any, hideLibrary = false, hideProviders = false): NormalizedNode[] {
  nodeIdCounter = 0
  fiberRefMap.clear()
  return walkFiberChildren(rootFiber, hideLibrary, hideProviders)
}

/** Extended walker that also computes render causes and returns the commit record. */
export function walkFiberTreeWithCauses(rootFiber: any, options: WalkOptions = {}): WalkResult {
  nodeIdCounter = 0
  fiberRefMap.clear()
  let causeOpts: RenderCauseOptions | undefined
  let commit: CommitRecord | null = null
  if (options.renderCause) {
    const entries: CommitComponentEntry[] = []
    causeOpts = {
      enabled: true,
      commitIndex: options.renderCause.commitIndex,
      includeValues: options.renderCause.includeValues,
      entries,
    }
    commit = {
      commitIndex: options.renderCause.commitIndex,
      timestampMs: Date.now(),
      components: entries,
    }
  }
  const tree = walkFiberChildren(
    rootFiber,
    options.hideLibrary ?? false,
    options.hideProviders ?? false,
    undefined,
    causeOpts,
  )
  return { tree, commit }
}
