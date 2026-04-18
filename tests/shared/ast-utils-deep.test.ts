import { describe, it, expect } from 'vitest'
import {
  parseJSX,
  findComponentDeclarations,
  findHookCalls,
  findHookCallsDeep,
  findLocalVarDeclarations,
  traceIdentifierToDeclaration,
  findImportSource,
  findExportedVariable,
  findReactiveObjectProperty,
  traceJSXPropOrigins,
  findFunctionDefinition,
  findVueCallSites,
  REACT_BUILT_IN_HOOKS,
} from '@/shared/ast-utils'

// ---- findHookCalls dep extraction ----

describe('findHookCalls dep extraction', () => {
  it('extracts dep names from useEffect', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  const name = 'test'
  useEffect(() => { console.log(count) }, [count, name])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)

    const effect = hooks.find(h => h.hookName === 'useEffect')
    expect(effect).toBeDefined()
    expect(effect!.depNames).toEqual(['count', 'name'])
  })

  it('extracts dep names from useMemo', () => {
    const code = `function App() {
  const [a, setA] = useState(1)
  const [b, setB] = useState(2)
  const sum = useMemo(() => a + b, [a, b])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)

    const memo = hooks.find(h => h.hookName === 'useMemo')
    expect(memo).toBeDefined()
    expect(memo!.depNames).toEqual(['a', 'b'])
  })

  it('extracts dep names from useCallback', () => {
    const code = `function App() {
  const onClick = useCallback(() => {}, [handleClick, props.id])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)

    const cb = hooks.find(h => h.hookName === 'useCallback')
    expect(cb).toBeDefined()
    expect(cb!.depNames).toEqual(['handleClick', 'props.id'])
  })

  it('extracts member expression deps', () => {
    const code = `function App() {
  useEffect(() => {}, [obj.nested.value, arr[0]])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)

    expect(hooks[0].depNames).toEqual(['obj.nested.value', 'arr[?]'])
  })

  it('returns undefined depNames for hooks without deps', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  useEffect(() => {})
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)

    const state = hooks.find(h => h.hookName === 'useState')
    expect(state!.depNames).toBeUndefined()

    const effect = hooks.find(h => h.hookName === 'useEffect')
    expect(effect!.depNames).toBeUndefined()
  })

  it('handles empty dep array', () => {
    const code = `function App() {
  useEffect(() => {}, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const hooks = findHookCalls(result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts)

    expect(hooks[0].depNames).toEqual([])
  })
})

// ---- findHookCallsDeep ----

