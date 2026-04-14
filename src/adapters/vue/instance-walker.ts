import type { NormalizedNode, SourceLocation } from '../../core/types'
import { extractSections } from './state-extractor'

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

  const componentName = getComponentName(instance)
  const normalized = componentName.toLowerCase().replace(/-/g, '')

  // Map keys are relative paths; __file is absolute — match via endsWith
  for (const [filePath, fileUsages] of Object.entries(map)) {
    if (!parentFile.endsWith(filePath)) continue

    for (const [tagName, locations] of Object.entries(fileUsages as Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>>)) {
      if (tagName.toLowerCase().replace(/-/g, '') === normalized && locations.length > 0) {
        return {
          source: {
            fileName: filePath.startsWith('/') ? filePath : `/${filePath}`,
            lineNumber: locations[0].line,
            columnNumber: locations[0].col,
          },
          dynamicProps: locations[0].dynamicProps,
        }
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
  return { fileName: file, lineNumber: 1, columnNumber: 1 }
}

function isFromNodeModules(instance: any): boolean {
  const file = instance.type?.__file
  if (!file) return true // No file info = likely a library component
  return file.includes('node_modules') || file.includes('.vite/deps/')
}

interface WalkContext {
  parentFile: string | null
  elementCounters: Map<string, number>
  parentUsageSource?: SourceLocation
}

/**
 * Resolve source location for an HTML element vnode from __DEVTOOLS_USAGE_MAP__.
 * Uses order-based counter per tag name, clamped for v-for duplicates.
 */
function getElementSource(tagName: string, ctx: WalkContext): SourceLocation | null {
  if (!ctx.parentFile) return null

  const map = (globalThis as any).__DEVTOOLS_USAGE_MAP__
  if (!map) return null

  for (const [filePath, fileUsages] of Object.entries(map)) {
    if (!ctx.parentFile.endsWith(filePath)) continue

    const locations = (fileUsages as any)[tagName]
    if (!locations || locations.length === 0) return null

    const index = ctx.elementCounters.get(tagName) ?? 0
    ctx.elementCounters.set(tagName, index + 1)

    // Clamp to array length for v-for duplicates
    const clampedIndex = Math.min(index, locations.length - 1)
    const loc = locations[clampedIndex]

    return {
      fileName: filePath.startsWith('/') ? filePath : `/${filePath}`,
      lineNumber: loc.line,
      columnNumber: loc.col,
    }
  }

  return null
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
      try { result[key] = JSON.parse(JSON.stringify(value)) }
      catch { result[key] = '[Style]' }
    } else if (typeof value === 'object' && value !== null) {
      try { result[key] = JSON.parse(JSON.stringify(value)) }
      catch { result[key] = '[Object]' }
    } else {
      result[key] = value
    }
  }
  return result
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
      try {
        result[key] = JSON.parse(JSON.stringify(value))
      } catch {
        result[key] = '[Object]'
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

  return {
    id: `vue_${nodeIdCounter++}`,
    name: tagName,
    source: null,
    _parentSource: ctx.parentUsageSource,
    props,
    sections: [],
    children,
    isFromNodeModules: false,
    isHostElement: true,
    _domElements: [el],
    textContent,
    textFragments: textContent ? [textContent] : undefined,
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
    const childCtx: WalkContext = {
      parentFile: instance.type?.__file ?? null,
      elementCounters: new Map(),
      parentUsageSource: usage?.source ?? source ?? undefined,
    }

    if (hideLibrary && isFromNodeModules(instance)) {
      // Hide library components — re-parent their children
      nodes.push(...walkVNodeChildren(instance.subTree, hideLibrary, childCtx))
    } else {
      const children = walkVNodeChildren(instance.subTree, hideLibrary, childCtx)

      const node: NormalizedNode = {
        id: `vue_${nodeIdCounter++}`,
        name,
        source,
        usageSource: usage?.source ?? undefined,
        dynamicProps: usage?.dynamicProps,
        props: getProps(instance),
        sections: extractSections(instance),
        children,
        isFromNodeModules: isFromNodeModules(instance),
        _domElements: findDOMElements(instance),
      }
      instanceRefMap.set(node.id, instance)
      nodes.push(node)
    }
    return nodes
  }

  // Element vnode — include as host element node
  if (vnode.shapeFlag & ELEMENT && typeof vnode.type === 'string') {
    const tagName = vnode.type
    const source = getElementSource(tagName, ctx)

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
      props: getHostElementProps(vnode.props),
      sections: [],
      children,
      isFromNodeModules: false,
      isHostElement: true,
      _domElements: vnode.el instanceof HTMLElement ? [vnode.el] : [],
      textContent,
      textFragments: textContent ? [textContent] : undefined,
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
export function walkInstanceTree(appInstance: any, hideLibrary = false): NormalizedNode[] {
  nodeIdCounter = 0
  instanceRefMap.clear()

  if (!appInstance) return []

  const rootName = getComponentName(appInstance)
  const source = getDefinitionSource(appInstance)
  const usage = parseUsageSource(appInstance)
  const rootCtx: WalkContext = {
    parentFile: appInstance.type?.__file ?? null,
    elementCounters: new Map(),
    parentUsageSource: usage?.source ?? source ?? undefined,
  }
  const children = walkVNodeChildren(appInstance.subTree, hideLibrary, rootCtx)

  const rootNode: NormalizedNode = {
    id: `vue_${nodeIdCounter++}`,
    name: rootName,
    source,
    usageSource: usage?.source ?? undefined,
    dynamicProps: usage?.dynamicProps,
    props: getProps(appInstance),
    sections: extractSections(appInstance),
    children,
    isFromNodeModules: isFromNodeModules(appInstance),
    _domElements: findDOMElements(appInstance),
  }
  instanceRefMap.set(rootNode.id, appInstance)

  return [rootNode]
}
