import fs from 'node:fs'
import path from 'node:path'
import type { FrameworkAdapter, RewriteEdit } from '../../core/adapter'
import { ENDPOINTS } from '../../shared/constants'
import { HOOK_SCRIPT } from './hook'

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

/**
 * Find component-like declarations in source code.
 */
function findComponentDeclarations(code: string): Array<{ name: string; line: number }> {
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

/**
 * Find hook calls inside a component body and extract variable names.
 */
function findHookNames(code: string, componentLine: number): { varName: string | null; line: number }[] | null {
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
 * Used for React 19+ where _debugSource is no longer available.
 */
function injectJSXSourceProps(code: string, relativePath: string): string | null {
  // Pre-compute line start offsets for fast line/column lookup
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

  // State machine to track context (skip strings, comments, template literals)
  let i = 0
  while (i < code.length) {
    const ch = code[i]

    // Single-line comment
    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }

    // Multi-line comment
    if (ch === '/' && code[i + 1] === '*') {
      i += 2
      while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      continue
    }

    // Template literal
    if (ch === '`') {
      i++
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') i++ // skip escaped char
        i++
      }
      i++ // skip closing backtick
      continue
    }

    // String (single or double quote)
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') i++ // skip escaped char
        i++
      }
      i++ // skip closing quote
      continue
    }

    // JSX opening tag: < followed by lowercase letter
    if (ch === '<' && i + 1 < code.length) {
      const next = code[i + 1]

      // Skip closing tags </...>
      if (next === '/') { i++; continue }

      // Skip fragments <>
      if (next === '>') { i++; continue }

      // Only match lowercase tags (host elements)
      if (next >= 'a' && next <= 'z') {
        const tagStart = i
        i++ // skip <
        // Read tag name
        const nameStart = i
        while (i < code.length && /[a-zA-Z0-9\-]/.test(code[i])) i++
        const tagName = code.slice(nameStart, i)

        // Skip if empty tag name or not a known HTML element
        if (!tagName || !HTML_ELEMENTS.has(tagName)) continue

        // Skip member expressions like i18nContext.Provider
        if (i < code.length && code[i] === '.') continue

        // The insertion point is right after the tag name
        const insertOffset = i

        // Check if __source is already present in this tag
        // Scan forward to find > or /> to get the tag bounds
        let depth = 0
        let j = i
        let hasSource = false
        while (j < code.length) {
          if (code[j] === '{') depth++
          else if (code[j] === '}') depth--
          else if (depth === 0) {
            if (code[j] === '>' || (code[j] === '/' && code[j + 1] === '>')) break
            // Check for __source attribute
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

  // Apply injections in reverse order to preserve offsets
  let result = code
  for (let k = injections.length - 1; k >= 0; k--) {
    const { offset, attr } = injections[k]
    result = result.slice(0, offset) + attr + result.slice(offset)
  }
  return result
}

function rewriteHook(source: string, edit: RewriteEdit): string | null {
  const lines = source.split('\n')
  const targetLine = lines[edit.line - 1]

  if (!targetLine || !targetLine.includes('useState')) return null

  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)
  const replaced = targetLine.replace(
    /useState\(\s*([^,)]+)/,
    `useState(${serialized}`,
  )

  if (replaced === targetLine) return null

  lines[edit.line - 1] = replaced
  return lines.join('\n')
}

function rewriteProp(source: string, edit: RewriteEdit): string | null {
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
    const components = findComponentDeclarations(code)
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
      const hookData = findHookNames(code, c.line - 1)
      if (hookData) {
        const hookArray = JSON.stringify(hookData.map(h => [h.varName, h.line]))
        annotations.push(
          `try { if (${guard}) ${c.name}.__devtools_hooks = ${hookArray}; } catch(e) {}`
        )
      }
    }

    // Inject __source prop on host JSX elements for React 19+ when the JSX transformer
    // doesn't already do it (e.g. esbuild in Vite < 6 doesn't inject __source).
    // OXC (Vite 6+) and SWC already inject __source, so we skip to avoid duplicates.
    let transformedCode = code
    const hasJsxSourceTransform = (reactAdapter as any)._hasJsxSourceTransform
    if (!(reactMajor > 0 && reactMajor < 19) && !hasJsxSourceTransform && /\.[jt]sx$/.test(id)) {
      const injected = injectJSXSourceProps(code, relativePath)
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
          const { fileName, lineNumber, newValue } = JSON.parse(body)

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
          const { fileName, lineNumber, propKey, newValue } = JSON.parse(body)

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
          const { fileName, lineNumber, oldText, newText } = JSON.parse(body)

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

          fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (e: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
    })
  },
} as FrameworkAdapter & { configureServer: (server: any) => void }
