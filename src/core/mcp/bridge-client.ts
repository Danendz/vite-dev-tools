import type { NormalizedNode, CompactNode, BridgeRequest, BridgeResponse } from '../types'
import { BRIDGE_EVENTS, STORAGE_KEYS } from '../../shared/constants'
import { devtoolsState } from '../overlay/state-store'
import { findNodeById } from './tree-utils'

const TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

type Handler = (params: Record<string, unknown>) => Promise<unknown>
const handlers = new Map<string, Handler>()

function toCompact(node: NormalizedNode, maxDepth?: number, current = 0): CompactNode {
  const atLimit = maxDepth !== undefined && current >= maxDepth
  const children = atLimit
    ? (node.children.length > 0
      ? [{ id: '', name: `... ${node.children.length} more children`, children: [], isFromNodeModules: false, source: null }]
      : [])
    : node.children.map(c => toCompact(c, maxDepth, current + 1))

  return {
    id: node.id,
    name: node.name,
    children,
    isFromNodeModules: node.isFromNodeModules,
    source: node.source ? { fileName: node.source.fileName } : null,
  }
}

function stripNode(node: NormalizedNode): Record<string, unknown> {
  const { _domElements, _textFibers, children, ...rest } = node as any
  return { ...rest, children: children.map((c: NormalizedNode) => stripNode(c)) }
}

function searchNodes(nodes: NormalizedNode[], query: string): NormalizedNode[] {
  const results: NormalizedNode[] = []
  const lq = query.toLowerCase()
  function walk(nodes: NormalizedNode[]) {
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(lq)) results.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return results
}

// --- Handler registrations ---

handlers.set('getComponentTree', async (params) => {
  return devtoolsState.tree.map(n => toCompact(n, params.depth as number | undefined))
})

handlers.set('getSelectedComponent', async () => {
  const node = devtoolsState.selectedNode
  if (!node) return { error: 'No component selected' }
  return stripNode(node)
})

handlers.set('getConsoleErrors', async () => {
  return devtoolsState.consoleEntries
})

handlers.set('getPropsOf', async (params) => {
  const node = findNodeById(devtoolsState.tree, params.id as string)
  if (!node) return { error: `Component not found: ${params.id}` }
  return {
    id: node.id,
    name: node.name,
    props: node.props,
    sections: node.sections,
    source: node.source,
    usageSource: node.usageSource ?? null,
  }
})

handlers.set('getSourceLocation', async (params) => {
  const node = findNodeById(devtoolsState.tree, params.id as string)
  if (!node) return { error: `Component not found: ${params.id}` }
  return {
    definition: node.source,
    usage: node.usageSource ?? null,
  }
})

handlers.set('searchComponents', async (params) => {
  const matches = searchNodes(devtoolsState.tree, params.query as string)
  return matches.slice(0, 50).map(n => ({
    id: n.id,
    name: n.name,
    source: n.source ? { fileName: n.source.fileName } : null,
    isFromNodeModules: n.isFromNodeModules,
  }))
})

handlers.set('selectComponent', async (params) => {
  const query = params.query as string
  let node = findNodeById(devtoolsState.tree, query)
  if (!node) {
    const matches = searchNodes(devtoolsState.tree, query)
    node = matches[0] ?? null
  }
  if (!node) return { error: `Component not found: ${query}` }
  devtoolsState.onSelectNode?.(node)
  return stripNode(node)
})

handlers.set('highlightDom', async (params) => {
  const node = findNodeById(devtoolsState.tree, params.id as string)
  if (!node) return { error: `Component not found: ${params.id}` }
  devtoolsState.onHighlight?.(node, 'ai', !!params.persist)
  return { ok: true, name: node.name }
})

handlers.set('clearHighlight', async () => {
  devtoolsState.onHighlight?.(null)
  return { ok: true }
})

handlers.set('openInEditor', async (params) => {
  const node = findNodeById(devtoolsState.tree, params.id as string)
  if (!node?.source) return { error: `No source for component: ${params.id}` }
  const { openInEditor } = await import('../communication')
  openInEditor(node.source)
  return { ok: true, file: node.source.fileName, line: node.source.lineNumber }
})

// --- Interaction handlers ---

handlers.set('click', async (params) => {
  const { resolveElements, dispatchClick, waitForSettle, startErrorCapture, buildActionResponse } = await import('./interaction')
  const { elements, matchCount, error } = resolveElements({
    nodeId: params.nodeId as string | undefined,
    selector: params.selector as string | undefined,
    text: params.text as string | undefined,
  })
  if (error) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error }
  if (elements.length === 0) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error: 'No matching element found' }

  const stopCapture = startErrorCapture()
  dispatchClick(elements[0])
  const { settled } = await waitForSettle()
  const errors = stopCapture()

  return buildActionResponse({ success: true, settled, matchCount, errors, nodeId: params.nodeId as string | undefined })
})

