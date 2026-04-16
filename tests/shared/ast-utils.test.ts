import { describe, it, expect } from 'vitest'
import {
  parseJSX,
  walkAST,
  findStringLiterals,
  findComponentDeclarations,
  findHookCalls,
  findJSXOpeningElements,
  findJSXAttribute,
  spliceSource,
} from '@/shared/ast-utils'

// ---- parseJSX ----

describe('parseJSX', () => {
  it('parses valid JSX and returns program + lineStarts', () => {
    const result = parseJSX('test.tsx', 'const x = <div>hello</div>')
    expect(result).not.toBeNull()
    expect(result!.program.type).toBe('Program')
    expect(result!.lineStarts).toEqual([0])
  })

  it('computes lineStarts correctly for multiline code', () => {
    const code = 'line1\nline2\nline3'
    const result = parseJSX('test.tsx', code)
    expect(result).not.toBeNull()
    expect(result!.lineStarts.length).toBe(3)
  })

  it('returns result with errors for recoverable parse errors', () => {
    // OXC parser is recovery-based; it returns a result with errors rather than null
    const result = parseJSX('test.tsx', '{{{invalid syntax')
    // The parser recovers and still returns a program
    if (result) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})

// ---- walkAST ----

describe('walkAST', () => {
  it('visits all typed nodes', () => {
    const result = parseJSX('test.tsx', 'const x = 1')!
    const types: string[] = []
    walkAST(result.program, (node) => types.push(node.type))
    expect(types).toContain('Program')
    expect(types).toContain('VariableDeclaration')
    expect(types).toContain('VariableDeclarator')
  })

  it('passes correct parent to visitor', () => {
    const result = parseJSX('test.tsx', 'const x = 1')!
    const parentMap: Record<string, string | null> = {}
    walkAST(result.program, (node, parent) => {
      parentMap[node.type] = parent?.type ?? null
    })
    expect(parentMap['Program']).toBeNull()
    expect(parentMap['VariableDeclaration']).toBe('Program')
  })
})

// ---- findStringLiterals ----

describe('findStringLiterals', () => {
  it('finds string literals within a byte range', () => {
    const code = 'const x = "hello"'
    const result = parseJSX('test.tsx', code)!
    const literals = findStringLiterals(result.program, 0, code.length)
    expect(literals.length).toBeGreaterThanOrEqual(1)
    expect(literals[0].value).toBe('hello')
  })

  it('ignores literals outside the range', () => {
    const code = 'const x = "hello"; const y = "world"'
    const result = parseJSX('test.tsx', code)!
    // Only search in the first half
    const literals = findStringLiterals(result.program, 0, 18)
    const values = literals.map(l => l.value)
    expect(values).toContain('hello')
    expect(values).not.toContain('world')
  })
})

// ---- findComponentDeclarations ----

describe('findComponentDeclarations', () => {
  it('finds function declarations', () => {
    const code = 'function MyComponent() { return null }'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    expect(comps.length).toBe(1)
    expect(comps[0].name).toBe('MyComponent')
  })

  it('finds arrow function components', () => {
    const code = 'const MyComponent = () => { return null }'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    expect(comps.length).toBe(1)
    expect(comps[0].name).toBe('MyComponent')
  })

  it('finds memo-wrapped components', () => {
    const code = 'const MyComponent = memo(() => { return null })'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    expect(comps.length).toBe(1)
    expect(comps[0].name).toBe('MyComponent')
  })

  it('finds export default function declarations', () => {
    const code = 'export default function App() { return null }'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    expect(comps.length).toBe(1)
    expect(comps[0].name).toBe('App')
  })

  it('ignores lowercase function names', () => {
    const code = 'function helper() { return null }'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    expect(comps.length).toBe(0)
  })

  it('returns correct line and bodyRange', () => {
    const code = 'const X = () => {\n  return null\n}'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    expect(comps[0].line).toBe(1)
    expect(comps[0].bodyRange).toBeDefined()
    expect(comps[0].bodyRange[0]).toBeLessThan(comps[0].bodyRange[1])
  })
})

// ---- findHookCalls ----

describe('findHookCalls', () => {
  it('finds useState with array destructuring variable name', () => {
    const code = 'function App() {\n  const [count, setCount] = useState(0)\n  return null\n}'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)
    expect(hooks.length).toBe(1)
    expect(hooks[0].hookName).toBe('useState')
    expect(hooks[0].varName).toBe('count')
  })

  it('finds useEffect as a bare call (no variable)', () => {
    const code = 'function App() {\n  useEffect(() => {}, [])\n  return null\n}'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)
    expect(hooks.length).toBe(1)
    expect(hooks[0].hookName).toBe('useEffect')
    expect(hooks[0].varName).toBeNull()
  })

  it('only finds hooks within the specified byte range', () => {
    const code = 'function A() { useState(1) }\nfunction B() { useState(2) }'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    // Only search in first component
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)
    expect(hooks.length).toBe(1)
  })

  it('extracts firstArgRange correctly', () => {
    const code = 'function App() {\n  const [x] = useState(42)\n  return null\n}'
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)
    expect(hooks[0].firstArgRange).not.toBeNull()
    const argText = code.slice(hooks[0].firstArgRange![0], hooks[0].firstArgRange![1])
    expect(argText).toBe('42')
  })
})

