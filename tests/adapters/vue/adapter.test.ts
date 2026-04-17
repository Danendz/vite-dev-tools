import { describe, it, expect, vi } from 'vitest'

// Mock fs
vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ isFile: () => true })),
    writeFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => ({ isFile: () => true })),
  writeFileSync: vi.fn(),
}))

// Mock module - createRequire needs to resolve vue
vi.mock('node:module', () => ({
  createRequire: vi.fn(() => {
    const mockRequire: any = () => { throw new Error('not found') }
    mockRequire.resolve = () => { throw new Error('not found') }
    return mockRequire
  }),
}))

import { vueAdapter } from '@/adapters/vue/adapter'

describe('vueAdapter.transform', () => {
  it('returns null for non-.vue files', () => {
    const result = vueAdapter.transform('const x = 1', '/src/utils.ts', '/project')
    expect(result).toBeNull()
  })

  it('detects component usages via regex and injects usage map', () => {
    const code = `<template>
  <div>
    <MyComponent />
    <p>hello</p>
  </div>
</template>

<script setup>
import MyComponent from './MyComponent.vue'
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__DEVTOOLS_USAGE_MAP__')
    expect(result!.code).toContain('MyComponent')
  })

  it('detects HTML element usages', () => {
    const code = `<template>
  <div>
    <span>hello</span>
  </div>
</template>

<script setup>
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    expect(result).not.toBeNull()
    // Should track div and span elements
    expect(result!.code).toContain('__DEVTOOLS_USAGE_MAP__')
  })

  it('appends to existing non-setup script block', () => {
    const code = `<template>
  <MyComp />
</template>

<script>
export default { name: 'App' }
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    expect(result).not.toBeNull()
    // Should inject inside existing <script> block, not create a new one
    const scriptCount = (result!.code.match(/<script/g) || []).length
    expect(scriptCount).toBe(1) // Should still be just one script tag
  })

  it('creates new script block when no non-setup script exists', () => {
    const code = `<template>
  <MyComp />
</template>

<script setup>
import MyComp from './MyComp.vue'
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    expect(result).not.toBeNull()
    // Should add a new <script> block
    const scriptCount = (result!.code.match(/<script/g) || []).length
    expect(scriptCount).toBe(2) // Original setup + new non-setup
  })

  it('returns null when template has no trackable elements', () => {
    const code = `<template>
  <template v-if="true">
    <slot />
  </template>
</template>

<script setup>
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    // template and slot are Vue builtins, should not be tracked
    expect(result).toBeNull()
  })
})

describe('vueAdapter.transform composable injection', () => {
  it('injects __DEVTOOLS_COMPOSABLES__ for useX() calls in script setup', () => {
    const code = `<template>
  <div>{{ auth.user }}</div>
</template>

<script setup>
import { useAuth } from './composables/useAuth'
const auth = useAuth()
const label = 'test'
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__DEVTOOLS_COMPOSABLES__')
    expect(result!.code).toContain('useAuth')
  })

  it('does not inject composables for only Vue built-in calls', () => {
    const code = `<template>
  <div>{{ count }}</div>
</template>

<script setup>
const count = ref(0)
const doubled = computed(() => count.value * 2)
</script>`

    const result = vueAdapter.transform(code, '/project/src/App.vue', '/project')
    // May still have usage map from template, but no composable map
    if (result) {
      expect(result.code).not.toContain('__DEVTOOLS_COMPOSABLES__')
    }
  })
})

describe('vueAdapter.rewriteSource', () => {
  it('rewrites ref() initial value in script setup', () => {
    const source = `<template>
  <div>{{ count }}</div>
</template>

<script setup>
const count = ref(0)
</script>`

    const result = vueAdapter.rewriteSource(source, {
      editHint: { kind: 'vue-path', path: ['count'], stateType: 'setup' },
      value: 42,
      line: 6,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('ref(42)')
    expect(result).not.toContain('ref(0)')
  })

  it('rewrites ref() with string value', () => {
    const source = `<template>
  <div>{{ name }}</div>
</template>

<script setup>
const name = ref("hello")
</script>`

    const result = vueAdapter.rewriteSource(source, {
      editHint: { kind: 'vue-path', path: ['name'], stateType: 'setup' },
      value: 'world',
      line: 6,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('"world"')
  })

  it('returns null when no ref() found on target line', () => {
    const source = `<template>
  <div />
</template>

<script setup>
const x = 1
</script>`

    const result = vueAdapter.rewriteSource(source, {
      editHint: { kind: 'vue-path', path: ['x'], stateType: 'setup' },
      value: 42,
      line: 6,
      componentName: 'App',
    })
    expect(result).toBeNull()
  })

  it('rewrites reactive() nested property via vue-reactive-path', () => {
    const source = `<template>
  <div>{{ state.user.name }}</div>
</template>

<script setup>
const state = reactive({
  user: {
    name: 'Dan',
    role: 'dev'
  }
})
</script>`

    const result = vueAdapter.rewriteSource(source, {
      editHint: { kind: 'vue-reactive-path', varName: 'state', propertyPath: ['user', 'name'] },
      value: 'Alex',
      line: 9,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('"Alex"')
    expect(result).not.toContain("'Dan'")
  })

  it('returns null for vue-reactive-path with wrong var name', () => {
    const source = `<template><div /></template>
<script setup>
const state = reactive({ count: 0 })
</script>`

    const result = vueAdapter.rewriteSource(source, {
      editHint: { kind: 'vue-reactive-path', varName: 'missing', propertyPath: ['count'] },
      value: 5,
      line: 3,
      componentName: 'App',
    })
    expect(result).toBeNull()
  })

  it('rewrites static template prop via regex', () => {
    const source = `<template>
  <div title="hello" />
</template>

<script setup>
</script>`

    const result = vueAdapter.rewriteSource(source, {
      editHint: { kind: 'vue-prop', propKey: 'title' },
      value: 'world',
      line: 2,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('"world"')
    expect(result).not.toContain('"hello"')
  })
})
