import type { NormalizedNode, SourceLocation, CommitComponentEntry, CommitRecord } from '../../core/types'
import { extractSections, vueReplacer } from './state-extractor'
import { flushTriggers, setLastRenderedCommit, getLastRenderedCommit } from './render-cause'

// Vue 3 ShapeFlags (bitmask)
const ELEMENT = 1
const FUNCTIONAL_COMPONENT = 2
const STATEFUL_COMPONENT = 4
const ARRAY_CHILDREN = 16
const TELEPORT = 64
const SUSPENSE = 128
const COMPONENT = STATEFUL_COMPONENT | FUNCTIONAL_COMPONENT

let nodeIdCounter = 0

/** Maps node IDs to live component instances — rebuilt on every tree walk */
export const instanceRefMap = new Map<string, any>()

/** Maps node IDs to live DOM elements for host element edits — rebuilt on every tree walk */
export const hostElementRefMap = new Map<string, HTMLElement>()

/**
 * Vue lookups need suffix matching: map keys are project-relative paths (e.g. "/src/Foo.vue"),
 * but instance.type.__file from @vitejs/plugin-vue is absolute. The previous implementation
 * scanned every map entry on every lookup — O(N) per call, with N = total source files.
 *
 * This helper builds a basename-keyed bucket index on first access and caches it per map
 * reference. HMR replaces globalThis.__DEVTOOLS_USAGE_MAP__ wholesale, so the WeakMap entry
 * for the old object goes away with it and the new map gets a fresh index.
 */
type IndexedBucket<T> = Array<{ filePath: string; value: T }>
const mapIndexCache = new WeakMap<object, Map<string, IndexedBucket<any>>>()

function getMapIndex<T>(map: Record<string, T>): Map<string, IndexedBucket<T>> {
  let idx = mapIndexCache.get(map) as Map<string, IndexedBucket<T>> | undefined
  if (idx) return idx
  idx = new Map()
  for (const [filePath, value] of Object.entries(map)) {
    const basename = filePath.split('/').pop() ?? filePath
    let bucket = idx.get(basename)
    if (!bucket) idx.set(basename, (bucket = []))
    bucket.push({ filePath, value })
  }
  mapIndexCache.set(map, idx)
  return idx
}

function findEntryByFile<T>(file: string, map: Record<string, T>): { filePath: string; value: T } | null {
  const basename = file.split('/').pop() ?? file
  const bucket = getMapIndex(map).get(basename)
  if (!bucket) return null
  for (const entry of bucket) {
    if (file.endsWith(entry.filePath)) return entry
  }
  return null
}

function getComponentName(instance: any): string {
  const type = instance.type
  if (!type) return 'Unknown'

  // SFC components have __name from plugin-vue
  if (type.__name) return type.__name
  if (type.name) return type.name
  if (type.displayName) return type.displayName

  // Infer from __file
  if (type.__file) {
    const match = type.__file.match(/([^/\\]+)\.vue$/)
    if (match) return match[1]
  }

  return 'Anonymous'
}

/**
 * Resolve the usage-site source location for a component instance.
 * Looks up the parent file's component usage map (populated at module-load time
 * by the devtools transform) to find where this component is rendered.
 * This avoids Vue's attribute fallthrough which corrupts prop-based approaches
 * when a component is the root element of another component.
 */
interface UsageInfo {
  source: SourceLocation
  dynamicProps?: string[]
}

function parseUsageSource(instance: any): UsageInfo | null {
  const parentFile = instance.parent?.type?.__file
  if (!parentFile) return null

  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  const entry = findEntryByFile<Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>>>(parentFile, map)
  if (!entry) return null

  const componentName = getComponentName(instance)
  const normalized = componentName.toLowerCase().replace(/-/g, '')

  for (const [tagName, locations] of Object.entries(entry.value)) {
    if (tagName.toLowerCase().replace(/-/g, '') === normalized && locations.length > 0) {
      return {
        source: {
          fileName: entry.filePath.startsWith('/') ? entry.filePath : `/${entry.filePath}`,
          lineNumber: locations[0].line,
          columnNumber: locations[0].col,
        },
        dynamicProps: locations[0].dynamicProps,
      }
    }
  }

  return null
}

/**
 * Definition-site source from instance.type.__file (set by @vitejs/plugin-vue).
 * Points to the component's own .vue file.
 */