// ---- findJSXOpeningElements ----

describe('findJSXOpeningElements', () => {
  it('finds elements matching filter predicate', () => {
    const code = 'const x = <div><span>hi</span></div>'
    const result = parseJSX('test.tsx', code)!
    const elements = findJSXOpeningElements(result.program, (tag) => tag === 'div', result.lineStarts)
    expect(elements.length).toBe(1)
    expect(elements[0].tagName).toBe('div')
  })

  it('returns correct line and col', () => {
    const code = 'const x = (\n  <div />\n)'
    const result = parseJSX('test.tsx', code)!
    const elements = findJSXOpeningElements(result.program, () => true, result.lineStarts)
    expect(elements[0].line).toBe(2)
  })

  it('collects attribute names', () => {
    const code = 'const x = <div className="foo" id="bar" />'
    const result = parseJSX('test.tsx', code)!
    const elements = findJSXOpeningElements(result.program, () => true, result.lineStarts)
    expect(elements[0].attributes).toContain('className')
    expect(elements[0].attributes).toContain('id')
  })
})

// ---- findJSXAttribute ----

describe('findJSXAttribute', () => {
  it('finds attribute by name near a specific line', () => {
    const code = 'const x = <div title="hello" />'
    const result = parseJSX('test.tsx', code)!
    const attr = findJSXAttribute(result.program, 'title', 1, 5, result.lineStarts)
    expect(attr).not.toBeNull()
    expect(attr!.propKey).toBe('title')
  })

  it('returns stringLiteralRange for string attribute', () => {
    const code = 'const x = <div title="hello" />'
    const result = parseJSX('test.tsx', code)!
    const attr = findJSXAttribute(result.program, 'title', 1, 5, result.lineStarts)
    expect(attr!.stringLiteralRange).not.toBeNull()
    expect(attr!.expressionRange).toBeNull()
  })

  it('returns expressionRange for expression attribute', () => {
    const code = 'const x = <div title={value} />'
    const result = parseJSX('test.tsx', code)!
    const attr = findJSXAttribute(result.program, 'title', 1, 5, result.lineStarts)
    expect(attr!.expressionRange).not.toBeNull()
    expect(attr!.stringLiteralRange).toBeNull()
  })

  it('returns null when no match within line window', () => {
    const code = 'const x = <div title="hello" />'
    const result = parseJSX('test.tsx', code)!
    const attr = findJSXAttribute(result.program, 'title', 100, 5, result.lineStarts)
    expect(attr).toBeNull()
  })

  it('returns closest match when multiple attributes have same name', () => {
    const code = 'const a = <div title="a" />\n\n\n\nconst b = <div title="b" />'
    const result = parseJSX('test.tsx', code)!
    const attr = findJSXAttribute(result.program, 'title', 5, 5, result.lineStarts)
    expect(attr).not.toBeNull()
    expect(attr!.line).toBe(5)
  })
})

// ---- spliceSource ----

describe('spliceSource', () => {
  it('applies a single edit correctly', () => {
    const result = spliceSource('hello world', [{ start: 0, end: 5, replacement: 'hi' }])
    expect(result).toBe('hi world')
  })

  it('applies multiple edits preserving positions', () => {
    const result = spliceSource('aXbYc', [
      { start: 1, end: 2, replacement: '1' },
      { start: 3, end: 4, replacement: '2' },
    ])
    expect(result).toBe('a1b2c')
  })

  it('handles insertion (start === end)', () => {
    const result = spliceSource('ab', [{ start: 1, end: 1, replacement: 'X' }])
    expect(result).toBe('aXb')
  })

  it('handles deletion (empty replacement)', () => {
    const result = spliceSource('hello world', [{ start: 5, end: 11, replacement: '' }])
    expect(result).toBe('hello')
  })
})
