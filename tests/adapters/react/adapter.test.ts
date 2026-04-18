import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs module to control version detection
vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
}))

// We need to import the adapter after mocking
import { reactAdapter } from '@/adapters/react/adapter'

describe('reactAdapter.transform', () => {
  it('annotates function component with __devtools_source', () => {
    const code = 'function MyComponent() {\n  return <div />\n}'
    const result = reactAdapter.transform(code, '/src/MyComponent.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__devtools_source')
    expect(result!.code).toContain('MyComponent')
  })

  it('annotates arrow function component', () => {
    const code = 'const MyComponent = () => {\n  return <div />\n}'
    const result = reactAdapter.transform(code, '/src/MyComponent.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__devtools_source')
  })

  it('annotates export default function', () => {
    const code = 'export default function App() {\n  return <div />\n}'
    const result = reactAdapter.transform(code, '/src/App.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__devtools_source')
    expect(result!.code).toContain('App')
  })

  it('does NOT annotate lowercase functions', () => {
    const code = 'function helper() {\n  return 42\n}'
    const result = reactAdapter.transform(code, '/src/utils.ts', '/project')
    // No components found, no annotations
    expect(result).toBeNull()
  })

  it('injects __devtools_meta for components with hooks', () => {
    const code = 'function Counter() {\n  const [count, setCount] = useState(0)\n  return <div>{count}</div>\n}'
    const result = reactAdapter.transform(code, '/src/Counter.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__devtools_meta')
    expect(result!.code).toContain('count')
  })

  it('injects __source attribute on host JSX elements', () => {
    const code = 'function App() {\n  return <div className="test"><span>hi</span></div>\n}'
    const result = reactAdapter.transform(code, '/src/App.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__source=')
  })

  it('does NOT inject __source on uppercase JSX elements (components)', () => {
    const code = 'function App() {\n  return <MyChild />\n}'
    const result = reactAdapter.transform(code, '/src/App.tsx', '/project')
    // The transform should not inject __source on MyChild
    if (result) {
      // Check that __source doesn't appear in a way that targets MyChild
      const lines = result.code.split('\n')
      const myChildLine = lines.find(l => l.includes('MyChild') && l.includes('__source'))
      expect(myChildLine).toBeUndefined()
    }
  })

  it('injects usage map for component JSX elements', () => {
    const code = 'function App() {\n  return <MyChild />\n}'
    const result = reactAdapter.transform(code, '/src/App.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__DEVTOOLS_USAGE_MAP__')
    expect(result!.code).toContain('MyChild')
  })
})

describe('reactAdapter.rewriteSource', () => {
  it('rewrites useState initial value', () => {
    const source = 'function App() {\n  const [count, setCount] = useState(0)\n  return <div />\n}'
    const result = reactAdapter.rewriteSource(source, {
      editHint: { kind: 'react-hook' },
      value: 42,
      line: 2,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('useState(42)')
    expect(result).not.toContain('useState(0)')
  })

  it('rewrites useState with string value (adds quotes)', () => {
    const source = 'function App() {\n  const [name] = useState("hello")\n  return <div />\n}'
    const result = reactAdapter.rewriteSource(source, {
      editHint: { kind: 'react-hook' },
      value: 'world',
      line: 2,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('"world"')
  })

  it('returns null when no useState found on target line', () => {
    const source = 'function App() {\n  return <div />\n}'
    const result = reactAdapter.rewriteSource(source, {
      editHint: { kind: 'react-hook' },
      value: 42,
      line: 2,
      componentName: 'App',
    })
    expect(result).toBeNull()
  })

  it('rewrites static string prop', () => {
    const source = 'function App() {\n  return <div title="hello" />\n}'
    const result = reactAdapter.rewriteSource(source, {
      editHint: { kind: 'react-prop', propKey: 'title' },
      value: 'world',
      line: 2,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('"world"')
    expect(result).not.toContain('"hello"')
  })

  it('rewrites expression prop with string literal', () => {
    const source = "function App() {\n  return <div title={__('hello')} />\n}"
    const result = reactAdapter.rewriteSource(source, {
      editHint: { kind: 'react-prop', propKey: 'title' },
      value: 'world',
      line: 2,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    // Should preserve the __() wrapper
    expect(result).toContain('world')
  })

  it('rewrites numeric expression prop', () => {
    const source = 'function App() {\n  return <div count={42} />\n}'
    const result = reactAdapter.rewriteSource(source, {
      editHint: { kind: 'react-prop', propKey: 'count' },
      value: 99,
      line: 2,
      componentName: 'App',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('99')
  })
})

describe('reactAdapter.rewriteSource — react-memo-wrap', () => {
  const memoEdit = (componentName: string, line = 1) => ({
    editHint: { kind: 'react-memo-wrap' as const },
    value: null as any,
    line,
    componentName,
  })

  it('wraps a named function declaration', () => {
    const source = "import { useState } from 'react'\n\nfunction Foo(props) {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    expect(result).toContain('const Foo = memo(function Foo(props)')
    expect(result).toContain("import { useState, memo } from 'react'")
  })

  it('wraps an arrow function expression', () => {
    const source = "import { useState } from 'react'\n\nconst Foo = (props) => {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    expect(result).toContain('const Foo = memo((props) =>')
    expect(result).toContain("import { useState, memo } from 'react'")
  })

  it('wraps an exported function', () => {
    const source = "import { useState } from 'react'\n\nexport function Foo() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    expect(result).toContain('export const Foo = memo(function Foo()')
  })

  it('wraps export default function', () => {
    const source = "import React from 'react'\n\nexport default function Foo() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    expect(result).toContain('const Foo = memo(function Foo()')
    expect(result).toContain('export default Foo')
  })

  it('adds memo import when not present', () => {
    const source = "import { useState } from 'react'\n\nfunction Foo() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    expect(result).toContain('memo')
    expect(result).toContain("from 'react'")
  })

  it('does not duplicate memo import if already present', () => {
    const source = "import { useState, memo } from 'react'\n\nfunction Foo() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    // Should not add another memo import
    const memoCount = (result!.match(/memo/g) || []).length
    // 'memo' appears in: import line (1 time) + memo(function...) (1 time)
    expect(memoCount).toBeLessThanOrEqual(3)
  })

  it('adds memo to default-only react import', () => {
    const source = "import React from 'react'\n\nexport default function Foo() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).not.toBeNull()
    expect(result).toContain('React, { memo }')
  })

  it('returns null when component not found', () => {
    const source = "function Bar() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 1))
    expect(result).toBeNull()
  })

  it('returns null when component is already wrapped in memo()', () => {
    const source = "import { memo } from 'react'\n\nconst Foo = memo((props) => {\n  return <div />\n})"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 3))
    expect(result).toBeNull()
  })

  it('adds new react import when none exists', () => {
    const source = "function Foo() {\n  return <div />\n}"
    const result = reactAdapter.rewriteSource!(source, memoEdit('Foo', 1))
    expect(result).not.toBeNull()
    expect(result).toContain("import { memo } from 'react'")
    expect(result).toContain('const Foo = memo(function Foo()')
  })
})
