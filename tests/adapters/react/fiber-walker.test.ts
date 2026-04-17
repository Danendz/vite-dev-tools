// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { walkFiberTree, walkFiberTreeWithCauses, fiberRefMap } from '@/adapters/react/fiber-walker'
import { createFakeFiber } from '@helpers/factories'

// Fiber tag constants
const FunctionComponent = 0
const HostRoot = 3
const HostComponent = 5
const ForwardRef = 11
const MemoComponent = 14

/** Wrap a fiber as child of a HostRoot container so walkFiberTree can find it */
function wrapInRoot(fiber: Record<string, unknown>) {
  const root = createFakeFiber({ tag: HostRoot, child: fiber })
  fiber.return = root
  return root
}

describe('walkFiberTree', () => {
  beforeEach(() => {
    fiberRefMap.clear()
  })

  describe('component name extraction', () => {
    it('uses type.name for function components', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'MyComponent', __devtools_source: { fileName: '/src/MyComponent.tsx', lineNumber: 1, columnNumber: 0 } },
      })
      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree.length).toBe(1)
      expect(tree[0].name).toBe('MyComponent')
    })

    it('uses type.displayName when available', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: { displayName: 'CustomName', name: 'Original', __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 } },
      })
      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].name).toBe('CustomName')
    })

    it('handles ForwardRef components', () => {
      const fiber = createFakeFiber({
        tag: ForwardRef,
        type: { render: { name: 'ForwardButton' }, __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 } },
      })
      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].name).toBe('ForwardButton')
    })

    it('handles Memo components', () => {
      const fiber = createFakeFiber({
        tag: MemoComponent,
        type: { type: { name: 'MemoWidget' }, __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 } },
      })
      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].name).toBe('MemoWidget')
    })

    it('falls back to Anonymous for no-name components', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: { __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 } },
      })
      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].name).toBe('Anonymous')
    })
  })

  describe('tree structure', () => {
    it('produces single node for one component', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'App', __devtools_source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 0 } },
      })
      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree.length).toBe(1)
      expect(tree[0].name).toBe('App')
    })

    it('creates parent-child relationship for nested components', () => {
      const child = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'Child', __devtools_source: { fileName: '/src/Child.tsx', lineNumber: 1, columnNumber: 0 } },
      })

      const parent = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'Parent', __devtools_source: { fileName: '/src/Parent.tsx', lineNumber: 1, columnNumber: 0 } },
        child,
      })
      child.return = parent

      const tree = walkFiberTree(wrapInRoot(parent))
      expect(tree.length).toBe(1)
      expect(tree[0].name).toBe('Parent')
      expect(tree[0].children.length).toBe(1)
      expect(tree[0].children[0].name).toBe('Child')
    })

    it('creates sibling nodes', () => {
      const sibling2 = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'B', __devtools_source: { fileName: '/src/B.tsx', lineNumber: 1, columnNumber: 0 } },
      })

      const sibling1 = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'A', __devtools_source: { fileName: '/src/A.tsx', lineNumber: 1, columnNumber: 0 } },
        sibling: sibling2,
      })

      const parent = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'Parent', __devtools_source: { fileName: '/src/Parent.tsx', lineNumber: 1, columnNumber: 0 } },
        child: sibling1,
      })
      sibling1.return = parent
      sibling2.return = parent

      const tree = walkFiberTree(wrapInRoot(parent))
      expect(tree[0].children.length).toBe(2)
      expect(tree[0].children[0].name).toBe('A')
      expect(tree[0].children[1].name).toBe('B')
    })
  })

  describe('hideLibrary', () => {
    it('skips node_modules components and re-parents their children', () => {
      const userChild = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'UserChild', __devtools_source: { fileName: '/src/UserChild.tsx', lineNumber: 1, columnNumber: 0 } },
      })

      const libComponent = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'LibWrapper' }, // No __devtools_source → treated as library
        child: userChild,
      })
      userChild.return = libComponent

      const root = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'App', __devtools_source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 0 } },
        child: libComponent,
      })
      libComponent.return = root

      const tree = walkFiberTree(wrapInRoot(root), true)
      expect(tree[0].children.length).toBe(1)
      expect(tree[0].children[0].name).toBe('UserChild')
    })
  })

  describe('hooks extraction', () => {
    it('extracts useState hook with value', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: {
          name: 'Counter',
          __devtools_source: { fileName: '/src/Counter.tsx', lineNumber: 1, columnNumber: 0 },
          __devtools_hooks: [['count', 5]],
        },
        memoizedState: {
          memoizedState: 42,
          queue: { dispatch: () => {} },
          next: null,
        },
      })

      const tree = walkFiberTree(wrapInRoot(fiber))
      const hooksSection = tree[0].sections.find(s => s.id === 'hooks')
      expect(hooksSection).toBeDefined()
      expect(hooksSection!.items[0].key).toBe('count')
      expect(hooksSection!.items[0].value).toBe(42)
      expect(hooksSection!.items[0].editable).toBe(true)
      expect(hooksSection!.items[0].badge).toBe('useState')
    })

    it('extracts useRef hook', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: {
          name: 'MyComp',
          __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 },
        },
        memoizedState: {
          memoizedState: { current: null },
          queue: null,
          next: null,
        },
      })

      const tree = walkFiberTree(wrapInRoot(fiber))
      const hooksSection = tree[0].sections.find(s => s.id === 'hooks')
      expect(hooksSection).toBeDefined()
      expect(hooksSection!.items[0].key).toBe('useRef')
      expect(hooksSection!.items[0].value).toBeNull()
    })
  })

  describe('source locations', () => {
    it('uses _debugSource for usage location (React 18)', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'Test' },
        _debugSource: { fileName: '/src/Parent.tsx', lineNumber: 10, columnNumber: 5 },
      })

      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].source).toEqual({
        fileName: '/src/Parent.tsx',
        lineNumber: 10,
        columnNumber: 5,
      })
    })

    it('uses __devtools_source for definition location', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: {
          name: 'Test',
          __devtools_source: { fileName: '/src/Test.tsx', lineNumber: 1, columnNumber: 0 },
        },
      })

      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].source).toEqual({
        fileName: '/src/Test.tsx',
        lineNumber: 1,
        columnNumber: 0,
      })
    })
  })

  describe('props', () => {
    it('serializes props excluding children', () => {
      const fiber = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'Test', __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 } },
        memoizedProps: { title: 'hello', children: 'text', onClick: () => {} },
      })

      const tree = walkFiberTree(wrapInRoot(fiber))
      expect(tree[0].props.title).toBe('hello')
      expect(tree[0].props.children).toBeUndefined()
      expect(tree[0].props.onClick).toBe('fn()')
    })
  })

  describe('host elements', () => {
    it('creates host element nodes with isHostElement=true', () => {
      const el = document.createElement('div')
      const hostFiber = createFakeFiber({
        tag: HostComponent,
        type: 'div',
        stateNode: el,
        memoizedProps: { className: 'test' },
      })

      const root = createFakeFiber({
        tag: FunctionComponent,
        type: { name: 'App', __devtools_source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 0 } },
        child: hostFiber,
      })
      hostFiber.return = root

      const tree = walkFiberTree(wrapInRoot(root))
      const divNode = tree[0].children[0]
      expect(divNode.isHostElement).toBe(true)
      expect(divNode.name).toBe('div')
      expect(divNode.props.className).toBe('test')
    })
  })

  it('populates fiberRefMap', () => {
    const fiber = createFakeFiber({
      tag: FunctionComponent,
      type: { name: 'Test', __devtools_source: { fileName: '/src/test.tsx', lineNumber: 1, columnNumber: 0 } },
    })

    const tree = walkFiberTree(wrapInRoot(fiber))
    expect(fiberRefMap.size).toBeGreaterThan(0)
    expect(fiberRefMap.get(tree[0].id)).toBe(fiber)
  })
})

