import { describe, it, expect } from 'vitest'
import { attributeError, buildErrorContext, buildAncestorChain } from '@/core/error-attribution'
import { createNormalizedNode, createConsoleEntry } from '@helpers/factories'
import type { NormalizedNode, ConsoleEntry, StackFrame } from '@/core/types'

function makeFrame(overrides: Partial<StackFrame> = {}): StackFrame {
  return { fn: 'render', file: '/src/App.tsx', line: 10, col: 5, isLibrary: false, ...overrides }
}

function makeTree(): NormalizedNode[] {
  return [
    createNormalizedNode({
      id: 'root',
      name: 'App',
      source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 1, endLineNumber: 50 },
      children: [
        createNormalizedNode({
          id: 'boundary',
          name: 'ErrorBoundary',
          source: { fileName: '/src/ErrorBoundary.tsx', lineNumber: 1, columnNumber: 1, endLineNumber: 30 },
          isErrorBoundary: true,
          children: [
            createNormalizedNode({
              id: 'list',
              name: 'TodoList',
              source: { fileName: '/src/TodoList.tsx', lineNumber: 1, columnNumber: 1, endLineNumber: 40 },
              children: [
                createNormalizedNode({
                  id: 'item1',
                  name: 'TodoItem',
                  source: { fileName: '/src/TodoItem.tsx', lineNumber: 5, columnNumber: 1, endLineNumber: 25 },
                  props: { text: 'Buy milk' },
                }),
                createNormalizedNode({
                  id: 'item2',
                  name: 'TodoItem',
                  source: { fileName: '/src/TodoItem.tsx', lineNumber: 5, columnNumber: 1, endLineNumber: 25 },
                  props: { text: 'Walk dog' },
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ]
}

describe('attributeError', () => {
  it('does nothing when entry has no frames', () => {
    const entry = createConsoleEntry({ frames: null })
    attributeError(entry, makeTree())
    expect(entry.ownedBy).toBeUndefined()
  })

  it('does nothing when entry has no user frames', () => {
    const entry = createConsoleEntry({
      frames: [makeFrame({ isLibrary: true, file: '/node_modules/react/index.js' })],
    })
    attributeError(entry, makeTree())
    expect(entry.ownedBy).toBeUndefined()
  })

  it('does nothing when tree is empty', () => {
    const entry = createConsoleEntry({ frames: [makeFrame()] })
    attributeError(entry, [])
    expect(entry.ownedBy).toBeUndefined()
  })

  it('matches component by file name (Strategy A)', () => {
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/TodoItem.tsx', line: 15 })],
    })
    attributeError(entry, makeTree())
    expect(entry.ownedBy).toBeDefined()
    expect(entry.ownedBy!.name).toBe('TodoItem')
  })

  it('prefers line-range match over file-only match (Strategy B)', () => {
    const tree: NormalizedNode[] = [
      createNormalizedNode({
        id: 'comp1',
        name: 'ComponentA',
        source: { fileName: '/src/shared.tsx', lineNumber: 1, columnNumber: 1, endLineNumber: 20 },
      }),
      createNormalizedNode({
        id: 'comp2',
        name: 'ComponentB',
        source: { fileName: '/src/shared.tsx', lineNumber: 25, columnNumber: 1, endLineNumber: 50 },
      }),
    ]

    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/shared.tsx', line: 30 })],
    })
    attributeError(entry, tree)
    expect(entry.ownedBy!.name).toBe('ComponentB')
  })

  it('prefers narrower range among multiple range matches', () => {
    const tree: NormalizedNode[] = [
      createNormalizedNode({
        id: 'outer',
        name: 'Outer',
        source: { fileName: '/src/shared.tsx', lineNumber: 1, columnNumber: 1, endLineNumber: 100 },
        children: [
          createNormalizedNode({
            id: 'inner',
            name: 'Inner',
            source: { fileName: '/src/shared.tsx', lineNumber: 10, columnNumber: 1, endLineNumber: 30 },
          }),
        ],
      }),
    ]

    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/shared.tsx', line: 15 })],
    })
    attributeError(entry, tree)
    expect(entry.ownedBy!.name).toBe('Inner')
  })

  it('walks up for nearest error boundary (Strategy C)', () => {
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/TodoItem.tsx', line: 15 })],
    })
    attributeError(entry, makeTree())
    expect(entry.caughtBy).toBeDefined()
    expect(entry.caughtBy!.componentName).toBe('ErrorBoundary')
  })

  it('sets caughtBy to null when no boundary ancestor', () => {
    const tree: NormalizedNode[] = [
      createNormalizedNode({
        id: 'app',
        name: 'App',
        source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 1, endLineNumber: 50 },
      }),
    ]
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/App.tsx', line: 10 })],
    })
    attributeError(entry, tree)
    expect(entry.ownedBy!.name).toBe('App')
    expect(entry.caughtBy).toBeUndefined()
  })

  it('creates a snapshot of the owning component', () => {
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/TodoItem.tsx', line: 15 })],
    })
    attributeError(entry, makeTree())
    expect(entry.snapshot).toBeDefined()
    expect(entry.snapshot!.name).toBe('TodoItem')
    expect(entry.snapshot!.props).toEqual({ text: 'Buy milk' })
    // Snapshot should not contain children or live refs
    expect((entry.snapshot as any).children).toBeUndefined()
    expect((entry.snapshot as any)._domElements).toBeUndefined()
  })

  it('uses suffix matching for relative vs absolute paths', () => {
    const tree: NormalizedNode[] = [
      createNormalizedNode({
        id: 'comp',
        name: 'MyComp',
        source: { fileName: 'src/MyComp.tsx', lineNumber: 1, columnNumber: 1 },
      }),
    ]
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/project/src/MyComp.tsx', line: 5 })],
    })
    attributeError(entry, tree)
    expect(entry.ownedBy!.name).toBe('MyComp')
  })

  it('skips library frames and uses first user frame', () => {
    const entry = createConsoleEntry({
      frames: [
        makeFrame({ fn: 'internalReact', file: '/node_modules/react/index.js', line: 100, isLibrary: true }),
        makeFrame({ fn: 'render', file: '/src/TodoItem.tsx', line: 15, isLibrary: false }),
      ],
    })
    attributeError(entry, makeTree())
    expect(entry.ownedBy!.name).toBe('TodoItem')
  })
})

