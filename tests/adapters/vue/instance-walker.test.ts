// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { walkInstanceTree, instanceRefMap } from '@/adapters/vue/instance-walker'

// Vue ShapeFlags
const STATEFUL_COMPONENT = 4
const ELEMENT = 1
const ARRAY_CHILDREN = 16

function createInstance(overrides: Record<string, any> = {}) {
  return {
    type: { __name: 'TestComponent', __file: '/src/TestComponent.vue' },
    props: {},
    setupState: {},
    data: {},
    provides: {},
    parent: null,
    proxy: {},
    uid: 1,
    subTree: null,
    ...overrides,
  }
}

function createVNode(overrides: Record<string, any> = {}) {
  return {
    type: 'div',
    shapeFlag: ELEMENT,
    props: null,
    children: null,
    el: null,
    component: null,
    key: null,
    ...overrides,
  }
}

describe('walkInstanceTree', () => {
  beforeEach(() => {
    instanceRefMap.clear()
    // Clear any global usage map
    delete (globalThis as any).__DEVTOOLS_USAGE_MAP__
  })

  it('returns empty array for null input', () => {
    expect(walkInstanceTree(null).tree).toEqual([])
  })

  describe('component name extraction', () => {
    it('uses type.__name for SFC components', () => {
      const instance = createInstance({
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].name).toBe('TestComponent')
    })

    it('uses type.name as fallback', () => {
      const instance = createInstance({
        type: { name: 'NamedComponent', __file: '/src/test.vue' },
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].name).toBe('NamedComponent')
    })

    it('infers name from __file path', () => {
      const instance = createInstance({
        type: { __file: '/src/components/MyWidget.vue' },
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].name).toBe('MyWidget')
    })

    it('falls back to Anonymous', () => {
      const instance = createInstance({
        type: {},
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].name).toBe('Anonymous')
    })
  })

  describe('tree structure', () => {
    it('creates root node from app instance', () => {
      const instance = createInstance({
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree.length).toBe(1)
      expect(tree[0].name).toBe('TestComponent')
    })

    it('creates child nodes from component vnodes', () => {
      const childInstance = createInstance({
        type: { __name: 'ChildComp', __file: '/src/ChildComp.vue' },
        uid: 2,
        subTree: createVNode({ shapeFlag: 0 }),
      })

      const childVNode = createVNode({
        shapeFlag: STATEFUL_COMPONENT,
        component: childInstance,
      })

      const root = createInstance({
        subTree: createVNode({
          shapeFlag: ARRAY_CHILDREN,
          type: Symbol('v-fgt'),
          children: [childVNode],
        }),
      })
      childInstance.parent = root

      const tree = walkInstanceTree(root).tree
      expect(tree[0].children.length).toBe(1)
      expect(tree[0].children[0].name).toBe('ChildComp')
    })
  })

  describe('hideLibrary', () => {
    it('skips node_modules components and re-parents their children', () => {
      const userChild = createInstance({
        type: { __name: 'UserChild', __file: '/src/UserChild.vue' },
        uid: 3,
        subTree: createVNode({ shapeFlag: 0 }),
      })

      const userChildVNode = createVNode({
        shapeFlag: STATEFUL_COMPONENT,
        component: userChild,
      })

      const libComponent = createInstance({
        type: { __name: 'LibWrapper', __file: '/node_modules/lib/Wrapper.vue' },
        uid: 2,
        subTree: createVNode({
          shapeFlag: ARRAY_CHILDREN,
          type: Symbol('v-fgt'),
          children: [userChildVNode],
        }),
      })
      userChild.parent = libComponent

      const libVNode = createVNode({
        shapeFlag: STATEFUL_COMPONENT,
        component: libComponent,
      })

      const root = createInstance({
        subTree: createVNode({
          shapeFlag: ARRAY_CHILDREN,
          type: Symbol('v-fgt'),
          children: [libVNode],
        }),
      })
      libComponent.parent = root

      const tree = walkInstanceTree(root, { hideLibrary: true }).tree
      // LibWrapper should be skipped, UserChild promoted
      expect(tree[0].children.length).toBe(1)
      expect(tree[0].children[0].name).toBe('UserChild')
    })
  })

  describe('source locations', () => {
    it('gets definition source from type.__file', () => {
      const instance = createInstance({
        type: { __name: 'Test', __file: '/src/Test.vue' },
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].source).toEqual({
        fileName: '/src/Test.vue',
        lineNumber: 1,
        columnNumber: 1,
      })
    })
  })

  describe('props', () => {
    it('serializes props correctly', () => {
      const instance = createInstance({
        props: { title: 'hello', onClick: () => {} },
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].props.title).toBe('hello')
      expect(tree[0].props.onClick).toBe('fn()')
    })

    it('serializes Vue component instances as [ComponentInstance]', () => {
      const instance = createInstance({
        props: { child: { __v_skip: true, name: 'test' } },
        subTree: createVNode({ shapeFlag: 0 }),
      })
      const tree = walkInstanceTree(instance).tree
      expect(tree[0].props.child).toBe('[ComponentInstance]')
    })
  })

  describe('host elements', () => {
    it('creates host element nodes from element vnodes', () => {
      const el = document.createElement('div')
      el.className = 'test'

      const elementVNode = createVNode({
        type: 'div',
        shapeFlag: ELEMENT,
        props: { class: 'test' },
        el,
      })

      const root = createInstance({
        subTree: createVNode({
          shapeFlag: ARRAY_CHILDREN,
          type: Symbol('v-fgt'),
          children: [elementVNode],
        }),
      })

      const tree = walkInstanceTree(root).tree
      const divNode = tree[0].children.find(c => c.name === 'div')
      expect(divNode).toBeDefined()
      expect(divNode!.isHostElement).toBe(true)
    })
  })

  it('populates instanceRefMap', () => {
    const instance = createInstance({
      subTree: createVNode({ shapeFlag: 0 }),
    })
    const tree = walkInstanceTree(instance).tree
    expect(instanceRefMap.size).toBeGreaterThan(0)
    expect(instanceRefMap.get(tree[0].id)).toBe(instance)
  })
})
