import fs from 'node:fs'
import path from 'node:path'
import type { FrameworkAdapter, RewriteEdit } from '../../core/adapter'
import { ENDPOINTS } from '../../shared/constants'
import { HOOK_SCRIPT } from './hook'
import {
  parseJSX,
  findComponentDeclarations as findComponentDeclarationsAST,
  findHookCalls,
  findJSXOpeningElements,
  findJSXAttribute,
  findStringLiterals,
  spliceSource,
} from '../../shared/ast-utils'
import { undoStore } from '../../shared/undo-store'
import { buildDiff } from '../../shared/diff'

/**
 * Detect installed React major version from node_modules.
 */
function detectReactMajorVersion(projectRoot: string): number {
  try {
    const pkgPath = require.resolve('react/package.json', { paths: [projectRoot] })
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return parseInt(pkg.version, 10)
  } catch {
    return 0
  }
}

/**
 * Per-instance state for the React adapter.
 * Uses a module-level variable but is only mutated by detectVersion which runs once per plugin.
 */
let reactMajor = 0

// ---- Regex fallbacks (kept for robustness when AST parsing fails) ----

function findComponentDeclarationsRegex(code: string): Array<{ name: string; line: number }> {
  const components: Array<{ name: string; line: number }> = []
  const lines = code.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fnMatch = line.match(/(?:export\s+(?:default\s+)?)?function\s+([A-Z][a-zA-Z0-9_]*)\s*[\(<]/)
    if (fnMatch) {
      components.push({ name: fnMatch[1], line: i + 1 })
      continue
    }

    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Z][a-zA-Z0-9_]*)\s*[=:]/)
    if (arrowMatch) {
      components.push({ name: arrowMatch[1], line: i + 1 })
    }
  }

  return components
}

