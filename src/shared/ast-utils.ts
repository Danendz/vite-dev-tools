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

function offsetToLineCol(lineStarts: LineStarts, offset: number): { line: number; column: number } {
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
  /** Byte range of the function body (for scoping hook searches) */
  bodyRange: [number, number]
}

export interface HookCall {
  varName: string | null
  hookName: string
  line: number
  /** Byte range of the first argument (for rewriting initial values) */
  firstArgRange: [number, number] | null
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

export function findHookCalls(
  program: BaseNode,
  startOffset: number,
  endOffset: number,
  lineStarts?: LineStarts,
): HookCall[] {
  const hooks: HookCall[] = []
  const ls = lineStarts ?? [0]

  walkAST(program, (node, parent) => {
    if (node.type !== 'CallExpression') return
    if (node.range[0] < startOffset || node.range[1] > endOffset) return

    // Check callee is use*
    const callee = node.callee
    let hookName: string | null = null
    if (callee.type === 'Identifier' && /^use[A-Z]/.test(callee.name)) {
      hookName = callee.name
    } else if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier' && /^use[A-Z]/.test(callee.property.name)) {
      hookName = callee.property.name
    }
    if (!hookName) return

    // Extract variable name from parent VariableDeclarator
    let varName: string | null = null
    if (parent?.type === 'VariableDeclarator') {
      const id = parent.id
      if (id.type === 'Identifier') {
        varName = id.name
      } else if (id.type === 'ArrayPattern' && id.elements?.[0]?.type === 'Identifier') {
        varName = id.elements[0].name
      } else if (id.type === 'ObjectPattern' && id.properties?.[0]?.value?.type === 'Identifier') {
        varName = id.properties[0].value.name
      }
    }

    const firstArgRange = node.arguments?.[0]?.range ?? null

    hooks.push({
      varName,
      hookName,
      line: offsetToLineCol(ls, node.start).line,
      firstArgRange,
    })
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
