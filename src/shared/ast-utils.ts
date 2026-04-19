import { parseSync } from 'oxc-parser'

// ---- Types (ESTree-compatible subset used by OXC) ----

interface BaseNode {
  type: string
  range: [number, number]
  start: number
  end: number
  [key: string]: any
}

/** Pre-computed line start offsets for fast offset→line/column conversion */
type LineStarts = number[]

function buildLineStarts(code: string): LineStarts {
  const starts: number[] = [0]
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1)
  }
  return starts
}

export function offsetToLineCol(lineStarts: LineStarts, offset: number): { line: number; column: number } {
  let lo = 0, hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
}

export interface ComponentDeclaration {
  name: string
  line: number
  /** End line of the component function declaration */
  endLine: number
  /** Byte range of the function body (for scoping hook searches) */
  bodyRange: [number, number]
}

export interface HookCall {
  varName: string | null
  hookName: string
  line: number
  /** Byte range of the first argument (for rewriting initial values) */
  firstArgRange: [number, number] | null
  /** Dependency array variable names (for useEffect/useMemo/useCallback) */
  depNames?: string[]
  /** All destructured variable names when result is destructured (ObjectPattern/ArrayPattern) */
  destructuredNames?: string[]
  /** Identifiers referenced in callback body (for missing-dep detection) */
  refNames?: string[]
}

export interface JSXElementInfo {
  tagName: string
  /** Byte offset right after the tag name (insertion point for attributes) */
  nameEndOffset: number
  line: number
  col: number
  /** Names of existing attributes on the opening element */
  attributes: string[]
}

export interface StringLiteralInfo {
  range: [number, number]
  value: string
  raw: string
}

// ---- Core parsing ----

export function parseJSX(
  fileName: string,
  code: string,
): { program: BaseNode; errors: any[]; lineStarts: LineStarts } | null {
  try {
    const result = parseSync(fileName, code, { range: true })
    if (result.errors.length > 0) {
      const fatal = result.errors.filter((e: any) => e.severity === 'error')
      if (fatal.length > 0) return null
    }
    return { program: result.program as any, errors: result.errors, lineStarts: buildLineStarts(code) }
  } catch {
    return null
  }
}

// ---- AST walking ----

export function walkAST(node: any, visitor: (node: BaseNode, parent: BaseNode | null) => void, parent: BaseNode | null = null): void {
  if (!node || typeof node !== 'object') return
  if (node.type) {
    visitor(node as BaseNode, parent)
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'range' || key === 'loc' || key === 'start' || key === 'end' || key === 'raw') continue
    const val = node[key]
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && item.type) {
          walkAST(item, visitor, node.type ? node : parent)
        }
      }
    } else if (val && typeof val === 'object' && val.type) {
      walkAST(val, visitor, node.type ? node : parent)
    }
  }
}

// ---- String literal finder ----

export function findStringLiterals(
  root: BaseNode,
  startOffset: number,
  endOffset: number,
): StringLiteralInfo[] {
  const results: StringLiteralInfo[] = []
  walkAST(root, (node) => {
    if (
      node.type === 'Literal' &&
      typeof node.value === 'string' &&
      node.range[0] >= startOffset &&
      node.range[1] <= endOffset
    ) {
      results.push({ range: node.range, value: node.value, raw: node.raw })
    }
  })
  return results
}

// ---- Component declaration finder ----

export function findComponentDeclarations(program: BaseNode, lineStarts?: LineStarts): ComponentDeclaration[] {
  const components: ComponentDeclaration[] = []
  const ls = lineStarts ?? [0]

  for (const stmt of program.body || []) {
    // Unwrap export wrappers
    let decl: BaseNode | null = null
    if (stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportNamedDeclaration') {
      decl = stmt.declaration
    } else {
      decl = stmt
    }
    if (!decl) continue

    // function MyComponent() { ... }
    if (decl.type === 'FunctionDeclaration' && decl.id?.name && /^[A-Z]/.test(decl.id.name)) {
      components.push({
        name: decl.id.name,
        line: offsetToLineCol(ls, decl.start).line,
        endLine: offsetToLineCol(ls, decl.end).line,
        bodyRange: decl.body?.range ?? decl.range,
      })
      continue
    }

    // const MyComponent = () => { ... }  /  const MyComponent = function() { ... }
    // Also: const MyComponent = memo(() => { ... })  /  const MyComponent = forwardRef(...)
    if (decl.type === 'VariableDeclaration') {
      for (const declarator of decl.declarations || []) {
        const name = declarator.id?.name
        if (!name || !/^[A-Z]/.test(name)) continue

        const init = declarator.init
        if (!init) continue

        const funcNode = unwrapComponentInit(init)
        if (funcNode) {
          components.push({
            name,
            line: offsetToLineCol(ls, decl.start).line,
            endLine: offsetToLineCol(ls, decl.end).line,
            bodyRange: funcNode.body?.range ?? funcNode.range,
          })
        }
      }
    }
  }

  return components
}