describe('buildErrorContext', () => {
  it('returns full context with ancestors', () => {
    const tree = makeTree()
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/TodoItem.tsx', line: 15 })],
    })
    attributeError(entry, tree)

    const context = buildErrorContext(entry, tree)
    expect(context.error.message).toBe('Test error')
    expect(context.ownedBy!.name).toBe('TodoItem')
    expect(context.caughtBy!.componentName).toBe('ErrorBoundary')
    expect(context.ancestors.length).toBeGreaterThan(0)
    expect(context.ancestors.map(a => a.name)).toContain('TodoList')
    expect(context.ancestors.map(a => a.name)).toContain('ErrorBoundary')
  })

  it('returns empty ancestors when ownedBy is null', () => {
    const entry = createConsoleEntry({ frames: null })
    const context = buildErrorContext(entry, makeTree())
    expect(context.ownedBy).toBeNull()
    expect(context.ancestors).toEqual([])
  })

  it('filters render history to matching component', () => {
    const tree = makeTree()
    const entry = createConsoleEntry({
      frames: [makeFrame({ file: '/src/TodoItem.tsx', line: 15 })],
    })
    attributeError(entry, tree)

    const renderHistory = [
      { commitIndex: 0, timestampMs: 100, components: [
        { persistentId: 1, name: 'TodoItem', source: null, cause: 'props' as const, contributors: ['props' as const] },
        { persistentId: 2, name: 'App', source: null, cause: 'state' as const, contributors: ['state' as const] },
      ]},
    ]
    const context = buildErrorContext(entry, tree, renderHistory)
    expect(context.renderHistory).not.toBeNull()
    expect(context.renderHistory!.length).toBe(1)
    expect(context.renderHistory![0].components.length).toBe(1)
    expect(context.renderHistory![0].components[0].name).toBe('TodoItem')
  })
})

describe('buildAncestorChain', () => {
  it('returns ancestors from child to root', () => {
    const tree = makeTree()
    const ancestors = buildAncestorChain('item1', tree)
    const names = ancestors.map(a => a.name)
    expect(names).toEqual(['TodoList', 'ErrorBoundary', 'App'])
  })

  it('returns empty for root node', () => {
    const tree = makeTree()
    const ancestors = buildAncestorChain('root', tree)
    expect(ancestors).toEqual([])
  })

  it('returns empty for unknown nodeId', () => {
    const tree = makeTree()
    const ancestors = buildAncestorChain('nonexistent', tree)
    expect(ancestors).toEqual([])
  })
})
