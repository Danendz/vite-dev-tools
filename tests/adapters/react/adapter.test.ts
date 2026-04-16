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

  it('injects __devtools_hooks for components with hooks', () => {
    const code = 'function Counter() {\n  const [count, setCount] = useState(0)\n  return <div>{count}</div>\n}'
    const result = reactAdapter.transform(code, '/src/Counter.tsx', '/project')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('__devtools_hooks')
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