/** Unwrap HOC wrappers like memo(), forwardRef(), React.memo() to find the inner function */
function unwrapComponentInit(node: BaseNode): BaseNode | null {
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    return node
  }
  // memo(fn), forwardRef(fn), React.memo(fn), etc.
  if (node.type === 'CallExpression' && node.arguments?.length > 0) {
    const callee = node.callee
    const isHOC =
      (callee.type === 'Identifier' && /^(memo|forwardRef|observer|styled)/.test(callee.name)) ||
      (callee.type === 'MemberExpression' && callee.property?.name && /^(memo|forwardRef)/.test(callee.property.name))
    if (isHOC) {
      return unwrapComponentInit(node.arguments[0])
    }
  }
  return null
}

// ---- Hook call finder ----

const DEFAULT_HOOK_FILTER = (name: string) => /^use[A-Z]/.test(name)

export function findHookCalls(
  program: BaseNode,
  startOffset: number,
  endOffset: number,
  lineStarts?: LineStarts,
  options?: { callFilter?: (name: string) => boolean },
): HookCall[] {
  const hooks: HookCall[] = []
  const ls = lineStarts ?? [0]
  const matchCall = options?.callFilter ?? DEFAULT_HOOK_FILTER

  walkAST(program, (node, parent) => {
    if (node.type !== 'CallExpression') return
    if (node.range[0] < startOffset || node.range[1] > endOffset) return

    // Check callee matches filter
    const callee = node.callee
    let hookName: string | null = null
    if (callee.type === 'Identifier' && matchCall(callee.name)) {
      hookName = callee.name
    } else if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier' && matchCall(callee.property.name)) {
      hookName = callee.property.name
    }
    if (!hookName) return

    // Extract variable name from parent VariableDeclarator
    let varName: string | null = null
    let destructuredNames: string[] | undefined
    if (parent?.type === 'VariableDeclarator') {
      const id = parent.id
      if (id.type === 'Identifier') {
        varName = id.name
      } else if (id.type === 'ArrayPattern') {
        if (id.elements?.[0]?.type === 'Identifier') varName = id.elements[0].name
        destructuredNames = (id.elements || [])
          .filter((el: any) => el?.type === 'Identifier')
          .map((el: any) => el.name)
      } else if (id.type === 'ObjectPattern') {
        if (id.properties?.[0]?.value?.type === 'Identifier') varName = id.properties[0].value.name
        destructuredNames = (id.properties || [])
          .map((p: any) => p.type === 'RestElement' ? p.argument : p.value)
          .filter((v: any) => v?.type === 'Identifier')
          .map((v: any) => v.name)
      }
    }

    const firstArgRange = node.arguments?.[0]?.range ?? null

    const hook: HookCall = {
      varName,
      hookName,
      line: offsetToLineCol(ls, node.start).line,
      firstArgRange,
    }
    if (destructuredNames?.length) hook.destructuredNames = destructuredNames

    // Extract dep array for effect/memo/callback hooks
    if (HOOKS_WITH_DEPS.has(hookName)) {
      const depArgIndex = hookName === 'useImperativeHandle' ? 2 : 1
      const depsArg = node.arguments?.[depArgIndex]
      if (depsArg?.type === 'ArrayExpression') {
        hook.depNames = extractDepNames(depsArg)
      }
    }

    hooks.push(hook)
  })

  return hooks
}

// ---- JSX opening element finder ----

export function findJSXOpeningElements(
  program: BaseNode,
  filter: (tagName: string) => boolean,
  lineStarts?: LineStarts,
): JSXElementInfo[] {
  const elements: JSXElementInfo[] = []
  const ls = lineStarts ?? [0]

  walkAST(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return
    if (node.name?.type !== 'JSXIdentifier') return
    const tagName = node.name.name
    if (!filter(tagName)) return

    const attrNames: string[] = []
    for (const attr of node.attributes || []) {
      if (attr.type === 'JSXAttribute' && attr.name?.type === 'JSXIdentifier') {
        attrNames.push(attr.name.name)
      }
    }

    const pos = offsetToLineCol(ls, node.start)
    elements.push({
      tagName,
      nameEndOffset: node.name.range[1],
      line: pos.line,
      col: pos.column,
      attributes: attrNames,
    })
  })

  return elements
}

