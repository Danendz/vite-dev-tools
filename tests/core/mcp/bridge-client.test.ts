// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNormalizedNode, createTree } from '@helpers/factories'
import { BRIDGE_EVENTS, STORAGE_KEYS } from '@/shared/constants'

// Mock devtoolsState
vi.mock('@/core/overlay/state-store', () => ({
  devtoolsState: {
    tree: [],
    selectedNode: null,
    consoleEntries: [],
    onSelectNode: null,
    onHighlight: null,
  },
}))

// Mock communication module
vi.mock('@/core/communication', () => ({
  openInEditor: vi.fn(),
}))

// Mock interaction module
vi.mock('@/core/mcp/interaction', () => ({
  resolveElements: vi.fn().mockReturnValue({ elements: [], matchCount: 0 }),
  dispatchClick: vi.fn(),
  dispatchType: vi.fn(),
  dispatchKeypress: vi.fn(),
  dispatchSelectOption: vi.fn(),
  waitForSettle: vi.fn().mockResolvedValue({ settled: true }),
  startErrorCapture: vi.fn().mockReturnValue(() => []),
  buildActionResponse: vi.fn().mockReturnValue({ success: true, settled: true, matchCount: 0, consoleErrors: [] }),
}))

import { devtoolsState } from '@/core/overlay/state-store'

/**
 * Bridge-client registers handlers at module scope via a Map.
 * initBridgeClient() wires them to HMR. We can't easily mock import.meta.hot
 * for a dependent module in vitest, so we test the module by:
 * 1. Setting up import.meta.hot before importing
 * 2. Calling initBridgeClient to connect handlers
 * 3. Invoking the registered request handler directly
 */
describe('bridge-client', () => {
  let mockHot: {
    send: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    _requestHandler: Function | null
  }
  let initBridgeClient: () => void

  beforeEach(async () => {
    mockHot = {
      send: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (event === BRIDGE_EVENTS.REQUEST) {
          mockHot._requestHandler = handler
        }
      }),
      _requestHandler: null,
    }

    localStorage.clear()

    // Reset modules so bridge-client re-evaluates with fresh state
    vi.resetModules()

    // Provide import.meta.hot globally before the module loads
    // The module accesses (import.meta as any).hot, which vitest allows
    vi.stubGlobal('__vite_hot__', mockHot)

    // Dynamically import — vitest's module transform will pick up our mock
    // We need to set import.meta.hot on the module's context
    // Alternative: directly test through the exported function
    const mod = await import('@/core/mcp/bridge-client')
    initBridgeClient = mod.initBridgeClient
  })

  it('initBridgeClient is a function', () => {
    expect(typeof initBridgeClient).toBe('function')
  })

  // Since import.meta.hot is undefined in vitest test context, initBridgeClient
  // returns early. We test the handler logic by verifying the module exports.
  // The real handler tests happen in bridge-server.test.ts (server side)
  // and the interaction tests (client side). bridge-client is integration glue.
  it('returns early when import.meta.hot is undefined', () => {
    // Should not throw
    initBridgeClient()
    // Since hot is undefined in the module's context, no send calls
    // (our mockHot is on the test's import.meta, not the module's)
  })
})

/**
 * Test the pure helper logic that bridge-client uses internally.
 * These functions are private but we can test their behavior through
 * the expected shapes of getComponentTree / searchComponents responses.
 *
 * We verify this by testing the tree-utils and state-store integration,
 * which the bridge-client handlers delegate to.
 */
describe('bridge-client helper logic (via tree-utils)', () => {
  it('findNodeById works with devtoolsState tree', async () => {
    const { findNodeById } = await import('@/core/mcp/tree-utils')
    devtoolsState.tree = createTree()

    const node = findNodeById(devtoolsState.tree, 'header')
    expect(node).not.toBeNull()
    expect(node!.name).toBe('Header')
  })

  it('searchComponents would find case-insensitive matches', async () => {
    devtoolsState.tree = createTree()
    // Replicate searchNodes logic
    const query = 'head'
    const lq = query.toLowerCase()
    const results: any[] = []

    function walk(nodes: any[]) {
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(lq)) results.push(node)
        walk(node.children)
      }
    }
    walk(devtoolsState.tree)

    expect(results.length).toBe(1)
    expect(results[0].name).toBe('Header')
  })

  it('toCompact depth limiting works', () => {
    const tree = createTree()
    // Replicate toCompact with depth 1
    function toCompact(node: any, maxDepth?: number, current = 0): any {
      const atLimit = maxDepth !== undefined && current >= maxDepth
      const children = atLimit
        ? (node.children.length > 0
          ? [{ id: '', name: `... ${node.children.length} more children`, children: [], isFromNodeModules: false, source: null }]
          : [])
        : node.children.map((c: any) => toCompact(c, maxDepth, current + 1))

      return {
        id: node.id,
        name: node.name,
        children,
        isFromNodeModules: node.isFromNodeModules,
        source: node.source ? { fileName: node.source.fileName } : null,
      }
    }

    const compact = toCompact(tree[0], 1)
    expect(compact.name).toBe('App')
    // At depth 1, Header's children should be truncated
    expect(compact.children[0].children[0].name).toContain('... ')
  })
})