function findHookNamesRegex(code: string, componentLine: number): { varName: string | null; line: number }[] | null {
  const lines = code.split('\n')
  const hooks: { varName: string | null; line: number }[] = []

  for (let i = componentLine; i < lines.length; i++) {
    const line = lines[i]

    if (i > componentLine && /^(?:export\s+)?(?:function|const|let|var)\s+[A-Z]/.test(line)) break

    const arrayMatch = line.match(/(?:const|let|var)\s+\[(\w+).*?\]\s*=\s*(use\w+)\s*[\(<]/)
    if (arrayMatch) {
      hooks.push({ varName: arrayMatch[1], line: i + 1 })
      continue
    }

    const objMatch = line.match(/(?:const|let|var)\s+\{(\w+).*?\}\s*=\s*(use\w+)\s*[\(<]/)
    if (objMatch) {
      hooks.push({ varName: objMatch[1], line: i + 1 })
      continue
    }

    const simpleMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(use\w+)\s*[\(<]/)
    if (simpleMatch) {
      hooks.push({ varName: simpleMatch[1], line: i + 1 })
      continue
    }

    const bareMatch = line.match(/^\s*(use\w+)\s*\(/)
    if (bareMatch) {
      hooks.push({ varName: null, line: i + 1 })
    }
  }

  return hooks.length > 0 ? hooks : null
}

// ---- AST-based implementations with regex fallback ----

interface ComponentInfo {
  name: string
  line: number
  bodyRange?: [number, number]
}

interface ParsedFile {
  components: ComponentInfo[]
  program: any
  lineStarts: number[] | null
}

/**
 * Parse a file with OXC and extract component declarations and hook names.
 * Falls back to regex on parse failure.
 */
function parseFileComponents(code: string, id: string): ParsedFile {
  const parsed = parseJSX(id, code)
  if (parsed) {
    const astComponents = findComponentDeclarationsAST(parsed.program, parsed.lineStarts)
    return {
      components: astComponents.map(c => ({ name: c.name, line: c.line, bodyRange: c.bodyRange })),
      program: parsed.program,
      lineStarts: parsed.lineStarts,
    }
  }
  // Fallback to regex
  return {
    components: findComponentDeclarationsRegex(code),
    program: null,
    lineStarts: null,
  }
}

function getHookNames(
  code: string,
  componentLine: number,
  program: any,
  bodyRange?: [number, number],
  lineStarts?: number[] | null,
): { varName: string | null; line: number }[] | null {
  if (program && bodyRange) {
    const hooks = findHookCalls(program, bodyRange[0], bodyRange[1], lineStarts ?? undefined)
    if (hooks.length > 0) {
      return hooks.map(h => ({ varName: h.varName, line: h.line }))
    }
    return null
  }
  // Fallback to regex
  return findHookNamesRegex(code, componentLine)
}

/** Known HTML element names — only inject __source on these to avoid false positives on lowercase component refs */
const HTML_ELEMENTS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
  'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
  'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
  'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
  'i', 'iframe', 'img', 'input', 'ins',
  'kbd',
  'label', 'legend', 'li', 'link',
  'main', 'map', 'mark', 'menu', 'meta', 'meter',
  'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'picture', 'pre', 'progress',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'script', 'search', 'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track',
  'u', 'ul',
  'var', 'video',
  'wbr',
  // SVG elements
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'text', 'tspan', 'defs', 'use', 'clipPath', 'mask', 'pattern', 'image', 'foreignObject',
])

/**
 * Inject __source="filePath:line:col" prop on lowercase JSX host elements.
 * Uses OXC AST with regex state-machine fallback.
 */
function injectJSXSourceProps(code: string, relativePath: string, id?: string): string | null {
  // Try AST-based approach first
  const parsed = id ? parseJSX(id, code) : null
  if (parsed) {
    const elements = findJSXOpeningElements(parsed.program, name => HTML_ELEMENTS.has(name), parsed.lineStarts)
    const edits: Array<{ start: number; end: number; replacement: string }> = []

    for (const el of elements) {
      if (el.attributes.includes('__source')) continue
      const attr = ` __source="${relativePath}:${el.line}:${el.col}"`
      edits.push({ start: el.nameEndOffset, end: el.nameEndOffset, replacement: attr })
    }

    if (edits.length === 0) return null
    return spliceSource(code, edits)
  }

  // Fallback: regex state machine
  return injectJSXSourcePropsRegex(code, relativePath)
}

function injectJSXSourcePropsRegex(code: string, relativePath: string): string | null {
  const lineStarts: number[] = [0]
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') lineStarts.push(i + 1)
  }

  function getLineCol(offset: number): { line: number; col: number } {
    let lo = 0, hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, col: offset - lineStarts[lo] + 1 }
  }

  const injections: Array<{ offset: number; attr: string }> = []

  let i = 0
  while (i < code.length) {
    const ch = code[i]

    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }

    if (ch === '/' && code[i + 1] === '*') {
      i += 2
      while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (ch === '`') {
      i++
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') i++
        i++
      }
      i++
      continue
    }

    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') i++
        i++
      }
      i++
      continue
    }

    if (ch === '<' && i + 1 < code.length) {
      const next = code[i + 1]
      if (next === '/') { i++; continue }
      if (next === '>') { i++; continue }

      if (next >= 'a' && next <= 'z') {
        const tagStart = i
        i++
        const nameStart = i
        while (i < code.length && /[a-zA-Z0-9\-]/.test(code[i])) i++
        const tagName = code.slice(nameStart, i)

        if (!tagName || !HTML_ELEMENTS.has(tagName)) continue
        if (i < code.length && code[i] === '.') continue

        const insertOffset = i
        let depth = 0
        let j = i
        let hasSource = false
        while (j < code.length) {
          if (code[j] === '{') depth++
          else if (code[j] === '}') depth--
          else if (depth === 0) {
            if (code[j] === '>' || (code[j] === '/' && code[j + 1] === '>')) break
            if (code.slice(j, j + 8) === '__source') hasSource = true
          }
          j++
        }

        if (!hasSource) {
          const { line, col } = getLineCol(tagStart)
          const attr = ` __source="${relativePath}:${line}:${col}"`
          injections.push({ offset: insertOffset, attr })
        }

        i = j
        continue
      }
    }

    i++
  }

  if (injections.length === 0) return null

  let result = code
  for (let k = injections.length - 1; k >= 0; k--) {
    const { offset, attr } = injections[k]
    result = result.slice(0, offset) + attr + result.slice(offset)
  }
  return result
}

