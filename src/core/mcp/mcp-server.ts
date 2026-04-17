import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { BridgeServer } from './bridge-server'
import { RENDER_HISTORY_DEFAULTS } from '../../shared/constants'

export function createMcpTools(bridge: BridgeServer): McpServer {
  const mcp = new McpServer({
    name: 'vite-devtools',
    version: '2.0.0',
  })

  // --- Query tools ---

  mcp.registerTool('listConnectedTabs', {
    description: 'List all browser tabs currently connected to devtools. Returns tab IDs, URL paths, and titles.',
    inputSchema: z.object({}),
  }, async () => {
    const tabs = bridge.getConnectedTabs()
    return { content: [{ type: 'text' as const, text: JSON.stringify(tabs, null, 2) }] }
  })

  mcp.registerTool('getComponentTree', {
    description: 'Get the live React/Vue component tree from the running page. Returns a compact tree with id, name, children, isFromNodeModules, and source file. Use getPropsOf(id) to drill into a specific component.',
    inputSchema: z.object({
      depth: z.number().optional().describe('Max tree depth. Omit for full tree.'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ depth, tab }) => {
    const result = await bridge.request('getComponentTree', { depth }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getSelectedComponent', {
    description: 'Get full details (props, hooks, state, source) of the currently selected component in the devtools overlay.',
    inputSchema: z.object({
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ tab }) => {
    const result = await bridge.request('getSelectedComponent', {}, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getConsoleErrors', {
    description: 'Get captured console errors and warnings from the running page, including stack traces.',
    inputSchema: z.object({
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ tab }) => {
    const result = await bridge.request('getConsoleErrors', {}, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getPropsOf', {
    description: 'Get full props, hooks, and state for a specific component by its node ID. Use getComponentTree or searchComponents first to find the ID.',
    inputSchema: z.object({
      id: z.string().describe('Component node ID from the tree'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ id, tab }) => {
    const result = await bridge.request('getPropsOf', { id }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getSourceLocation', {
    description: 'Get the source file location where a component is defined and where it is rendered in parent JSX.',
    inputSchema: z.object({
      id: z.string().describe('Component node ID'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ id, tab }) => {
    const result = await bridge.request('getSourceLocation', { id }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('searchComponents', {
    description: 'Search for components by name pattern (case-insensitive). Returns matching components with IDs and source locations.',
    inputSchema: z.object({
      query: z.string().describe('Name pattern to search for'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ query, tab }) => {
    const result = await bridge.request('searchComponents', { query }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  // --- Action tools ---

  mcp.registerTool('selectComponent', {
    description: 'Select a component in the devtools overlay by name or node ID. The component will be highlighted in the tree and its details shown. Returns the component detail.',
    inputSchema: z.object({
      query: z.string().describe('Component name or node ID'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ query, tab }) => {
    const result = await bridge.request('selectComponent', { query, source: 'ai' }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('highlightDom', {
    description: 'Visually highlight a component\'s DOM elements in the browser. By default highlights auto-clear after 3 seconds. Pass persist=true to keep the highlight until clearHighlight is called.',
    inputSchema: z.object({
      id: z.string().describe('Component node ID to highlight'),
      persist: z.boolean().optional().describe('Keep highlight until clearHighlight is called (default: false, auto-clears after 3s)'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ id, persist, tab }) => {
    const result = await bridge.request('highlightDom', { id, persist, source: 'ai' }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('clearHighlight', {
    description: 'Clear any persistent DOM highlight set by highlightDom.',
    inputSchema: z.object({
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ tab }) => {
    const result = await bridge.request('clearHighlight', {}, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('openInEditor', {
    description: 'Open a component\'s source file in the user\'s configured code editor at the correct line and column.',
    inputSchema: z.object({
      id: z.string().describe('Component node ID'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ id, tab }) => {
    const result = await bridge.request('openInEditor', { id }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  // --- Interaction tools ---

  const interactionTargetDesc = {
    nodeId: 'Component node ID from the tree — scopes targeting to that component\'s DOM subtree',
    selector: 'CSS selector. Scoped to component if nodeId is given, otherwise queries the full document',
    text: 'Find element by its visible text content. Matches the first leaf element with matching trimmed textContent',
    tab: 'Target tab ID. Auto-selects if omitted.',
  }

  mcp.registerTool('click', {
    description: 'Click a DOM element in the running app. Target by component nodeId, CSS selector, or visible text. When multiple elements match, clicks the first in DOM order. Returns whether DOM settled after click, match count, any console errors, and optionally the targeted component\'s current state.',
    inputSchema: z.object({
      nodeId: z.string().optional().describe(interactionTargetDesc.nodeId),
      selector: z.string().optional().describe(interactionTargetDesc.selector),
      text: z.string().optional().describe(interactionTargetDesc.text),
      tab: z.string().optional().describe(interactionTargetDesc.tab),
    }),
  }, async ({ nodeId, selector, text, tab }) => {
    const result = await bridge.request('click', { nodeId, selector, text }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('type', {
    description: 'Type text into an input or textarea element. Target by component nodeId or CSS selector. Uses native value setter to work with React controlled inputs and Vue v-model. Set clear=true to clear existing value first.',
    inputSchema: z.object({
      nodeId: z.string().optional().describe(interactionTargetDesc.nodeId),
      selector: z.string().optional().describe(interactionTargetDesc.selector),
      value: z.string().describe('The text value to type into the element'),
      clear: z.boolean().optional().describe('Clear existing value before typing (default: false)'),
      tab: z.string().optional().describe(interactionTargetDesc.tab),
    }),
  }, async ({ nodeId, selector, value, clear, tab }) => {
    const result = await bridge.request('type', { nodeId, selector, value, clear }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('keypress', {
    description: 'Press a keyboard key on a targeted element. Dispatches keydown and keyup events. Common keys: "Enter", "Escape", "Tab", "Backspace", "ArrowDown", or single characters like "a".',
    inputSchema: z.object({
      nodeId: z.string().optional().describe(interactionTargetDesc.nodeId),
      selector: z.string().optional().describe(interactionTargetDesc.selector),
      key: z.string().describe('Key to press, e.g. "Enter", "Escape", "Tab", "a"'),
      tab: z.string().optional().describe(interactionTargetDesc.tab),
    }),
  }, async ({ nodeId, selector, key, tab }) => {
    const result = await bridge.request('keypress', { nodeId, selector, key }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('selectOption', {
    description: 'Select an option from a <select> dropdown element. Target by component nodeId or CSS selector. Sets the value and dispatches change events for React/Vue reactivity.',
    inputSchema: z.object({
      nodeId: z.string().optional().describe(interactionTargetDesc.nodeId),
      selector: z.string().optional().describe(interactionTargetDesc.selector),
      value: z.string().describe('The option value to select'),
      tab: z.string().optional().describe(interactionTargetDesc.tab),
    }),
  }, async ({ nodeId, selector, value, tab }) => {
    const result = await bridge.request('selectOption', { nodeId, selector, value }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getElementInfo', {
    description: 'Get information about a DOM element: tag name, text content, visibility, attributes (value, disabled, checked, className, href, type, placeholder, role, aria-label), and bounding rect. Target by component nodeId, CSS selector, or visible text.',
    inputSchema: z.object({
      nodeId: z.string().optional().describe(interactionTargetDesc.nodeId),
      selector: z.string().optional().describe(interactionTargetDesc.selector),
      text: z.string().optional().describe(interactionTargetDesc.text),
      tab: z.string().optional().describe(interactionTargetDesc.tab),
    }),
  }, async ({ nodeId, selector, text, tab }) => {
    const result = await bridge.request('getElementInfo', { nodeId, selector, text }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  // --- Render-cause attribution tools ---

  mcp.registerTool('getRenderHistory', {
    description: 'Get the recorded render history buffer — each entry is a commit with the components that re-rendered and why (props/state/context/parent/mount). Requires the render-cause setting to be enabled in the devtools overlay.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Return only the last N commits (default: all buffered).'),
      includeValues: z.boolean().optional().describe('Include previousValues/nextValues for changed props. Default true.'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ limit, includeValues, tab }) => {
    const result = await bridge.request('getRenderHistory', { limit, includeValues }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getRenderCauses', {
    description: 'Get the render history filtered to a single component by name. Use this to investigate "why does <Foo> keep re-rendering?".',
    inputSchema: z.object({
      componentName: z.string().describe('The component name to filter by (exact match).'),
      limit: z.number().optional().describe('Return only the last N matching commits.'),
      includeValues: z.boolean().optional().describe('Include previousValues/nextValues. Default true.'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ componentName, limit, includeValues, tab }) => {
    const result = await bridge.request('getRenderCauses', { componentName, limit, includeValues }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('getHotComponents', {
    description: 'Get the top N most-frequently re-rendering components within a recent time window. The key tool to find perf suspects.',
    inputSchema: z.object({
      windowMs: z.number().optional().describe('Look-back window in milliseconds (default 5000).'),
      limit: z.number().optional().describe('Top N (default 10).'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ windowMs, limit, tab }) => {
    const result = await bridge.request('getHotComponents', { windowMs, limit }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('clearRenderHistory', {
    description: 'Empty the render history buffer. Useful for "I fixed it, now check fresh" workflows.',
    inputSchema: z.object({
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ tab }) => {
    const result = await bridge.request('clearRenderHistory', {}, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  mcp.registerTool('setRenderHistoryRecording', {
    description: 'Pause or resume render-history recording. Pause while analyzing, resume before reproducing.',
    inputSchema: z.object({
      enabled: z.boolean().describe('true to record, false to pause.'),
      tab: z.string().optional().describe('Target tab ID. Auto-selects if omitted.'),
    }),
  }, async ({ enabled, tab }) => {
    const result = await bridge.request('setRenderHistoryRecording', { enabled }, tab)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  return mcp
}