function getDefinitionSource(instance: any): SourceLocation | null {
  const file = instance.type?.__file
  if (!file) return null
  // Read end line from global map injected by Vue adapter transform (keys are relative paths)
  const endLineMap = (globalThis as any).__DEVTOOLS_END_LINES__ as Record<string, number> | undefined
  const endLineNumber = endLineMap ? findEntryByFile<number>(file, endLineMap)?.value : undefined
  return { fileName: file, lineNumber: 1, columnNumber: 1, endLineNumber }
}

function isFromNodeModules(instance: any): boolean {
  const file = instance.type?.__file
  if (!file) return true // No file info = likely a library component
  return file.includes('node_modules') || file.includes('.vite/deps/')
}

interface SlotInfo {
  parentFile: string
  componentName: string
  slotName: string
  slotCounters: Map<string, number>
  slotSource: SourceLocation | null
}

export interface VueWalkOptions {
  hideLibrary?: boolean
  renderCause?: {
    commitIndex: number
    includeValues: boolean
    updatedUids: Set<number>
  }
}

export interface VueWalkResult {
  tree: NormalizedNode[]
  commit: CommitRecord | null
}

interface RenderCauseOpts {
  commitIndex: number
  includeValues: boolean
  updatedUids: Set<number>
  entries: CommitComponentEntry[]
}

interface WalkContext {
  parentFile: string | null
  elementCounters: Map<string, number>
  parentUsageSource?: SourceLocation
  /** The component instance whose subTree we're currently walking */
  currentInstance?: any
  /** Slot element counters shared across slot Fragments within a parent scope */
  parentSlotCounters?: Map<string, number>
  /** The parent component's __file — where slot content was authored */
  parentComponentFile?: string | null
  /** Active slot context when walking inside a slot Fragment */
  slotInfo?: SlotInfo
  /** Render cause tracking options — present when attribution is enabled */
  renderCauseOpts?: RenderCauseOpts
  /** Parent component name for prop source matching */
  parentComponentName?: string
  /** Parent component node ID for prop source matching */
  parentComponentId?: string
}

/**
 * Resolve source location for an HTML element vnode from __DEVTOOLS_USAGE_MAP__.
 * Uses order-based counter per tag name, clamped for v-for duplicates.
 */
function getElementSource(tagName: string, ctx: WalkContext): SourceLocation | null {
  if (!ctx.parentFile) return null

  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  const entry = findEntryByFile<Record<string, Array<{ line: number; col: number }>>>(ctx.parentFile, map)
  if (!entry) return null

  const locations = entry.value[tagName]
  if (!locations || locations.length === 0) return null

  const index = ctx.elementCounters.get(tagName) ?? 0
  ctx.elementCounters.set(tagName, index + 1)

  // Clamp to array length for v-for duplicates
  const clampedIndex = Math.min(index, locations.length - 1)
  const loc = locations[clampedIndex]

  return {
    fileName: entry.filePath.startsWith('/') ? entry.filePath : `/${entry.filePath}`,
    lineNumber: loc.line,
    columnNumber: loc.col,
  }
}

/**
 * Resolve source location for a slot content element from __DEVTOOLS_USAGE_MAP__.__slots__.
 * Uses the slot-specific counter keyed by "componentName:slotName:tagName".
 */
function getSlotElementSource(tagName: string, slotInfo: SlotInfo): SourceLocation | null {
  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  const entry = findEntryByFile<any>(slotInfo.parentFile, map)
  if (!entry) return null

  const slots = entry.value.__slots__
  if (!slots) return null

  const normalized = slotInfo.componentName.toLowerCase().replace(/-/g, '')

  // Find the component entry using normalized name matching
  let componentSlots: any = null
  for (const key of Object.keys(slots)) {
    if (key.toLowerCase().replace(/-/g, '') === normalized) {
      componentSlots = slots[key]
      break
    }
  }
  if (!componentSlots) return null

  const slotGroup = componentSlots[slotInfo.slotName]
  if (!slotGroup) return null

  const locations = slotGroup[tagName]
  if (!locations || locations.length === 0) return null

  const counterKey = `${normalized}:${slotInfo.slotName}:${tagName}`
  const index = slotInfo.slotCounters.get(counterKey) ?? 0
  slotInfo.slotCounters.set(counterKey, index + 1)

  const clampedIndex = Math.min(index, locations.length - 1)
  const loc = locations[clampedIndex]

  return {
    fileName: entry.filePath.startsWith('/') ? entry.filePath : `/${entry.filePath}`,
    lineNumber: loc.line,
    columnNumber: loc.col,
  }
}