// ---- JSX attribute finder (for prop rewriting) ----

export interface JSXAttributeInfo {
  propKey: string
  /** Range of the full attribute value (the Literal or JSXExpressionContainer) */
  valueRange: [number, number]
  /** If value is a JSXExpressionContainer, the range of the inner expression */
  expressionRange: [number, number] | null
  /** If the value is a simple string literal (not expression), its range */
  stringLiteralRange: [number, number] | null
  line: number
}

export function findJSXAttribute(
  program: BaseNode,
  propKey: string,
  nearLine: number,
  lineWindow: number = 5,
  lineStarts?: LineStarts,
): JSXAttributeInfo | null {
  let best: JSXAttributeInfo | null = null
  let bestDist = Infinity
  const ls = lineStarts ?? [0]

  walkAST(program, (node) => {
    if (node.type !== 'JSXAttribute') return
    if (node.name?.type !== 'JSXIdentifier' || node.name.name !== propKey) return
    if (!node.value) return

    const line = offsetToLineCol(ls, node.start).line
    const dist = Math.abs(line - nearLine)
    if (dist > lineWindow || dist >= bestDist) return

    let expressionRange: [number, number] | null = null
    let stringLiteralRange: [number, number] | null = null

    if (node.value.type === 'JSXExpressionContainer' && node.value.expression) {
      expressionRange = node.value.expression.range
    } else if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
      stringLiteralRange = node.value.range
    }

    best = {
      propKey,
      valueRange: node.value.range,
      expressionRange,
      stringLiteralRange,
      line,
    }
    bestDist = dist
  })

  return best
}

// ---- Constants for hook analysis ----

/** React hooks that accept a dependency array */
const HOOKS_WITH_DEPS = new Set([
  'useEffect', 'useLayoutEffect', 'useInsertionEffect',
  'useCallback', 'useMemo', 'useImperativeHandle',
])

/** React built-in hooks — these are leaf nodes, never recursed into */
export const REACT_BUILT_IN_HOOKS = new Set([
  'useState', 'useEffect', 'useLayoutEffect', 'useInsertionEffect',
  'useRef', 'useCallback', 'useMemo', 'useReducer', 'useContext',
  'useImperativeHandle', 'useDebugValue', 'useDeferredValue',
  'useTransition', 'useId', 'useSyncExternalStore',
  'useOptimistic', 'useActionState', 'useFormStatus', 'use',
])

/** Vue built-in composable functions — leaf nodes for Vue composable introspection */
export const VUE_BUILT_IN_COMPOSABLES = new Set([
  'ref', 'reactive', 'computed', 'watch', 'watchEffect',
  'watchPostEffect', 'watchSyncEffect', 'shallowRef', 'shallowReactive',
  'readonly', 'shallowReadonly', 'toRef', 'toRefs', 'toRaw',
  'markRaw', 'triggerRef', 'customRef', 'unref', 'isRef', 'isReactive',
  'isReadonly', 'isProxy', 'provide', 'inject',
  'onMounted', 'onUpdated', 'onUnmounted', 'onBeforeMount',
  'onBeforeUpdate', 'onBeforeUnmount', 'onErrorCaptured',
  'onActivated', 'onDeactivated', 'onRenderTracked', 'onRenderTriggered',
  'onServerPrefetch', 'useAttrs', 'useSlots', 'useCssModule',
  'useCssVars', 'useTemplateRef', 'useId', 'useModel',
  'defineProps', 'defineEmits', 'defineExpose', 'defineOptions',
  'defineSlots', 'defineModel', 'withDefaults',
])

// ---- Dep array extraction ----

/** Extract variable names from a dependency array expression */
function extractDepNames(arrayExpr: BaseNode): string[] {
  const names: string[] = []
  for (const el of arrayExpr.elements || []) {
    if (!el) { names.push('_'); continue }
    if (el.type === 'Identifier') {
      names.push(el.name)
    } else if (el.type === 'MemberExpression') {
      names.push(memberExprToString(el))
    } else {
      names.push('?')
    }
  }
  return names
}

function memberExprToString(node: BaseNode): string {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression') {
    const obj = memberExprToString(node.object)
    if (node.computed) return `${obj}[${memberExprToString(node.property)}]`
    return `${obj}.${node.property?.name ?? '?'}`
  }
  return '?'
}

