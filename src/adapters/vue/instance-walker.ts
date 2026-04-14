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
 * Walk a vnode tree and extract child component NormalizedNodes.
 */
function walkVNodeChildren(vnode: any, hideLibrary: boolean): NormalizedNode[] {
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

    if (hideLibrary && isFromNodeModules(instance)) {
      // Hide library components — re-parent their children
      nodes.push(...walkVNodeChildren(instance.subTree, hideLibrary))
    } else {
      const children = walkVNodeChildren(instance.subTree, hideLibrary)
      const source = getDefinitionSource(instance)
      const usage = parseUsageSource(instance)

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

  // Teleport — show as named node with children
  if (vnode.shapeFlag & TELEPORT) {
    // Teleport children are in vnode.children
    if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) {
        nodes.push(...walkVNodeChildren(child, hideLibrary))
      }
    }
    return nodes
  }

  // Suspense — walk default slot
  if (vnode.shapeFlag & SUSPENSE) {
    if (vnode.ssContent) {
      nodes.push(...walkVNodeChildren(vnode.ssContent, hideLibrary))
    } else if (vnode.ssFallback) {
      nodes.push(...walkVNodeChildren(vnode.ssFallback, hideLibrary))
    }
    return nodes
  }

  // Fragment / element with array children
  if (vnode.shapeFlag & ARRAY_CHILDREN && Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      nodes.push(...walkVNodeChildren(child, hideLibrary))
    }
    return nodes
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
  const children = walkVNodeChildren(appInstance.subTree, hideLibrary)
  const source = getDefinitionSource(appInstance)
  const usage = parseUsageSource(appInstance)

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
