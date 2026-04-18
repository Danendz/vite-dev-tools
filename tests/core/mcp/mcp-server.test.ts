import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMcpTools } from '@/core/mcp/mcp-server'
import type { BridgeServer } from '@/core/mcp/bridge-server'

function createMockBridge(): BridgeServer {
  return {
    request: vi.fn().mockResolvedValue({}),
    getConnectedTabs: vi.fn().mockReturnValue([]),
  } as any
}

describe('createMcpTools', () => {
  let bridge: ReturnType<typeof createMockBridge>

  beforeEach(() => {
    bridge = createMockBridge()
  })

  it('returns an McpServer instance', () => {
    const mcp = createMcpTools(bridge)
    expect(mcp).toBeDefined()
  })

  it('registers all expected tools', () => {
    const mcp = createMcpTools(bridge)
    // Access internal tool registry
    const tools = (mcp as any)._registeredTools
    const toolNames = Object.keys(tools)

    const expectedTools = [
      'listConnectedTabs',
      'getComponentTree',
      'getSelectedComponent',
      'getConsoleErrors',
      'getPropsOf',
      'getSourceLocation',
      'searchComponents',
      'selectComponent',
      'highlightDom',
      'clearHighlight',
      'openInEditor',
      'click',
      'type',
      'keypress',
      'selectOption',
      'getElementInfo',
      'getRenderHistory',
      'getRenderCauses',
      'getHotComponents',
      'clearRenderHistory',
      'setRenderHistoryRecording',
      'getHookTree',
      'getLocalVars',
      'getWatchers',
      'getDepWarnings',
    ]

    for (const name of expectedTools) {
      expect(toolNames).toContain(name)
    }
    expect(toolNames.length).toBe(expectedTools.length)
  })

  it('listConnectedTabs calls bridge.getConnectedTabs', async () => {
    const tabs = [{ tabId: 't1', path: '/', lastFocused: 1 }]
    bridge.getConnectedTabs = vi.fn().mockReturnValue(tabs)
    const mcp = createMcpTools(bridge)

    const tools = (mcp as any)._registeredTools
    const handler = tools.listConnectedTabs.handler
    const result = await handler({})

    expect(bridge.getConnectedTabs).toHaveBeenCalled()
    expect(result.content[0].text).toContain('t1')
  })

  it('getComponentTree passes depth param to bridge.request', async () => {
    bridge.request = vi.fn().mockResolvedValue({ tree: [] })
    const mcp = createMcpTools(bridge)

    const tools = (mcp as any)._registeredTools
    const handler = tools.getComponentTree.handler
    await handler({ depth: 3 })

    expect(bridge.request).toHaveBeenCalledWith('getComponentTree', { depth: 3 }, undefined)
  })

  it('click passes nodeId, selector, text to bridge.request', async () => {
    bridge.request = vi.fn().mockResolvedValue({ success: true })
    const mcp = createMcpTools(bridge)

    const tools = (mcp as any)._registeredTools
    const handler = tools.click.handler
    await handler({ nodeId: 'n1', selector: '.btn', text: 'Submit' })

    expect(bridge.request).toHaveBeenCalledWith(
      'click',
      { nodeId: 'n1', selector: '.btn', text: 'Submit' },
      undefined,
    )
  })

  it('type passes value and clear to bridge.request', async () => {
    bridge.request = vi.fn().mockResolvedValue({ success: true })
    const mcp = createMcpTools(bridge)

    const tools = (mcp as any)._registeredTools
    const handler = tools.type.handler
    await handler({ selector: 'input', value: 'hello', clear: true })

    expect(bridge.request).toHaveBeenCalledWith(
      'type',
      { nodeId: undefined, selector: 'input', value: 'hello', clear: true },
      undefined,
    )
  })

  it('tool responses are JSON text content', async () => {
    bridge.request = vi.fn().mockResolvedValue({ status: 'ok' })
    const mcp = createMcpTools(bridge)

    const tools = (mcp as any)._registeredTools
    const handler = tools.getConsoleErrors.handler
    const result = await handler({})

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual({ status: 'ok' })
  })
})