// ---- Callback reference extraction (for missing-dep detection) ----

/** Collect all module-scope import names from the program */
function collectImportNames(program: BaseNode): Set<string> {
  const names = new Set<string>()
  for (const stmt of program.body || []) {
    if (stmt.type !== 'ImportDeclaration') continue
    for (const spec of stmt.specifiers || []) {
      if (spec.local?.name) names.add(spec.local.name)
    }
  }
  return names
}

/** Collect all identifiers declared inside a function body (params, const/let/var, for-vars, catch) */
function collectLocalDeclarations(node: BaseNode): Set<string> {
  const locals = new Set<string>()

  // Collect function params
  if (node.params) {
    for (const p of node.params) {
      collectBindingNames(p, locals)
    }
  }

  // Walk the body for local declarations
  const body = node.body
  if (body) {
    walkAST(body, (n) => {
      if (n.type === 'VariableDeclaration') {
        for (const d of n.declarations || []) {
          if (d.id) collectBindingNames(d.id, locals)
        }
      } else if (n.type === 'FunctionDeclaration' && n.id?.name) {
        locals.add(n.id.name)
      } else if (n.type === 'CatchClause' && n.param) {
        collectBindingNames(n.param, locals)
      }
    })
  }

  return locals
}

/** Extract binding names from destructuring patterns and identifiers */
function collectBindingNames(node: BaseNode, names: Set<string>): void {
  if (!node) return
  if (node.type === 'Identifier') {
    names.add(node.name)
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements || []) {
      if (el) collectBindingNames(el, names)
    }
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties || []) {
      if (prop.type === 'RestElement') {
        collectBindingNames(prop.argument, names)
      } else if (prop.value) {
        collectBindingNames(prop.value, names)
      }
    }
  } else if (node.type === 'RestElement') {
    collectBindingNames(node.argument, names)
  } else if (node.type === 'AssignmentPattern') {
    collectBindingNames(node.left, names)
  }
}

/**
 * Extract identifiers referenced in a hook callback body that are component-scope variables.
 * Filters out: callback params, locals declared inside callback, stable React idents,
 * module imports, globals, and anything not declared in the component scope.
 */
export function extractCallbackRefNames(
  callbackNode: BaseNode,
  stableIdents: Set<string>,
  importNames: Set<string>,
  componentScopeNames: Set<string>,
): string[] {
  const refs = new Set<string>()
  const localDecls = collectLocalDeclarations(callbackNode)

  const body = callbackNode.body
  if (!body) return []

  walkAST(body, (node, parent) => {
    if (node.type !== 'Identifier') return
    // Skip property access names (x.foo — skip foo, keep x)
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return
    // Skip object literal keys
    if (parent?.type === 'Property' && parent.key === node && !parent.computed) return
    // Skip function declaration names
    if (parent?.type === 'FunctionDeclaration' && parent.id === node) return
    // Skip variable declarator names (left side of const x = ...)
    if (parent?.type === 'VariableDeclarator' && parent.id === node) return

    refs.add(node.name)
  })

  // Filter: only keep identifiers that are in component scope, not locals/stable/imports
  const result: string[] = []
  for (const name of refs) {
    if (localDecls.has(name)) continue
    if (stableIdents.has(name)) continue
    if (importNames.has(name)) continue
    if (!componentScopeNames.has(name)) continue
    result.push(name)
  }
  return result.sort()
}

/** Collect function parameter names from the component function that contains the given offset */
function collectComponentParams(program: BaseNode, bodyStartOffset: number, out: Set<string>): void {
  walkAST(program, (node) => {
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
      node.body?.range?.[0] === bodyStartOffset &&
      node.params
    ) {
      for (const p of node.params) {
        collectBindingNames(p, out)
      }
    }
  })
}

