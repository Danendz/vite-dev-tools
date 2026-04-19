import type { NormalizedNode, ConsoleEntry, SourceLocation, ConsoleEntryType } from '@/core/types'

export function createNormalizedNode(overrides: Partial<NormalizedNode> = {}): NormalizedNode {
  return {
    id: 'node_1',
    name: 'TestComponent',
    source: null,
    props: {},
    sections: [],
    children: [],
    isFromNodeModules: false,
    ...overrides,
  }
}

export function createSource(overrides: Partial<SourceLocation> = {}): SourceLocation {
  return {
    fileName: '/src/App.tsx',
    lineNumber: 1,
    columnNumber: 0,
    ...overrides,
  }
}

/**
 * Creates a 3-level tree:
 * App
 *   Header
 *     Logo
 *   Main
 */
export function createTree(): NormalizedNode[] {
  return [
    createNormalizedNode({
      id: 'app',
      name: 'App',
      children: [
        createNormalizedNode({
          id: 'header',
          name: 'Header',
          children: [
            createNormalizedNode({ id: 'logo', name: 'Logo' }),
          ],
        }),
        createNormalizedNode({ id: 'main', name: 'Main' }),
      ],
    }),
  ]
}

export function createConsoleEntry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: 'console_0',
    type: 'error' as ConsoleEntryType,
    timestamp: 1000,
    message: 'Test error',
    stack: null,
    frames: null,
    count: 1,
    groupKey: null,
    ...overrides,
  }
}

/**
 * Creates a minimal fake React fiber object.
 * Only includes properties that fiber-walker.ts accesses.
 */
export function createFakeFiber(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag: 0, // FunctionComponent
    type: { name: 'TestComponent', __devtools_source: null },
    memoizedProps: {},
    memoizedState: null,
    child: null,
    sibling: null,
    return: null,
    stateNode: null,
    _debugSource: null,
    _debugStack: null,
    ...overrides,
  }
}

/**
 * Creates a minimal fake Vue component instance.
 * Only includes properties that instance-walker.ts accesses.
 */
export function createFakeVueInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: { __name: 'TestComponent', __file: '/src/TestComponent.vue' },
    props: {},
    setupState: {},
    data: () => ({}),
    provides: {},
    parent: null,
    proxy: {},
    subTree: null,
    uid: 1,
    ...overrides,
  }
}