handlers.set('type', async (params) => {
  const { resolveElements, dispatchType, waitForSettle, startErrorCapture, buildActionResponse } = await import('./interaction')
  const { elements, matchCount, error } = resolveElements({
    nodeId: params.nodeId as string | undefined,
    selector: params.selector as string | undefined,
  })
  if (error) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error }
  if (elements.length === 0) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error: 'No matching element found' }

  const stopCapture = startErrorCapture()
  dispatchType(elements[0], params.value as string, !!(params.clear))
  const { settled } = await waitForSettle()
  const errors = stopCapture()

  return buildActionResponse({ success: true, settled, matchCount, errors, nodeId: params.nodeId as string | undefined })
})

handlers.set('keypress', async (params) => {
  const { resolveElements, dispatchKeypress, waitForSettle, startErrorCapture, buildActionResponse } = await import('./interaction')
  const { elements, matchCount, error } = resolveElements({
    nodeId: params.nodeId as string | undefined,
    selector: params.selector as string | undefined,
  })
  if (error) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error }
  if (elements.length === 0) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error: 'No matching element found' }

  const stopCapture = startErrorCapture()
  dispatchKeypress(elements[0], params.key as string)
  const { settled } = await waitForSettle()
  const errors = stopCapture()

  return buildActionResponse({ success: true, settled, matchCount, errors, nodeId: params.nodeId as string | undefined })
})

handlers.set('selectOption', async (params) => {
  const { resolveElements, dispatchSelectOption, waitForSettle, startErrorCapture, buildActionResponse } = await import('./interaction')
  const { elements, matchCount, error } = resolveElements({
    nodeId: params.nodeId as string | undefined,
    selector: params.selector as string | undefined,
  })
  if (error) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error }
  if (elements.length === 0) return { success: false, settled: false, matchCount: 0, consoleErrors: [], error: 'No matching element found' }

  const el = elements[0]
  if (el.tagName !== 'SELECT') return { success: false, settled: false, matchCount, consoleErrors: [], error: `Expected <select> but found <${el.tagName.toLowerCase()}>` }

  const stopCapture = startErrorCapture()
  dispatchSelectOption(el as HTMLSelectElement, params.value as string)
  const { settled } = await waitForSettle()
  const errors = stopCapture()

  return buildActionResponse({ success: true, settled, matchCount, errors, nodeId: params.nodeId as string | undefined })
})

handlers.set('getElementInfo', async (params) => {
  const { resolveElements } = await import('./interaction')
  const { elements, matchCount, error } = resolveElements({
    nodeId: params.nodeId as string | undefined,
    selector: params.selector as string | undefined,
    text: params.text as string | undefined,
  })
  if (error) return { matchCount: 0, error }
  if (elements.length === 0) return { matchCount: 0, error: 'No matching element found' }

  const el = elements[0]
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)

  return {
    matchCount,
    tagName: el.tagName.toLowerCase(),
    textContent: (el.textContent?.trim() ?? '').slice(0, 500),
    visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
    attributes: {
      value: (el as HTMLInputElement).value ?? undefined,
      disabled: (el as HTMLInputElement).disabled ?? undefined,
      checked: (el as HTMLInputElement).checked ?? undefined,
      className: el.className || undefined,
      href: (el as HTMLAnchorElement).href ?? undefined,
      type: el.getAttribute('type') ?? undefined,
      placeholder: el.getAttribute('placeholder') ?? undefined,
      role: el.getAttribute('role') ?? undefined,
      'aria-label': el.getAttribute('aria-label') ?? undefined,
    },
    boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  }
})

/** Initialize the HMR bridge client */
export function initBridgeClient() {
  if (!(import.meta as any).hot) return

  const hot = (import.meta as any).hot

  // Register this tab
  hot.send(BRIDGE_EVENTS.TAB_REGISTER, {
    tabId: TAB_ID,
    path: window.location.pathname,
    title: document.title,
  })

  // Track focus
  window.addEventListener('focus', () => {
    hot.send(BRIDGE_EVENTS.TAB_FOCUS, { tabId: TAB_ID })
  })

  // Track unload
  window.addEventListener('beforeunload', () => {
    hot.send(BRIDGE_EVENTS.TAB_UNLOAD, { tabId: TAB_ID })
  })

  // Handle bridge requests
  hot.on(BRIDGE_EVENTS.REQUEST, async (data: BridgeRequest) => {
    const targetTabId = (data.params as any)?._targetTabId
    if (targetTabId && targetTabId !== TAB_ID) return

    // Check if MCP is paused
    if (localStorage.getItem(STORAGE_KEYS.MCP_PAUSED) === 'true') {
      hot.send(BRIDGE_EVENTS.RESPONSE, {
        id: data.id,
        error: 'MCP is paused from the devtools overlay.',
      } satisfies BridgeResponse)
      return
    }

    const handler = handlers.get(data.method)
    if (!handler) {
      hot.send(BRIDGE_EVENTS.RESPONSE, {
        id: data.id,
        error: `Unknown method: ${data.method}`,
      } satisfies BridgeResponse)
      return
    }

    try {
      const result = await handler(data.params ?? {})
      hot.send(BRIDGE_EVENTS.RESPONSE, {
        id: data.id,
        result,
      } satisfies BridgeResponse)
    } catch (e: any) {
      hot.send(BRIDGE_EVENTS.RESPONSE, {
        id: data.id,
        error: e.message,
      } satisfies BridgeResponse)
    }
  })
}