describe('findHookCallsDeep', () => {
  it('returns flat list for built-in hooks only', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  useEffect(() => {}, [count])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    expect(deep).toHaveLength(3)
    expect(deep[0].hookName).toBe('useState')
    expect(deep[0].innerHooks).toBeUndefined()
    expect(deep[1].hookName).toBe('useRef')
    expect(deep[2].hookName).toBe('useEffect')
    expect(deep[2].depNames).toEqual(['count'])
  })

  it('introspects same-file custom hook', () => {
    const code = `
function useCounter(initial) {
  const [count, setCount] = useState(initial)
  const increment = useCallback(() => setCount(c => c + 1), [])
  return { count, increment }
}

function App() {
  const { count, increment } = useCounter(0)
  return <div>{count}</div>
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const appComp = comps.find(c => c.name === 'App')!
    const deep = findHookCallsDeep(
      result.program, appComp.bodyRange[0], appComp.bodyRange[1], result.lineStarts,
    )

    expect(deep).toHaveLength(1)
    expect(deep[0].hookName).toBe('useCounter')
    expect(deep[0].varName).toBe('count')
    expect(deep[0].innerHooks).toBeDefined()
    expect(deep[0].innerHooks).toHaveLength(2)
    expect(deep[0].innerHooks![0].hookName).toBe('useState')
    expect(deep[0].innerHooks![0].varName).toBe('count')
    expect(deep[0].innerHooks![1].hookName).toBe('useCallback')
    expect(deep[0].innerHooks![1].varName).toBe('increment')
    expect(deep[0].innerHooks![1].depNames).toEqual([])
  })

  it('introspects nested custom hooks (depth > 1)', () => {
    const code = `
function useUser() {
  const [name, setName] = useState('')
  return { name, setName }
}

function useAuth() {
  const user = useUser()
  const [token, setToken] = useState(null)
  return { user, token }
}

function App() {
  const auth = useAuth()
  return <div>{auth.user.name}</div>
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const appComp = comps.find(c => c.name === 'App')!
    const deep = findHookCallsDeep(
      result.program, appComp.bodyRange[0], appComp.bodyRange[1], result.lineStarts,
    )

    expect(deep).toHaveLength(1)
    expect(deep[0].hookName).toBe('useAuth')

    const inner = deep[0].innerHooks!
    expect(inner).toHaveLength(2)
    expect(inner[0].hookName).toBe('useUser')
    expect(inner[0].innerHooks).toHaveLength(1)
    expect(inner[0].innerHooks![0].hookName).toBe('useState')
    expect(inner[0].innerHooks![0].varName).toBe('name')
    expect(inner[1].hookName).toBe('useState')
    expect(inner[1].varName).toBe('token')
  })

  it('handles arrow function custom hooks', () => {
    const code = `
const useToggle = (initial) => {
  const [value, setValue] = useState(initial)
  const toggle = useCallback(() => setValue(v => !v), [])
  return [value, toggle]
}

function App() {
  const [on, toggle] = useToggle(false)
  return <div />
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const appComp = comps.find(c => c.name === 'App')!
    const deep = findHookCallsDeep(
      result.program, appComp.bodyRange[0], appComp.bodyRange[1], result.lineStarts,
    )

    expect(deep).toHaveLength(1)
    expect(deep[0].hookName).toBe('useToggle')
    expect(deep[0].innerHooks).toHaveLength(2)
  })

  it('uses resolveHook callback for imported hooks', () => {
    const hookCode = `
export function useRemote() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  return { data, loading }
}`
    const hookParsed = parseJSX('hooks.ts', hookCode)!
    const hookFunc = findFunctionDefinition(hookParsed.program, 'useRemote', hookParsed.lineStarts)!

    const code = `
import { useRemote } from './hooks'
function App() {
  const { data, loading } = useRemote()
  return <div>{data}</div>
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const appComp = comps.find(c => c.name === 'App')!

    const deep = findHookCallsDeep(
      result.program, appComp.bodyRange[0], appComp.bodyRange[1], result.lineStarts,
      {
        resolveHook: (name) => {
          if (name === 'useRemote') {
            return {
              program: hookParsed.program,
              bodyRange: hookFunc.bodyRange,
              lineStarts: hookParsed.lineStarts,
              sourceFile: './hooks.ts',
            }
          }
          return null
        },
      },
    )

    expect(deep).toHaveLength(1)
    expect(deep[0].hookName).toBe('useRemote')
    expect(deep[0].sourceFile).toBe('./hooks.ts')
    expect(deep[0].innerHooks).toHaveLength(2)
    expect(deep[0].innerHooks![0].varName).toBe('data')
    expect(deep[0].innerHooks![1].varName).toBe('loading')
  })

  it('prevents infinite recursion on circular hook calls', () => {
    // This shouldn't happen in real code but the function should handle it
    const code = `
function useA() {
  const x = useB()
  return x
}

function useB() {
  const y = useA()
  return y
}

function App() {
  const val = useA()
  return <div />
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const appComp = comps.find(c => c.name === 'App')!

    // Should not throw or infinite loop
    const deep = findHookCallsDeep(
      result.program, appComp.bodyRange[0], appComp.bodyRange[1], result.lineStarts,
    )

    expect(deep).toHaveLength(1)
    expect(deep[0].hookName).toBe('useA')
    // useA → useB → useA (blocked by visited), so useB has no inner useA
    expect(deep[0].innerHooks).toHaveLength(1)
    expect(deep[0].innerHooks![0].hookName).toBe('useB')
  })

  it('supports custom builtIns and callFilter for Vue', () => {
    const vueBuiltIns = new Set(['ref', 'reactive', 'computed', 'watch', 'watchEffect'])
    const vueCallFilter = (name: string) => /^use[A-Z]/.test(name) || vueBuiltIns.has(name)

    const code = `
function useAuth() {
  const user = ref(null)
  const isAdmin = computed(() => user.value?.role === 'admin')
  return { user, isAdmin }
}

function setup() {
  const auth = useAuth()
}`
    const result = parseJSX('test.ts', code)!
    const setupFunc = findFunctionDefinition(result.program, 'setup', result.lineStarts)!

    const deep = findHookCallsDeep(
      result.program, setupFunc.bodyRange[0], setupFunc.bodyRange[1], result.lineStarts,
      {
        builtIns: vueBuiltIns,
        callFilter: vueCallFilter,
      },
    )

    expect(deep).toHaveLength(1)
    expect(deep[0].hookName).toBe('useAuth')
    expect(deep[0].innerHooks).toHaveLength(2)
    expect(deep[0].innerHooks![0].hookName).toBe('ref')
    expect(deep[0].innerHooks![1].hookName).toBe('computed')
  })
})

// ---- findFunctionDefinition ----

describe('findFunctionDefinition', () => {
  it('finds function declaration', () => {
    const code = `
function useCounter() {
  return useState(0)
}
`
    const result = parseJSX('test.ts', code)!
    const def = findFunctionDefinition(result.program, 'useCounter', result.lineStarts)
    expect(def).not.toBeNull()
    expect(def!.line).toBe(2)
  })

  it('finds arrow function variable', () => {
    const code = `
const useToggle = () => {
  return useState(false)
}
`
    const result = parseJSX('test.ts', code)!
    const def = findFunctionDefinition(result.program, 'useToggle', result.lineStarts)
    expect(def).not.toBeNull()
  })

  it('finds exported function', () => {
    const code = `
export function useData() {
  return useState(null)
}
`
    const result = parseJSX('test.ts', code)!
    const def = findFunctionDefinition(result.program, 'useData', result.lineStarts)
    expect(def).not.toBeNull()
  })

  it('returns null for undefined function', () => {
    const code = `function App() { return null }`
    const result = parseJSX('test.ts', code)!
    const def = findFunctionDefinition(result.program, 'useNonExistent', result.lineStarts)
    expect(def).toBeNull()
  })
})

// ---- findLocalVarDeclarations ----

describe('findLocalVarDeclarations', () => {
  it('finds local variables excluding hooks', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const total = count * 2
  const name = 'test'
  const isActive = total > 0
  return <div>{total}</div>
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const locals = findLocalVarDeclarations(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const names = locals.map(l => l.name)
    expect(names).toContain('total')
    expect(names).toContain('name')
    expect(names).toContain('isActive')
    expect(names).not.toContain('count')
    expect(names).not.toContain('setCount')
    expect(names).not.toContain('ref')
  })

  it('handles destructured variables', () => {
    const code = `function App() {
  const { a, b } = someFunction()
  const [x, y] = getCoords()
  return <div />
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const locals = findLocalVarDeclarations(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const names = locals.map(l => l.name)
    expect(names).toContain('a')
    expect(names).toContain('b')
    expect(names).toContain('x')
    expect(names).toContain('y')
  })

  it('skips PascalCase names (likely components)', () => {
    const code = `function App() {
  const MyComp = () => <div />
  const label = 'hello'
  return <MyComp />
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const locals = findLocalVarDeclarations(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const names = locals.map(l => l.name)
    expect(names).toContain('label')
    expect(names).not.toContain('MyComp')
  })

  it('skips Vue built-in composables', () => {
    const code = `function setup() {
  const count = ref(0)
  const state = reactive({ name: 'test' })
  const doubled = computed(() => count.value * 2)
  const label = 'hello'
}`
    const result = parseJSX('test.ts', code)!
    const func = findFunctionDefinition(result.program, 'setup', result.lineStarts)!
    const locals = findLocalVarDeclarations(
      result.program, func.bodyRange[0], func.bodyRange[1], result.lineStarts,
    )

    const names = locals.map(l => l.name)
    expect(names).toContain('label')
    expect(names).not.toContain('count')
    expect(names).not.toContain('state')
    expect(names).not.toContain('doubled')
  })
})

// ---- traceIdentifierToDeclaration ----

describe('traceIdentifierToDeclaration', () => {
  it('traces to local variable declaration', () => {
    const code = `
const colors = ['red', 'blue', 'green']
function App() { return <Palette items={colors} /> }
`
    const result = parseJSX('test.tsx', code)!
    const origin = traceIdentifierToDeclaration(result.program, 'colors', result.lineStarts)

    expect(origin).not.toBeNull()
    expect(origin!.source).toBe('local')
    expect(origin!.varName).toBe('colors')
    expect(origin!.isStatic).toBe(true)
    expect(origin!.importPath).toBeUndefined()
  })

  it('traces to import', () => {
    const code = `
import { COLORS } from './constants'
function App() { return <Palette items={COLORS} /> }
`
    const result = parseJSX('test.tsx', code)!
    const origin = traceIdentifierToDeclaration(result.program, 'COLORS', result.lineStarts)

    expect(origin).not.toBeNull()
    expect(origin!.source).toBe('import')
    expect(origin!.varName).toBe('COLORS')
    expect(origin!.importPath).toBe('./constants')
    expect(origin!.isStatic).toBe(false) // can't determine for imports
  })

  it('traces to default import', () => {
    const code = `
import config from './config'
function App() { return <Panel settings={config} /> }
`
    const result = parseJSX('test.tsx', code)!
    const origin = traceIdentifierToDeclaration(result.program, 'config', result.lineStarts)

    expect(origin).not.toBeNull()
    expect(origin!.source).toBe('import')
    expect(origin!.importPath).toBe('./config')
  })

  it('detects non-static initializers', () => {
    const code = `
const items = getItems()
function App() { return <List data={items} /> }
`
    const result = parseJSX('test.tsx', code)!
    const origin = traceIdentifierToDeclaration(result.program, 'items', result.lineStarts)

    expect(origin).not.toBeNull()
    expect(origin!.source).toBe('local')
    expect(origin!.isStatic).toBe(false)
  })

  it('detects static object initializer', () => {
    const code = `
const config = { theme: 'dark', fontSize: 14 }
function App() { return <Panel settings={config} /> }
`
    const result = parseJSX('test.tsx', code)!
    const origin = traceIdentifierToDeclaration(result.program, 'config', result.lineStarts)

    expect(origin).not.toBeNull()
    expect(origin!.isStatic).toBe(true)
  })

  it('returns null for undeclared identifier', () => {
    const code = `function App() { return <div>{x}</div> }`
    const result = parseJSX('test.tsx', code)!
    expect(traceIdentifierToDeclaration(result.program, 'x', result.lineStarts)).toBeNull()
  })
})

// ---- findImportSource ----

describe('findImportSource', () => {
  it('finds named import', () => {
    const code = `import { useAuth } from './hooks/useAuth'`
    const result = parseJSX('test.ts', code)!
    const imp = findImportSource(result.program, 'useAuth', result.lineStarts)

    expect(imp).not.toBeNull()
    expect(imp!.importPath).toBe('./hooks/useAuth')
    expect(imp!.isDefault).toBe(false)
  })

  it('finds default import', () => {
    const code = `import useAuth from './hooks/useAuth'`
    const result = parseJSX('test.ts', code)!
    const imp = findImportSource(result.program, 'useAuth', result.lineStarts)

    expect(imp).not.toBeNull()
    expect(imp!.importPath).toBe('./hooks/useAuth')
    expect(imp!.isDefault).toBe(true)
  })

  it('returns null for non-existent import', () => {
    const code = `import { useAuth } from './hooks'`
    const result = parseJSX('test.ts', code)!
    expect(findImportSource(result.program, 'useSomethingElse', result.lineStarts)).toBeNull()
  })
})

// ---- findExportedVariable ----

describe('findExportedVariable', () => {
  it('finds named export const', () => {
    const code = `export const COLORS = ['red', 'blue', 'green']`
    const result = parseJSX('test.ts', code)!
    const exp = findExportedVariable(result.program, 'COLORS', false, result.lineStarts)

    expect(exp).not.toBeNull()
    expect(exp!.isStatic).toBe(true)
    expect(exp!.line).toBe(1)
  })

  it('finds non-exported const (for same-file resolution)', () => {
    const code = `const items = [1, 2, 3]`
    const result = parseJSX('test.ts', code)!
    const exp = findExportedVariable(result.program, 'items', false, result.lineStarts)

    expect(exp).not.toBeNull()
    expect(exp!.isStatic).toBe(true)
  })

  it('detects non-static export', () => {
    const code = `export const data = fetchData()`
    const result = parseJSX('test.ts', code)!
    const exp = findExportedVariable(result.program, 'data', false, result.lineStarts)

    expect(exp).not.toBeNull()
    expect(exp!.isStatic).toBe(false)
  })
})

// ---- findReactiveObjectProperty ----

describe('findReactiveObjectProperty', () => {
  it('finds top-level property', () => {
    const code = `const state = reactive({ count: 0, name: 'test' })`
    const result = parseJSX('test.ts', code)!
    const prop = findReactiveObjectProperty(result.program, 'state', ['count'], result.lineStarts)

    expect(prop).not.toBeNull()
    // The range should point to the `0` literal
    expect(code.slice(prop!.range[0], prop!.range[1])).toBe('0')
  })

  it('finds nested property', () => {
    const code = `const state = reactive({
  user: {
    name: 'Dan',
    role: 'dev'
  }
})`
    const result = parseJSX('test.ts', code)!
    const prop = findReactiveObjectProperty(result.program, 'state', ['user', 'name'], result.lineStarts)

    expect(prop).not.toBeNull()
    expect(code.slice(prop!.range[0], prop!.range[1])).toBe("'Dan'")
  })

  it('finds deeply nested property', () => {
    const code = `const state = reactive({
  config: {
    display: {
      theme: 'dark'
    }
  }
})`
    const result = parseJSX('test.ts', code)!
    const prop = findReactiveObjectProperty(result.program, 'state', ['config', 'display', 'theme'], result.lineStarts)

    expect(prop).not.toBeNull()
    expect(code.slice(prop!.range[0], prop!.range[1])).toBe("'dark'")
  })

  it('returns null for non-existent property', () => {
    const code = `const state = reactive({ count: 0 })`
    const result = parseJSX('test.ts', code)!
    expect(findReactiveObjectProperty(result.program, 'state', ['missing'], result.lineStarts)).toBeNull()
  })

  it('returns null for non-reactive variable', () => {
    const code = `const state = { count: 0 }`
    const result = parseJSX('test.ts', code)!
    expect(findReactiveObjectProperty(result.program, 'state', ['count'], result.lineStarts)).toBeNull()
  })
})

// ---- traceJSXPropOrigins ----

describe('traceJSXPropOrigins', () => {
  it('traces identifier props to their declarations', () => {
    const code = `
import { COLORS } from './constants'
const title = 'My App'
function App() {
  return <Palette items={COLORS} title={title} count={42} />
}`
    const result = parseJSX('test.tsx', code)!
    // The JSX is on line 5
    const origins = traceJSXPropOrigins(result.program, 5, 3, result.lineStarts)

    expect(origins).not.toBeNull()
    expect(origins!.items).toBeDefined()
    expect(origins!.items.source).toBe('import')
    expect(origins!.items.importPath).toBe('./constants')

    expect(origins!.title).toBeDefined()
    expect(origins!.title.source).toBe('local')

    // count={42} is a literal, not an identifier — should not appear
    expect(origins!.count).toBeUndefined()
  })

  it('returns null when no identifier props found', () => {
    const code = `function App() {
  return <div className="test" count={42} />
}`
    const result = parseJSX('test.tsx', code)!
    const origins = traceJSXPropOrigins(result.program, 2, 3, result.lineStarts)
    expect(origins).toBeNull()
  })
})

// ---- findVueCallSites ----

describe('findVueCallSites', () => {
  it('extracts watch and watchEffect call lines', () => {
    const code = `const count = ref(0)
const name = ref('')
watch(count, (val) => console.log(val))
watchEffect(() => console.log(count.value))
`
    const result = parseJSX('test.ts', code)!
    const sites = findVueCallSites(result.program, 0, code.length, result.lineStarts)

    expect(sites.callLines['watch']).toEqual([3])
    expect(sites.callLines['watchEffect']).toEqual([4])
    expect(sites.provides).toEqual([])
  })

  it('extracts provide with string key', () => {
    const code = `const theme = reactive({ color: 'blue' })
provide('theme', theme)
provide('locale', 'en')
`
    const result = parseJSX('test.ts', code)!
    const sites = findVueCallSites(result.program, 0, code.length, result.lineStarts)

    expect(sites.provides).toEqual([
      { key: 'theme', line: 2 },
      { key: 'locale', line: 3 },
    ])
    expect(sites.callLines).toEqual({})
  })

  it('extracts provide with variable key (no key in result)', () => {
    const code = `const ThemeKey = Symbol('theme')
provide(ThemeKey, { color: 'blue' })
`
    const result = parseJSX('test.ts', code)!
    const sites = findVueCallSites(result.program, 0, code.length, result.lineStarts)

    expect(sites.provides).toEqual([
      { key: undefined, line: 2 },
    ])
  })

  it('handles mixed calls', () => {
    const code = `const count = ref(0)
watch(count, (v) => {})
provide('data', count)
watchEffect(() => console.log(count.value))
watchPostEffect(() => {})
`
    const result = parseJSX('test.ts', code)!
    const sites = findVueCallSites(result.program, 0, code.length, result.lineStarts)

    expect(sites.callLines['watch']).toEqual([2])
    expect(sites.callLines['watchEffect']).toEqual([4])
    expect(sites.callLines['watchPostEffect']).toEqual([5])
    expect(sites.provides).toEqual([{ key: 'data', line: 3 }])
  })

  it('respects body range boundaries', () => {
    const code = `watch(outside, () => {})
function setup() {
  watch(inside, () => {})
}
watch(alsoOutside, () => {})
`
    const result = parseJSX('test.ts', code)!
    // Only scan inside the function body
    const func = findFunctionDefinition(result.program, 'setup', result.lineStarts)!
    const sites = findVueCallSites(result.program, func.bodyRange[0], func.bodyRange[1], result.lineStarts)

    expect(sites.callLines['watch']).toEqual([3])
  })

  it('ignores non-tracked calls', () => {
    const code = `const count = ref(0)
const doubled = computed(() => count.value * 2)
onMounted(() => console.log('hi'))
`
    const result = parseJSX('test.ts', code)!
    const sites = findVueCallSites(result.program, 0, code.length, result.lineStarts)

    expect(sites.callLines).toEqual({})
    expect(sites.provides).toEqual([])
  })
})

// ---- extractCallbackRefNames (via findHookCallsDeep) ----

describe('refNames extraction', () => {
  it('extracts referenced identifiers from useEffect callback', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  const name = 'test'
  useEffect(() => { console.log(count, name) }, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect).toBeDefined()
    expect(effect!.refNames).toContain('count')
    expect(effect!.refNames).toContain('name')
  })

  it('filters out useState setters as stable', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  useEffect(() => { setCount(count + 1) }, [count])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect!.refNames).toContain('count')
    expect(effect!.refNames).not.toContain('setCount')
  })

  it('filters out useReducer dispatch as stable', () => {
    const code = `function App() {
  const [state, dispatch] = useReducer(reducer, init)
  useEffect(() => { dispatch({ type: 'reset' }) }, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect!.refNames).not.toContain('dispatch')
  })

  it('filters out useRef results as stable', () => {
    const code = `function App() {
  const ref = useRef(null)
  useEffect(() => { ref.current.focus() }, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect!.refNames).not.toContain('ref')
  })

  it('filters out module-scope imports', () => {
    const code = `import { api } from './api'
import React from 'react'

function App() {
  const [count, setCount] = useState(0)
  useEffect(() => { api.fetch(count) }, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect!.refNames).not.toContain('api')
    expect(effect!.refNames).not.toContain('React')
    expect(effect!.refNames).toContain('count')
  })

  it('filters out callback parameters', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  const handleClick = (e, val) => { console.log(e, val) }
  const handler = useCallback((e) => { handleClick(e, count) }, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const cb = deep.find(h => h.hookName === 'useCallback')
    expect(cb!.refNames).not.toContain('e')
    expect(cb!.refNames).toContain('handleClick')
    expect(cb!.refNames).toContain('count')
  })

  it('filters out variables declared inside the callback', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const local = count * 2
    const result = local + 1
    console.log(result)
  }, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect!.refNames).toContain('count')
    expect(effect!.refNames).not.toContain('local')
    expect(effect!.refNames).not.toContain('result')
  })

  it('returns undefined refNames for hooks without dep arrays', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
  useEffect(() => { console.log(count) })
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    expect(effect!.refNames).toBeUndefined()
  })

  it('returns undefined refNames for useState (no callback)', () => {
    const code = `function App() {
  const [count, setCount] = useState(0)
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const state = deep.find(h => h.hookName === 'useState')
    expect(state!.refNames).toBeUndefined()
  })

  it('extracts refs from useMemo callback', () => {
    const code = `function App() {
  const [a, setA] = useState(1)
  const [b, setB] = useState(2)
  const sum = useMemo(() => a + b, [a])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const memo = deep.find(h => h.hookName === 'useMemo')
    expect(memo!.refNames).toContain('a')
    expect(memo!.refNames).toContain('b')
    expect(memo!.refNames).not.toContain('setA')
    expect(memo!.refNames).not.toContain('setB')
  })

  it('handles non-inline callback (variable ref) gracefully', () => {
    const code = `function App() {
  const handler = () => {}
  useEffect(handler, [])
}`
    const result = parseJSX('test.tsx', code)!
    const comps = findComponentDeclarations(result.program, result.lineStarts)
    const deep = findHookCallsDeep(
      result.program, comps[0].bodyRange[0], comps[0].bodyRange[1], result.lineStarts,
    )

    const effect = deep.find(h => h.hookName === 'useEffect')
    // Can't extract refs from a variable reference, so refNames should be undefined
    expect(effect!.refNames).toBeUndefined()
  })
})