/** Find the callback function node at a given range (first argument of a hook call) */
function findCallbackNode(program: BaseNode, range: [number, number]): BaseNode | null {
  let result: BaseNode | null = null
  walkAST(program, (node) => {
    if (result) return
    if (
      (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
      node.range[0] === range[0] && node.range[1] === range[1]
    ) {
      result = node
    }
  })
  return result
}

// ---- Deep hook/composable introspection ----

export interface HookMeta {
  varName: string | null
  hookName: string
  line: number
  firstArgRange: [number, number] | null
  depNames?: string[]
  /** All destructured variable names from the call site */
  destructuredNames?: string[]
  /** Nested hooks inside a custom hook (recursive) */
  innerHooks?: HookMeta[]
  /** Identifiers referenced in callback body (for missing-dep detection) */
  refNames?: string[]
  /** Non-hook local variable declarations inside this composable's body */
  locals?: LocalVarMeta[]
  /** Source file path if the hook is defined in a different file */
  sourceFile?: string
}

export interface ResolvedHookSource {
  program: BaseNode
  bodyRange: [number, number]
  lineStarts: LineStarts
  sourceFile: string
}

/**
 * Recursively find hook calls, introspecting custom hooks to build a tree.
 * Built-in hooks are leaf nodes. Custom hooks are recursed into if their
 * definition can be found (same file or via resolveHook callback).
 */
export function findHookCallsDeep(
  program: BaseNode,
  startOffset: number,
  endOffset: number,
  lineStarts?: LineStarts,
  options?: {
    builtIns?: Set<string>
    callFilter?: (name: string) => boolean
    resolveHook?: (hookName: string) => ResolvedHookSource | null
    _visited?: Set<string>
  },
): HookMeta[] {
  const builtIns = options?.builtIns ?? REACT_BUILT_IN_HOOKS
  const callFilter = options?.callFilter
  const visited = options?._visited ?? new Set<string>()
  const ls = lineStarts

  const calls = findHookCalls(program, startOffset, endOffset, ls, callFilter ? { callFilter } : undefined)

  // Build stable-idents set: useState setters, useReducer dispatches, useRef results
  const stableIdents = new Set<string>()
  for (const c of calls) {
    if (c.hookName === 'useState' || c.hookName === 'useReducer') {
      // Second destructured name is the setter/dispatch (stable by React guarantee)
      if (c.destructuredNames && c.destructuredNames.length >= 2) {
        stableIdents.add(c.destructuredNames[1])
      }
    } else if (c.hookName === 'useRef') {
      // useRef result is stable
      if (c.varName) stableIdents.add(c.varName)
    }
  }

  // Collect module-scope import names (for filtering out imports in callback refs)
  const importNames = collectImportNames(program)

  // Collect all names declared in the component body scope (variables, function params, etc.)
  // Used to whitelist refs — only identifiers declared in the component scope are valid refs.
  // This automatically filters out globals like console, window, document, etc.
  const componentScopeNames = new Set<string>()
  for (const c of calls) {
    if (c.varName) componentScopeNames.add(c.varName)
    if (c.destructuredNames) {
      for (const n of c.destructuredNames) componentScopeNames.add(n)
    }
  }
  // Also collect non-hook variable declarations in the component scope
  const localVars = findLocalVarDeclarations(program, startOffset, endOffset, ls)
  for (const lv of localVars) componentScopeNames.add(lv.name)
  // Also collect function parameters (props, etc.)
  collectComponentParams(program, startOffset, componentScopeNames)

  return calls.map(call => {
    const meta: HookMeta = {
      varName: call.varName,
      hookName: call.hookName,
      line: call.line,
      firstArgRange: call.firstArgRange,
      depNames: call.depNames,
      destructuredNames: call.destructuredNames,
    }

    // Extract referenced identifiers from callback body (for missing-dep detection)
    // Only extract when the hook has a dep array (depNames exists) — hooks without
    // dep arrays run on every render, so missing-dep detection doesn't apply.
    if (HOOKS_WITH_DEPS.has(call.hookName) && call.depNames && call.firstArgRange) {
      // Find the callback AST node (first argument of the hook call)
      const callbackNode = findCallbackNode(program, call.firstArgRange)
      if (callbackNode) {
        meta.refNames = extractCallbackRefNames(callbackNode, stableIdents, importNames, componentScopeNames)
      }
    }

    // If this is a custom hook (not built-in), try to introspect it
    if (!builtIns.has(call.hookName) && !visited.has(call.hookName)) {
      visited.add(call.hookName)

      // Try same-file resolution first
      const funcDef = findFunctionDefinition(program, call.hookName, ls)
      if (funcDef) {
        meta.innerHooks = findHookCallsDeep(
          program, funcDef.bodyRange[0], funcDef.bodyRange[1],
          ls, { builtIns, callFilter, resolveHook: options?.resolveHook, _visited: visited },
        )
        meta.locals = findLocalVarDeclarations(program, funcDef.bodyRange[0], funcDef.bodyRange[1], ls)
      } else if (options?.resolveHook) {
        const resolved = options.resolveHook(call.hookName)
        if (resolved) {
          meta.sourceFile = resolved.sourceFile
          meta.innerHooks = findHookCallsDeep(
            resolved.program, resolved.bodyRange[0], resolved.bodyRange[1],
            resolved.lineStarts, { builtIns, callFilter, resolveHook: options?.resolveHook, _visited: visited },
          )
          meta.locals = findLocalVarDeclarations(
            resolved.program, resolved.bodyRange[0], resolved.bodyRange[1], resolved.lineStarts,
          )
        }
      }

      visited.delete(call.hookName) // allow same hook name in different call positions
    }

    return meta
  })
}

/**
 * Find a function/arrow function declaration by name in the module scope.
 * Used to resolve custom hooks defined in the same file.
 */
export function findFunctionDefinition(
  program: BaseNode,
  name: string,
  lineStarts?: LineStarts,
): { bodyRange: [number, number]; line: number } | null {
  const ls = lineStarts ?? [0]

  for (const stmt of program.body || []) {
    let decl = stmt
    if (stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportNamedDeclaration') {
      decl = stmt.declaration
    }
    if (!decl) continue

    if (decl.type === 'FunctionDeclaration' && decl.id?.name === name && decl.body) {
      return { bodyRange: decl.body.range, line: offsetToLineCol(ls, decl.start).line }
    }

    if (decl.type === 'VariableDeclaration') {
      for (const declarator of decl.declarations || []) {
        if (declarator.id?.name !== name || !declarator.init) continue
        const func = declarator.init
        if (func.type === 'ArrowFunctionExpression' || func.type === 'FunctionExpression') {
          return { bodyRange: func.body.range, line: offsetToLineCol(ls, decl.start).line }
        }
      }
    }
  }
  return null
}

// ---- Local variable finder ----

export interface LocalVarMeta {
  name: string
  line: number
}

/**
 * Find local variable declarations in a component body that are NOT hook calls.
 * Returns variable names with line numbers for jump-to-source.
 */
export function findLocalVarDeclarations(
  program: BaseNode,
  startOffset: number,
  endOffset: number,
  lineStarts?: LineStarts,
): LocalVarMeta[] {
  const locals: LocalVarMeta[] = []
  const ls = lineStarts ?? [0]

  walkAST(program, (node) => {
    if (node.type !== 'VariableDeclaration') return
    if (node.range[0] < startOffset || node.range[1] > endOffset) return

    for (const declarator of node.declarations || []) {
      if (!declarator.id || !declarator.init) continue

      // Skip hook calls (already handled by hook finder)
      if (declarator.init.type === 'CallExpression') {
        const callee = declarator.init.callee
        if (callee?.type === 'Identifier' && /^use[A-Z]/.test(callee.name)) continue
        if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier' && /^use[A-Z]/.test(callee.property.name)) continue
        // Vue composables
        if (callee?.type === 'Identifier' && VUE_BUILT_IN_COMPOSABLES.has(callee.name)) continue
      }

      // Skip await expressions wrapping hook calls
      if (declarator.init.type === 'AwaitExpression' && declarator.init.argument?.type === 'CallExpression') {
        const callee = declarator.init.argument.callee
        if (callee?.type === 'Identifier' && /^use[A-Z]/.test(callee.name)) continue
      }

      const id = declarator.id
      if (id.type === 'Identifier') {
        // Skip PascalCase (likely components, not variables)
        if (/^[A-Z]/.test(id.name)) continue
        locals.push({ name: id.name, line: offsetToLineCol(ls, declarator.start).line })
      } else if (id.type === 'ArrayPattern') {
        for (const el of id.elements || []) {
          if (el?.type === 'Identifier' && !/^[A-Z]/.test(el.name)) {
            locals.push({ name: el.name, line: offsetToLineCol(ls, declarator.start).line })
          }
        }
      } else if (id.type === 'ObjectPattern') {
        for (const prop of id.properties || []) {
          const val = prop.type === 'RestElement' ? prop.argument : prop.value
          if (val?.type === 'Identifier' && !/^[A-Z]/.test(val.name)) {
            locals.push({ name: val.name, line: offsetToLineCol(ls, declarator.start).line })
          }
        }
      }
    }
  })

  return locals
}

// ---- Prop origin tracing ----

export interface PropOriginInfo {
  source: 'local' | 'import'
  varName: string
  line: number
  /** Import source path (for imports) */
  importPath?: string
  /** Whether the initializer is a static literal/array/object */
  isStatic: boolean
}

/**
 * Trace a variable name to its declaration (local const/let/var or import).
 * Used to determine where a JSX prop value comes from.
 */
export function traceIdentifierToDeclaration(
  program: BaseNode,
  identName: string,
  lineStarts?: LineStarts,
): PropOriginInfo | null {
  const ls = lineStarts ?? [0]

  // Check imports first
  for (const stmt of program.body || []) {
    if (stmt.type !== 'ImportDeclaration' || !stmt.source?.value) continue
    for (const spec of stmt.specifiers || []) {
      if (
        (spec.type === 'ImportSpecifier' || spec.type === 'ImportDefaultSpecifier') &&
        spec.local?.name === identName
      ) {
        return {
          source: 'import',
          varName: identName,
          line: offsetToLineCol(ls, stmt.start).line,
          importPath: stmt.source.value,
          isStatic: false, // can't know without resolving
        }
      }
    }
  }

  // Check local declarations
  for (const stmt of program.body || []) {
    let decl = stmt
    if (stmt.type === 'ExportNamedDeclaration') decl = stmt.declaration
    if (!decl || decl.type !== 'VariableDeclaration') continue

    for (const declarator of decl.declarations || []) {
      if (declarator.id?.type === 'Identifier' && declarator.id.name === identName) {
        return {
          source: 'local',
          varName: identName,
          line: offsetToLineCol(ls, declarator.start).line,
          isStatic: declarator.init ? isStaticInitializer(declarator.init) : false,
        }
      }
    }
  }

  return null
}

function isStaticInitializer(node: BaseNode): boolean {
  if (!node) return false
  if (node.type === 'Literal') return true
  if (node.type === 'ArrayExpression') {
    return (node.elements || []).every((el: any) => el && isStaticInitializer(el))
  }
  if (node.type === 'ObjectExpression') {
    return (node.properties || []).every((p: any) =>
      p.type === 'Property' && isStaticInitializer(p.value),
    )
  }
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'Literal') {
    return true
  }
  if (node.type === 'TemplateLiteral' && (!node.expressions || node.expressions.length === 0)) {
    return true
  }
  return false
}

