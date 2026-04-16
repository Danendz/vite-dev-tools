import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { BridgeServer } from './bridge-server'

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

  return mcp
}