/**
 * Resolve the <slot /> definition source from __DEVTOOLS_USAGE_MAP__.__slotDefs__.
 */
function getSlotDefinitionSource(componentFile: string | null, slotName: string): SourceLocation | null {
  if (!componentFile) return null

  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  const entry = findEntryByFile<any>(componentFile, map)
  if (!entry) return null

  const slotDefs = entry.value.__slotDefs__
  if (!slotDefs || !slotDefs[slotName]) return null

  const loc = slotDefs[slotName]
  return {
    fileName: entry.filePath.startsWith('/') ? entry.filePath : `/${entry.filePath}`,
    lineNumber: loc.line,
    columnNumber: loc.col,
  }
}

const VUE_HOST_SKIP_KEYS = new Set(['children', 'key', 'ref', 'ref_for', 'ref_key'])

function getHostElementProps(vnodeProps: any): Record<string, unknown> {
  if (!vnodeProps || typeof vnodeProps !== 'object') return {}

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(vnodeProps)) {
    if (VUE_HOST_SKIP_KEYS.has(key)) continue
    const value = vnodeProps[key]
    if (typeof value === 'function') {
      result[key] = 'fn()'
    } else if (key === 'style' && typeof value === 'object' && value !== null) {
      try { result[key] = JSON.parse(JSON.stringify(value, vueReplacer)) }
      catch { result[key] = '[Style]' }
    } else if (typeof value === 'object' && value !== null) {
      if ((value as any).__v_skip === true) { result[key] = '[ComponentInstance]' }
      else { try { result[key] = JSON.parse(JSON.stringify(value, vueReplacer)) } catch { result[key] = '[Object]' } }
    } else {
      result[key] = value
    }
  }
  return result
}

function findPropSource(
  textContent: string | undefined,
  ctx: WalkContext,
): NormalizedNode['propSource'] | undefined {
  if (!textContent || !ctx.currentInstance) return undefined
  const props = ctx.currentInstance.props
  if (!props || typeof props !== 'object') return undefined
  for (const key of Object.keys(props)) {
    if (typeof props[key] === 'string' && props[key] === textContent) {
      return {
        propName: key,
        componentName: ctx.parentComponentName ?? 'Unknown',
        componentId: ctx.parentComponentId ?? '',
      }
    }
  }
  return undefined
}

function getProps(instance: any): Record<string, unknown> {
  const props = instance.props
  if (!props || typeof props !== 'object') return {}

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    const value = props[key]
    if (typeof value === 'function') {
      result[key] = 'fn()'
    } else if (typeof value === 'object' && value !== null) {
      if ((value as any).__v_skip === true) {
        result[key] = '[ComponentInstance]'
      } else {
        try {
          result[key] = JSON.parse(JSON.stringify(value, vueReplacer))
        } catch {
          result[key] = '[Object]'
        }
      }
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Collect DOM elements from a vnode tree.
 * For components, descend into their subTree.
 * For element vnodes, collect the el.
 */
function collectDOMElements(vnode: any, elements: HTMLElement[]): void {
  if (!vnode) return

  if (vnode.shapeFlag & ELEMENT) {
    if (vnode.el instanceof HTMLElement) {
      elements.push(vnode.el)
    }
    return // Don't recurse into element children — the element visually contains them
  }

  // Component — descend into its rendered subTree
  if (vnode.component) {
    collectDOMElements(vnode.component.subTree, elements)
    return
  }

  // Fragment / array children
  if (vnode.shapeFlag & ARRAY_CHILDREN && Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      collectDOMElements(child, elements)
    }
  }
}

function findDOMElements(instance: any): HTMLElement[] {
  const elements: HTMLElement[] = []
  collectDOMElements(instance.subTree, elements)
  return elements
}

/**
 * Get a display name for special vnode types (Fragment, Teleport, Suspense, KeepAlive).
 */
function getSpecialTypeName(vnode: any): string | null {
  const type = vnode.type
  if (typeof type === 'symbol') {
    const desc = type.description ?? String(type)
    if (desc === 'v-fgt' || desc === 'Fragment') return null // skip fragments, re-parent children
    return desc
  }
  if (type && typeof type === 'object') {
    if (type.__isKeepAlive) return 'KeepAlive'
    if (type.__isSuspense) return 'Suspense'
    if (type.__isTeleport) return 'Teleport'
  }
  return null
}

/**
 * Walk static DOM elements (from Vue's hoisted static vnodes).
 * Static vnodes reference real DOM nodes via el/anchor — walk siblings between them.
 */
function walkStaticDOM(el: Node, anchor: Node | null, ctx: WalkContext): NormalizedNode[] {
  const nodes: NormalizedNode[] = []

  // Single element
  if (!anchor && el instanceof HTMLElement) {
    nodes.push(domElementToNode(el, ctx))
    return nodes
  }

  // Multiple siblings: walk from el to anchor
  let current: Node | null = el
  while (current) {
    if (current instanceof HTMLElement) {
      nodes.push(domElementToNode(current, ctx))
    }
    if (current === anchor) break
    current = current.nextSibling
  }

  return nodes
}

function domElementToNode(el: HTMLElement, ctx: WalkContext): NormalizedNode {
  const tagName = el.tagName.toLowerCase()

  // Extract props from DOM attributes
  const props: Record<string, unknown> = {}
  for (const attr of Array.from(el.attributes)) {
    props[attr.name] = attr.value
  }

  // Get text content (only if the element has direct text, not nested elements)
  let textContent: string | undefined
  if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
    const text = el.childNodes[0].textContent?.trim()
    if (text) textContent = text
  }

  // Recurse into child elements
  const children: NormalizedNode[] = []
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement) {
      children.push(domElementToNode(child, ctx))
    }
  }

  const source = getElementSource(tagName, ctx)
  const hostNode: NormalizedNode = {
    id: `vue_${nodeIdCounter++}`,
    name: tagName,
    source,
    _parentSource: !source && ctx.parentUsageSource ? ctx.parentUsageSource : undefined,
    props,
    sections: [],
    children,
    isFromNodeModules: false,
    isHostElement: true,
    _domElements: [el],
    textContent,
    textFragments: textContent ? [textContent] : undefined,
  }
  hostElementRefMap.set(hostNode.id, el)
  return hostNode
}