// ---- Import resolution ----

/**
 * Find an import statement for a given identifier in the program AST.
 * Returns the import source path and line number.
 */
export function findImportSource(
  program: BaseNode,
  name: string,
  lineStarts?: LineStarts,
): { importPath: string; line: number; isDefault: boolean } | null {
  const ls = lineStarts ?? [0]
  for (const stmt of program.body || []) {
    if (stmt.type !== 'ImportDeclaration' || !stmt.source?.value) continue
    for (const spec of stmt.specifiers || []) {
      if (spec.type === 'ImportSpecifier' && spec.local?.name === name) {
        return { importPath: stmt.source.value, line: offsetToLineCol(ls, stmt.start).line, isDefault: false }
      }
      if (spec.type === 'ImportDefaultSpecifier' && spec.local?.name === name) {
        return { importPath: stmt.source.value, line: offsetToLineCol(ls, stmt.start).line, isDefault: true }
      }
    }
  }
  return null
}

/**
 * Find an exported variable declaration in a parsed program.
 * Returns the variable's initializer range for rewriting.
 */
export function findExportedVariable(
  program: BaseNode,
  name: string,
  isDefault: boolean,
  lineStarts?: LineStarts,
): { initRange: [number, number]; line: number; isStatic: boolean } | null {
  const ls = lineStarts ?? [0]

  for (const stmt of program.body || []) {
    // export default <value>
    if (isDefault && stmt.type === 'ExportDefaultDeclaration' && stmt.declaration) {
      const decl = stmt.declaration
      if (decl.type === 'Literal' || decl.type === 'ArrayExpression' || decl.type === 'ObjectExpression') {
        return { initRange: decl.range, line: offsetToLineCol(ls, stmt.start).line, isStatic: isStaticInitializer(decl) }
      }
    }

    // export const X = ... or const X = ... (with separate export)
    let varDecl = stmt
    if (stmt.type === 'ExportNamedDeclaration') varDecl = stmt.declaration
    if (!varDecl || varDecl.type !== 'VariableDeclaration') continue

    for (const declarator of varDecl.declarations || []) {
      if (declarator.id?.type === 'Identifier' && declarator.id.name === name && declarator.init) {
        return {
          initRange: declarator.init.range,
          line: offsetToLineCol(ls, declarator.start).line,
          isStatic: isStaticInitializer(declarator.init),
        }
      }
    }
  }
  return null
}