describe('walkFiberTreeWithCauses', () => {
  beforeEach(() => {
    fiberRefMap.clear()
  })

  it('attaches renderCause and persistentId to component nodes', () => {
    const fiber = createFakeFiber({
      tag: FunctionComponent,
      type: { name: 'App', __devtools_source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 0 } },
      memoizedProps: { a: 1 },
      alternate: null,
      flags: 1,
    })
    const result = walkFiberTreeWithCauses(wrapInRoot(fiber), {
      renderCause: { commitIndex: 0, includeValues: false },
    })
    expect(result.tree[0].renderCause?.primary).toBe('mount')
    expect(typeof result.tree[0].persistentId).toBe('number')
    expect(result.commit?.commitIndex).toBe(0)
    expect(result.commit?.components).toHaveLength(1)
    expect(result.commit?.components[0].cause).toBe('mount')
  })

  it('does not attach cause data when renderCause option is omitted', () => {
    const fiber = createFakeFiber({
      tag: FunctionComponent,
      type: { name: 'App', __devtools_source: { fileName: '/src/App.tsx', lineNumber: 1, columnNumber: 0 } },
    })
    const result = walkFiberTreeWithCauses(wrapInRoot(fiber), {})
    expect(result.tree[0].renderCause).toBeUndefined()
    expect(result.tree[0].persistentId).toBeUndefined()
    expect(result.commit).toBeNull()
  })

  it('omits bailed-out components from the commit record but keeps the cause on the node', () => {
    const props = { a: 1 }
    const prev = { memoizedProps: props, memoizedState: null, dependencies: null, flags: 0 }
    const fiber = createFakeFiber({
      tag: FunctionComponent,
      type: { name: 'Skipped', __devtools_source: { fileName: '/src/X.tsx', lineNumber: 1, columnNumber: 0 } },
      memoizedProps: props,
      alternate: prev,
      flags: 0,
    })
    const result = walkFiberTreeWithCauses(wrapInRoot(fiber), {
      renderCause: { commitIndex: 3, includeValues: false },
    })
    expect(result.tree[0].renderCause?.primary).toBe('bailout')
    expect(result.commit?.components).toHaveLength(0)
  })

  it('collects previousValues/nextValues when includeValues is true', () => {
    const prev = {
      memoizedProps: { count: 1 },
      memoizedState: null,
      dependencies: null,
      flags: 1,
    }
    const fiber = createFakeFiber({
      tag: FunctionComponent,
      type: { name: 'Counter', __devtools_source: { fileName: '/src/C.tsx', lineNumber: 1, columnNumber: 0 } },
      memoizedProps: { count: 2 },
      alternate: prev,
      flags: 1,
    })
    const result = walkFiberTreeWithCauses(wrapInRoot(fiber), {
      renderCause: { commitIndex: 0, includeValues: true },
    })
    const entry = result.commit?.components[0]
    expect(entry?.previousValues?.count).toBe('1')
    expect(entry?.nextValues?.count).toBe('2')
  })
})