/**
 * Resolve locals from __DEVTOOLS_COMPOSABLES__ metadata for a component instance.
 */
function resolveLocals(instance: any): Array<{ name: string; line: number }> | undefined {
  const composableMap = (globalThis as any).__DEVTOOLS_COMPOSABLES__
  if (!composableMap) return undefined
  const filePath = instance.type?.__file
  if (!filePath) return undefined

  for (const key of Object.keys(composableMap)) {
    if (filePath.endsWith(key)) {
      const meta = composableMap[key]
      if (meta?.locals?.length) {
        return meta.locals.map((l: any) => ({ name: l.n, line: l.l }))
      }
      return undefined
    }
  }
  return undefined
}

/**
 * Attach render cause and persistent ID to a component node during the walk.
 */
function attachRenderCause(
  node: NormalizedNode,
  instance: any,
  name: string,
  source: SourceLocation | null,
  ctx: WalkContext,
): void {
  const opts = ctx.renderCauseOpts
  if (!opts) return

  const uid = instance.uid
  node.persistentId = uid

  if (opts.updatedUids.has(uid)) {
    const entry = flushTriggers(uid, name, source, uid, instance, opts.includeValues)
    if (entry) {
      node.renderCause = {
        primary: entry.cause,
        contributors: entry.contributors,
        changedProps: entry.changedProps,
        changedHooks: entry.changedHooks,
        changedContexts: entry.changedContexts,
        effectChanges: entry.effectChanges,
        commitIndex: opts.commitIndex,
      }
      setLastRenderedCommit(uid, opts.commitIndex)
      opts.entries.push(entry)
    } else {
      // Updated but no trigger info → parent cause
      node.renderCause = {
        primary: 'parent',
        contributors: ['parent'],
        commitIndex: opts.commitIndex,
      }
      setLastRenderedCommit(uid, opts.commitIndex)
      opts.entries.push({
        persistentId: uid,
        name,
        source,
        cause: 'parent',
        contributors: ['parent'],
      })
    }
  } else {
    // Not updated this commit — show last rendered info if available
    const lastRendered = getLastRenderedCommit(uid)
    if (lastRendered !== undefined) {
      node.renderCause = {
        primary: 'bailout',
        contributors: ['bailout'],
        commitIndex: opts.commitIndex,
        lastRenderedCommit: lastRendered,
      }
    }
  }
}

/**
 * Walk a vnode tree and extract child component NormalizedNodes.
 */