// ---- Vue reactive() property finder ----

/**
 * Find a nested property value in a reactive() object literal for rewriting.
 * Given `const state = reactive({ user: { name: 'Dan' } })` and path ['user', 'name'],
 * returns the range of 'Dan' for source splicing.
 */
export function findReactiveObjectProperty(
  program: BaseNode,
  varName: string,
  propertyPath: string[],
  lineStarts?: LineStarts,
): { range: [number, number]; line: number } | null {
  const ls = lineStarts ?? [0]

  // Find the variable declaration
  let objectExpr: BaseNode | null = null
  walkAST(program, (node) => {
    if (objectExpr) return // already found
    if (node.type !== 'VariableDeclarator') return
    if (node.id?.type !== 'Identifier' || node.id.name !== varName) return
    // Check if init is reactive(...)
    const init = node.init
    if (init?.type === 'CallExpression' && init.callee?.type === 'Identifier' && init.callee.name === 'reactive') {
      const arg = init.arguments?.[0]
      if (arg?.type === 'ObjectExpression') {
        objectExpr = arg
      }
    }
  })

  if (!objectExpr) return null

  // Walk the property path
  let current: BaseNode = objectExpr
  for (const key of propertyPath) {
    if (current.type !== 'ObjectExpression') return null
    const prop = (current.properties || []).find((p: any) =>
      p.type === 'Property' &&
      ((p.key?.type === 'Identifier' && p.key.name === key) ||
       (p.key?.type === 'Literal' && p.key.value === key)),
    )
    if (!prop) return null
    current = prop.value
  }

  return { range: current.range, line: offsetToLineCol(ls, current.start).line }
}