function rewriteHook(source: string, edit: RewriteEdit): string | null {
  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)

  // Try AST: find the useState() call near the target line and replace its first argument
  const parsed = parseJSX('file.tsx', source)
  if (parsed) {
    const hooks = findHookCalls(parsed.program, 0, source.length, parsed.lineStarts)
    for (const hook of hooks) {
      if (hook.hookName === 'useState' && hook.line === edit.line && hook.firstArgRange) {
        return spliceSource(source, [{
          start: hook.firstArgRange[0],
          end: hook.firstArgRange[1],
          replacement: serialized,
        }])
      }
    }
    // If AST found hooks but not on this line, widen the search (+/- 2 lines)
    for (const hook of hooks) {
      if (hook.hookName === 'useState' && Math.abs(hook.line - edit.line) <= 2 && hook.firstArgRange) {
        return spliceSource(source, [{
          start: hook.firstArgRange[0],
          end: hook.firstArgRange[1],
          replacement: serialized,
        }])
      }
    }
  }

  // Fallback: regex
  return rewriteHookRegex(source, edit)
}

function rewriteHookRegex(source: string, edit: RewriteEdit): string | null {
  const lines = source.split('\n')
  const targetLine = lines[edit.line - 1]
  if (!targetLine || !targetLine.includes('useState')) return null

  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)
  const replaced = targetLine.replace(/useState\(\s*([^,)]+)/, `useState(${serialized}`)
  if (replaced === targetLine) return null

  lines[edit.line - 1] = replaced
  return lines.join('\n')
}

/**
 * Rewrite a prop value in JSX source code.
 * For string values inside expressions like {__('Bundles')}, only replaces the
 * string literal, preserving the function wrapper.
 */
function rewriteProp(source: string, edit: RewriteEdit): string | null {
  const propKey = (edit.editHint as any).propKey as string
  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)

  // Try AST: find the JSXAttribute and replace precisely
  const parsed = parseJSX('file.tsx', source)
  if (parsed) {
    const attr = findJSXAttribute(parsed.program, propKey, edit.line, 5, parsed.lineStarts)
    if (attr) {
      // Case 1: Static string prop like title="hello"
      if (attr.stringLiteralRange) {
        // Replace the entire literal (including quotes) with the new quoted value
        return spliceSource(source, [{
          start: attr.stringLiteralRange[0],
          end: attr.stringLiteralRange[1],
          replacement: JSON.stringify(edit.value),
        }])
      }

      // Case 2: Expression prop like title={__('Bundles')} or title={value}
      if (attr.expressionRange) {
        if (typeof edit.value === 'string') {
          // For strings: find string literals inside the expression and replace only those
          const literals = findStringLiterals(parsed.program, attr.expressionRange[0], attr.expressionRange[1])
          if (literals.length === 1) {
            // Single string literal — replace its content, preserving quote style
            const lit = literals[0]
            const quote = lit.raw[0] // preserve original quote style
            return spliceSource(source, [{
              start: lit.range[0],
              end: lit.range[1],
              replacement: quote + edit.value + quote,
            }])
          }
          // Multiple or zero string literals — fall through to replace entire expression
        }

        // For non-string values or complex expressions: replace the entire expression
        return spliceSource(source, [{
          start: attr.expressionRange[0],
          end: attr.expressionRange[1],
          replacement: serialized,
        }])
      }
    }
  }

  // Fallback: regex
  return rewritePropRegex(source, edit)
}

function rewritePropRegex(source: string, edit: RewriteEdit): string | null {
  const lines = source.split('\n')
  const propKey = (edit.editHint as any).propKey as string
  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)

  const searchStart = Math.max(0, edit.line - 3)
  const searchEnd = Math.min(lines.length, edit.line + 5)

  for (let i = searchStart; i < searchEnd; i++) {
    const line = lines[i]

    const stringRe = new RegExp(`(${propKey}\\s*=\\s*)"([^"]*)"`)
    if (stringRe.test(line) && typeof edit.value === 'string') {
      lines[i] = line.replace(stringRe, `$1${JSON.stringify(edit.value)}`)
      return lines.join('\n')
    }

    const exprRe = new RegExp(`(${propKey}\\s*=\\s*)\\{([^}]+)\\}`)
    if (exprRe.test(line)) {
      lines[i] = line.replace(exprRe, `$1{${serialized}}`)
      return lines.join('\n')
    }

    if (edit.value === false) {
      const shorthandRe = new RegExp(`(\\s)${propKey}(\\s|>|/>)`)
      if (shorthandRe.test(line)) {
        lines[i] = line.replace(shorthandRe, `$1${propKey}={false}$2`)
        return lines.join('\n')
      }
    }
  }

  return null
}