function walkVNodeChildren(vnode: any, hideLibrary: boolean, ctx: WalkContext): NormalizedNode[] {
  if (!vnode) return []

  const nodes: NormalizedNode[] = []

  // Component vnode — this is a child component instance
  if (vnode.component) {
    const instance = vnode.component
    const name = getComponentName(instance)

    // Skip devtools own components
    if (name.startsWith('__DevTools') || name === 'DevToolsPanel') {
      return nodes
    }

    // Fresh context for each component scope
    const source = getDefinitionSource(instance)
    const usage = parseUsageSource(instance)
    const componentNodeId = `vue_${nodeIdCounter++}`
    const childCtx: WalkContext = {
      parentFile: instance.type?.__file ?? null,
      elementCounters: new Map(),
      parentUsageSource: usage?.source ?? source ?? undefined,
      currentInstance: instance,
      parentSlotCounters: new Map(),
      parentComponentFile: ctx.parentFile,
      renderCauseOpts: ctx.renderCauseOpts,
      parentComponentName: name,
      parentComponentId: componentNodeId,
    }

    if (hideLibrary && isFromNodeModules(instance)) {
      // Hide library components — re-parent their children
      nodes.push(...walkVNodeChildren(instance.subTree, hideLibrary, childCtx))
    } else {
      const children = walkVNodeChildren(instance.subTree, hideLibrary, childCtx)

      const node: NormalizedNode = {
        id: componentNodeId,
        name,
        source,
        usageSource: usage?.source ?? undefined,
        dynamicProps: usage?.dynamicProps,
        props: getProps(instance),
        sections: extractSections(instance),
        children,
        isFromNodeModules: isFromNodeModules(instance),
        _domElements: findDOMElements(instance),
        locals: resolveLocals(instance),
      }
      // Error boundary detection (errorCaptured option or onErrorCaptured composition hook)
      if (instance.type?.errorCaptured || instance.ec?.length > 0) {
        node.isErrorBoundary = true
      }
      attachRenderCause(node, instance, name, source, ctx)
      instanceRefMap.set(node.id, instance)
      nodes.push(node)
    }
    return nodes
  }

  // Element vnode — include as host element node
  if (vnode.shapeFlag & ELEMENT && typeof vnode.type === 'string') {
    const tagName = vnode.type

    // Resolve source — prefer slot-aware lookup when inside a slot Fragment
    let source: SourceLocation | null = null
    let slotOwner: NormalizedNode['slotOwner'] | undefined

    if (ctx.slotInfo) {
      source = getSlotElementSource(tagName, ctx.slotInfo)
      if (source && ctx.slotInfo.slotSource) {
        slotOwner = {
          componentName: ctx.slotInfo.componentName,
          source: ctx.slotInfo.slotSource,
        }
      }
    }

    if (!source) {
      source = getElementSource(tagName, ctx)
    }

    let textContent: string | undefined
    if (typeof vnode.children === 'string' && vnode.children.trim() !== '') {
      textContent = vnode.children
    }

    let children: NormalizedNode[] = []
    if (vnode.shapeFlag & ARRAY_CHILDREN && Array.isArray(vnode.children)) {
      for (const child of vnode.children) {
        children.push(...walkVNodeChildren(child, hideLibrary, ctx))
      }
    }

    const hostNode: NormalizedNode = {
      id: `vue_${nodeIdCounter++}`,
      name: tagName,
      source,
      _parentSource: !source && ctx.parentUsageSource ? ctx.parentUsageSource : undefined,
      slotOwner,
      props: getHostElementProps(vnode.props),
      sections: [],
      children,
      isFromNodeModules: false,
      isHostElement: true,
      _domElements: vnode.el instanceof HTMLElement ? [vnode.el] : [],
      textContent,
      textFragments: textContent ? [textContent] : undefined,
      propSource: findPropSource(textContent, ctx),
    }
    if (vnode.el instanceof HTMLElement) {
      hostElementRefMap.set(hostNode.id, vnode.el)
    }
    nodes.push(hostNode)
    return nodes
  }

  // Teleport — show as named node with children
  if (vnode.shapeFlag & TELEPORT) {
    if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) {
        nodes.push(...walkVNodeChildren(child, hideLibrary, ctx))
      }
    }
    return nodes
  }

  // Suspense — walk default slot
  if (vnode.shapeFlag & SUSPENSE) {
    if (vnode.ssContent) {
      nodes.push(...walkVNodeChildren(vnode.ssContent, hideLibrary, ctx))
    } else if (vnode.ssFallback) {
      nodes.push(...walkVNodeChildren(vnode.ssFallback, hideLibrary, ctx))
    }
    return nodes
  }

  // Slot Fragment — renderSlot() creates Fragments with key like "_default", "_header"
  if (typeof vnode.type === 'symbol' &&
      typeof vnode.key === 'string' &&
      vnode.key.startsWith('_') &&
      vnode.shapeFlag & ARRAY_CHILDREN &&
      Array.isArray(vnode.children)) {
    let slotName = vnode.key.slice(1)
    if (slotName.endsWith('_fb')) slotName = slotName.slice(0, -3)

    const instance = ctx.currentInstance
    if (instance?.parent) {
      const parentFile = instance.parent.type?.__file
      const componentName = getComponentName(instance)
      const componentFile = instance.type?.__file

      if (parentFile) {
        const slotSource = getSlotDefinitionSource(componentFile, slotName)
        const slotCtx: WalkContext = {
          ...ctx,
          slotInfo: {
            parentFile,
            componentName,
            slotName,
            slotCounters: ctx.parentSlotCounters ?? new Map(),
            slotSource,
          },
        }
        for (const child of vnode.children) {
          nodes.push(...walkVNodeChildren(child, hideLibrary, slotCtx))
        }
        return nodes
      }
    }
    // Fallback: walk as regular Fragment
    for (const child of vnode.children) {
      nodes.push(...walkVNodeChildren(child, hideLibrary, ctx))
    }
    return nodes
  }

  // Fragment / array children
  if (vnode.shapeFlag & ARRAY_CHILDREN && Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      nodes.push(...walkVNodeChildren(child, hideLibrary, ctx))
    }
    return nodes
  }

  // Static content — Vue's compiler hoists entirely-static DOM into Symbol(v-stc) vnodes.
  // These have shapeFlag=0 and children is an HTML string. Walk the actual DOM elements.
  if (typeof vnode.type === 'symbol' && vnode.el) {
    const desc = vnode.type.description ?? String(vnode.type)
    if (desc === 'v-stc' || desc === 'Static') {
      nodes.push(...walkStaticDOM(vnode.el, vnode.anchor, ctx))
      return nodes
    }
  }

  return nodes
}