// ---- JSX prop value tracing ----

/**
 * For each prop on a JSX element, check if the value is a variable reference
 * and trace it to its declaration. Returns a map of propKey → PropOriginInfo.
 */
export function traceJSXPropOrigins(
  program: BaseNode,
  nearLine: number,
  lineWindow: number = 3,
  lineStarts?: LineStarts,
): Record<string, PropOriginInfo> | null {
  const ls = lineStarts ?? [0]
  const origins: Record<string, PropOriginInfo> = {}
  let found = false

  walkAST(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return
    const line = offsetToLineCol(ls, node.start).line
    if (Math.abs(line - nearLine) > lineWindow) return

    for (const attr of node.attributes || []) {
      if (attr.type !== 'JSXAttribute') continue
      if (!attr.name?.name || !attr.value) continue
      const propKey = attr.name.name

      // Only trace expression props with identifier values: prop={varName}
      if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression?.type === 'Identifier') {
        const identName = attr.value.expression.name
        const origin = traceIdentifierToDeclaration(program, identName, ls)
        if (origin) {
          origins[propKey] = origin
          found = true
        }
      }
    }
  })

  return found ? origins : null
}

// ---- Vue call site extraction (watch/provide) ----

export interface VueCallSites {
  callLines: Record<string, number[]>
  provides: Array<{ key?: string; line: number }>
}

const VUE_TRACKED_CALLS = new Set(['watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect', 'provide'])

/**
 * Find watch/watchEffect/provide call sites within a scope range.
 * Returns watcher call line numbers (for index-based matching with runtime effects)
 * and provide entries with optional string key (for key-based matching).
 */
export function findVueCallSites(program: BaseNode, bodyStart: number, bodyEnd: number, lineStarts: LineStarts): VueCallSites {
  const callLines: Record<string, number[]> = {}
  const provides: VueCallSites['provides'] = []

  walkAST(program, (node) => {
    if (node.start < bodyStart || node.start > bodyEnd) return
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    if (callee?.type !== 'Identifier' || !VUE_TRACKED_CALLS.has(callee.name)) return

    const line = offsetToLineCol(lineStarts, node.start).line

    if (callee.name === 'provide') {
      const firstArg = node.arguments?.[0]
      const key = firstArg?.type === 'StringLiteral' || (firstArg?.type === 'Literal' && typeof firstArg.value === 'string')
        ? firstArg.value
        : undefined
      provides.push({ key: typeof key === 'string' ? key : undefined, line })
    } else {
      if (!callLines[callee.name]) callLines[callee.name] = []
      callLines[callee.name].push(line)
    }
  })

  return { callLines, provides }
}

// ---- Source splicing ----

export function spliceSource(code: string, edits: Array<{ start: number; end: number; replacement: string }>): string {
  // Sort edits in reverse order to preserve positions
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let result = code
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}