export const reactAdapter: FrameworkAdapter = {
  name: 'react',
  accent: '#58c4dc',
  virtualRuntimeId: '\0virtual:devtools-react-runtime',
  supportedSettings: ['hideLibrary', 'hideProviders'],

  detectVersion(root: string): string | null {
    reactMajor = detectReactMajorVersion(root)
    return reactMajor > 0 ? String(reactMajor) : null
  },

  transform(code: string, id: string, projectRoot: string) {
    const { components, program, lineStarts } = parseFileComponents(code, id)
    const relativePath = '/' + path.relative(projectRoot, id).replace(/\\/g, '/')
    const annotations: string[] = []

    for (const c of components) {
      const guard = `typeof ${c.name} !== 'undefined' && (typeof ${c.name} === 'function' || typeof ${c.name} === 'object')`

      // __devtools_source: React 19+ only (React 18 has _debugSource)
      if (!(reactMajor > 0 && reactMajor < 19)) {
        annotations.push(
          `try { if (${guard}) ${c.name}.__devtools_source = { fileName: "${relativePath}", lineNumber: ${c.line}, columnNumber: 1 }; } catch(e) {}`
        )
      }

      // __devtools_hooks: all React versions
      const hookData = getHookNames(code, c.line - 1, program, c.bodyRange, lineStarts)
      if (hookData) {
        const hookArray = JSON.stringify(hookData.map(h => [h.varName, h.line]))
        annotations.push(
          `try { if (${guard}) ${c.name}.__devtools_hooks = ${hookArray}; } catch(e) {}`
        )
      }
    }

    // For React 19+, inject a usage map with component JSX element locations
    // so the fiber walker can find accurate usage-site source without _debugStack
    if (!(reactMajor > 0 && reactMajor < 19) && program && lineStarts) {
      const componentUsages = findJSXOpeningElements(
        program,
        name => /^[A-Z]/.test(name),
        lineStarts,
      )
      if (componentUsages.length > 0) {
        const usageMap: Record<string, Array<{ line: number; col: number }>> = {}
        for (const el of componentUsages) {
          if (!usageMap[el.tagName]) usageMap[el.tagName] = []
          usageMap[el.tagName].push({ line: el.line, col: el.col })
        }
        annotations.push(
          `;(globalThis.__DEVTOOLS_USAGE_MAP__||(globalThis.__DEVTOOLS_USAGE_MAP__={}))["${relativePath}"]=${JSON.stringify(usageMap)}`
        )
      }
    }

    // Inject __source prop on host JSX elements for React 19+ when the JSX transformer
    // doesn't already do it (e.g. esbuild in Vite < 6 doesn't inject __source).
    // OXC (Vite 6+) and SWC already inject __source, so we skip to avoid duplicates.
    let transformedCode = code
    const hasJsxSourceTransform = (reactAdapter as any)._hasJsxSourceTransform
    if (!(reactMajor > 0 && reactMajor < 19) && !hasJsxSourceTransform && /\.[jt]sx$/.test(id)) {
      const injected = injectJSXSourceProps(code, relativePath, id)
      if (injected) transformedCode = injected
    }

    if (annotations.length === 0 && transformedCode === code) return null
    const finalCode = annotations.length > 0
      ? transformedCode + '\n' + annotations.join('\n')
      : transformedCode
    return { code: finalCode, map: null }
  },

  getHookScript() {
    return HOOK_SCRIPT
  },

  buildRuntimeModule() {
    return ''
  },

  injectHtml(html: string) {
    return html
  },

  rewriteSource(source: string, edit: RewriteEdit): string | null {
    if (edit.editHint.kind === 'react-hook') {
      return rewriteHook(source, edit)
    }
    if (edit.editHint.kind === 'react-prop') {
      return rewriteProp(source, edit)
    }
    return null
  },

  // React adapter also registers legacy persist endpoints for backward compatibility
  configureServer(server: any) {
    const projectRoot = server.config.root

    // Legacy persist-hook endpoint
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.method !== 'POST' || req.url !== ENDPOINTS.PERSIST_HOOK) return next()

      let body = ''
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const { fileName, lineNumber, newValue, preview } = JSON.parse(body)

          let filePath = path.resolve(projectRoot, fileName.replace(/^\//, ''))
          if (!fs.existsSync(filePath)) {
            filePath = fileName
            if (!fs.existsSync(filePath)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'File not found' }))
              return
            }
          }

          const content = fs.readFileSync(filePath, 'utf-8')
          const patched = rewriteHook(content, {
            editHint: { kind: 'react-hook' },
            value: newValue,
            line: lineNumber,
            componentName: '',
          })

          if (patched === null) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: 'Could not replace initial value' }))
            return
          }

          if (preview) {
            res.end(JSON.stringify({ ok: true, preview: true, diff: buildDiff(content, patched, fileName, lineNumber) }))
            return
          }

          undoStore.set(filePath, { previousContent: content, timestamp: Date.now() })
          fs.writeFileSync(filePath, patched, 'utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (e: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
    })

    // Legacy persist-prop endpoint
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.method !== 'POST' || req.url !== ENDPOINTS.PERSIST_PROP) return next()

      let body = ''
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const { fileName, lineNumber, propKey, newValue, preview } = JSON.parse(body)

          let filePath = path.resolve(projectRoot, fileName.replace(/^\//, ''))
          if (!fs.existsSync(filePath)) {
            filePath = fileName
            if (!fs.existsSync(filePath)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'File not found' }))
              return
            }
          }

          const content = fs.readFileSync(filePath, 'utf-8')
          const patched = rewriteProp(content, {
            editHint: { kind: 'react-prop', propKey },
            value: newValue,
            line: lineNumber,
            componentName: '',
          })

          if (patched === null) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: `Could not find prop "${propKey}" near line ${lineNumber}` }))
            return
          }

          if (preview) {
            res.end(JSON.stringify({ ok: true, preview: true, diff: buildDiff(content, patched, fileName, lineNumber) }))
            return
          }

          undoStore.set(filePath, { previousContent: content, timestamp: Date.now() })
          fs.writeFileSync(filePath, patched, 'utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (e: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
    })

    // Legacy persist-text endpoint
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.method !== 'POST' || req.url !== ENDPOINTS.PERSIST_TEXT) return next()

      let body = ''
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const { fileName, lineNumber, oldText, newText, preview } = JSON.parse(body)

          if (!oldText || typeof newText !== 'string' || !fileName) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: 'Missing fileName, oldText, or newText' }))
            return
          }

          let filePath = path.resolve(projectRoot, fileName.replace(/^\//, ''))
          if (!fs.existsSync(filePath)) {
            filePath = fileName
            if (!fs.existsSync(filePath)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'File not found' }))
              return
            }
          }

          const content = fs.readFileSync(filePath, 'utf-8')
          const lines = content.split('\n')

          const searchStart = Math.max(0, (lineNumber || 1) - 5)
          const searchEnd = Math.min(lines.length, (lineNumber || 1) + 10)

          let found = false
          for (let i = searchStart; i < searchEnd; i++) {
            if (lines[i].includes(oldText)) {
              lines[i] = lines[i].replace(oldText, newText)
              found = true
              break
            }
          }

          if (!found) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: `Text "${oldText.slice(0, 40)}" not found near line ${lineNumber}` }))
            return
          }

          const patched = lines.join('\n')
          if (preview) {
            res.end(JSON.stringify({ ok: true, preview: true, diff: buildDiff(content, patched, fileName, lineNumber) }))
            return
          }

          undoStore.set(filePath, { previousContent: content, timestamp: Date.now() })
          fs.writeFileSync(filePath, patched, 'utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (e: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
    })
  },
} as FrameworkAdapter & { configureServer: (server: any) => void }