/**
 * Walk the Vue component tree starting from the app's root instance.
 */
export function walkInstanceTree(appInstance: any, options: VueWalkOptions = {}): VueWalkResult {
  nodeIdCounter = 0
  instanceRefMap.clear()
  hostElementRefMap.clear()

  if (!appInstance) return { tree: [], commit: null }

  const hideLibrary = options.hideLibrary ?? false
  const renderCauseOpts: RenderCauseOpts | undefined = options.renderCause
    ? { ...options.renderCause, entries: [] }
    : undefined

  const rootName = getComponentName(appInstance)
  const source = getDefinitionSource(appInstance)
  const usage = parseUsageSource(appInstance)
  const rootNodeId = `vue_${nodeIdCounter++}`
  const rootCtx: WalkContext = {
    parentFile: appInstance.type?.__file ?? null,
    elementCounters: new Map(),
    parentUsageSource: usage?.source ?? source ?? undefined,
    currentInstance: appInstance,
    parentSlotCounters: new Map(),
    renderCauseOpts,
    parentComponentName: rootName,
    parentComponentId: rootNodeId,
  }
  const children = walkVNodeChildren(appInstance.subTree, hideLibrary, rootCtx)

  const rootNode: NormalizedNode = {
    id: rootNodeId,
    name: rootName,
    source,
    usageSource: usage?.source ?? undefined,
    dynamicProps: usage?.dynamicProps,
    props: getProps(appInstance),
    sections: extractSections(appInstance),
    children,
    isFromNodeModules: isFromNodeModules(appInstance),
    _domElements: findDOMElements(appInstance),
    locals: resolveLocals(appInstance),
  }
  attachRenderCause(rootNode, appInstance, rootName, source, rootCtx)
  instanceRefMap.set(rootNode.id, appInstance)

  const commit: CommitRecord | null = renderCauseOpts && renderCauseOpts.entries.length > 0
    ? { commitIndex: renderCauseOpts.commitIndex, timestampMs: Date.now(), components: renderCauseOpts.entries }
    : null

  return { tree: [rootNode], commit }
}
