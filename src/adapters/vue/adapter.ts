import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { FrameworkAdapter, RewriteEdit } from '../../core/adapter'
import { ENDPOINTS } from '../../shared/constants'
import { HOOK_SCRIPT } from './hook'
import { parseJSX, findStringLiterals, findHookCalls, spliceSource } from '../../shared/ast-utils'
import { undoStore } from '../../shared/undo-store'
import { buildDiff } from '../../shared/diff'

const require = createRequire(import.meta.url)

/** Stored during configureServer for use by rewriteSource */
let storedProjectRoot = ''

const VUE_BUILTIN_ELEMENTS = new Set([
  'template', 'slot', 'component', 'transition', 'transition-group',
  'keep-alive', 'teleport', 'suspense',
])

/**
 * Detect installed Vue 3 version from node_modules.
 */
function detectVueVersion(projectRoot: string): string | null {
  try {
    const pkgPath = require.resolve('vue/package.json', { paths: [projectRoot] })
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return pkg.version
  } catch {
    return null
  }
}

/**
 * Try to resolve @vue/compiler-sfc from the project's vue installation.
 * Returns the `parse` function or null if unavailable.
 */
function tryLoadVueCompiler(projectRoot: string): ((code: string) => any) | null {
  try {
    const projectRequire = createRequire(path.resolve(projectRoot, 'package.json'))
    const vuePkgPath = projectRequire.resolve('vue/package.json')
    const vueRequire = createRequire(vuePkgPath)
    const { parse } = vueRequire('@vue/compiler-sfc')
    return parse
  } catch {
    return null
  }
}

/**
 * Walk a Vue template AST, collecting tag usages and dynamic prop info in one pass.
 */
function walkTemplateAST(
  node: any,
  usages: Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>>,
): void {
  if (!node) return

  // Element node (type 1)
  if (node.type === 1 && node.tag) {
    const tagName = node.tag
    const isComponent = /[A-Z]/.test(tagName) || tagName.includes('-')
    const isTrackable = !isComponent && !VUE_BUILTIN_ELEMENTS.has(tagName)

    if (isComponent || isTrackable) {
      const line = node.loc?.start?.line
      const col = node.loc?.start?.column != null ? node.loc.start.column + 1 : 1

      if (!usages[tagName]) usages[tagName] = []
      const entry = { line, col, dynamicProps: undefined as string[] | undefined }
      usages[tagName].push(entry)

      // Collect dynamic props from this element
      if (node.props) {
        const dynamicProps: string[] = []
        for (const prop of node.props) {
          if (prop.type === 7) {
            if (prop.name === 'bind' && prop.arg?.type === 4) {
              dynamicProps.push(prop.arg.content)
            } else if (prop.name === 'model') {
              const propName = prop.arg?.type === 4 ? prop.arg.content : 'modelValue'
              dynamicProps.push(propName)
            }
          }
        }
        if (dynamicProps.length > 0) {
          entry.dynamicProps = dynamicProps
        }
      }
    }
  }

  if (node.children) {
    for (const child of node.children) {
      walkTemplateAST(child, usages)
    }
  }
}

/**
 * Scan Vue SFC templates for component usage locations and register them in a
 * global map. Uses @vue/compiler-sfc AST when available, regex fallback otherwise.
 */
function injectSourceAttributes(code: string, id: string, projectRoot: string): { code: string; map: null } | null {
  if (!id.endsWith('.vue')) return null

  const relativePath = path.relative(projectRoot, id).replace(/\\/g, '/')
  const usages: Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>> = {}

  // Try AST-based approach with @vue/compiler-sfc
  const parse = tryLoadVueCompiler(projectRoot)
  if (parse) {
    try {
      const { descriptor } = parse(code)
      const ast = descriptor?.template?.ast
      if (ast) {
        walkTemplateAST(ast, usages)
      }
    } catch {
      // Fall through to regex fallback
    }
  }

  // Fallback: regex state machine if AST produced nothing
  if (Object.keys(usages).length === 0) {
    injectSourceAttributesRegex(code, usages)
  }

  if (Object.keys(usages).length === 0) return null

  // Build a script that registers component usage locations in a global map.
  const usageJson = JSON.stringify(usages)
  const regCode = `;(globalThis.__DEVTOOLS_USAGE_MAP__||(globalThis.__DEVTOOLS_USAGE_MAP__={}))["${relativePath}"]=${usageJson};`

  let result = code

  const nonSetupScript = result.match(/<script(?![^>]*\bsetup\b)[^>]*>/)
  if (nonSetupScript) {
    const pos = nonSetupScript.index! + nonSetupScript[0].length
    result = result.slice(0, pos) + regCode + result.slice(pos)
  } else {
    const langMatch = result.match(/<script[^>]*\blang\s*=\s*"([^"]*)"/)
    const langAttr = langMatch ? ` lang="${langMatch[1]}"` : ''
    result = `<script${langAttr}>${regCode}</script>\n` + result
  }

  return { code: result, map: null }
}

/** Regex fallback for template tag scanning when @vue/compiler-sfc is unavailable */
function injectSourceAttributesRegex(
  code: string,
  usages: Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>>,
): void {
  const templateOpenMatch = code.match(/<template(\s[^>]*)?>/)
  if (!templateOpenMatch) return

  const templateStart = templateOpenMatch.index! + templateOpenMatch[0].length
  const templateEnd = code.lastIndexOf('</template>')
  if (templateEnd < 0 || templateEnd <= templateStart) return

  const lineStarts: number[] = [0]
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') lineStarts.push(i + 1)
  }

  function getLineCol(offset: number) {
    let lo = 0, hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
  }

  let i = templateStart
  while (i < templateEnd) {
    if (code[i] === '<' && code[i + 1] === '!' && code[i + 2] === '-' && code[i + 3] === '-') {
      const commentEnd = code.indexOf('-->', i + 4)
      if (commentEnd < 0) break
      i = commentEnd + 3
      continue
    }

    if (code[i] === '<' && i + 1 < templateEnd) {
      const next = code[i + 1]
      if ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z')) {
        const tagStart = i
        let j = i + 1
        while (j < templateEnd && /[\w.-]/.test(code[j])) j++
        const tagName = code.slice(tagStart + 1, j)

        const isComponent = /[A-Z]/.test(tagName) || tagName.includes('-')
        const isTrackableElement = !isComponent && !VUE_BUILTIN_ELEMENTS.has(tagName)
        if (isComponent || isTrackableElement) {
          const { line, column } = getLineCol(tagStart)
          if (!usages[tagName]) usages[tagName] = []
          usages[tagName].push({ line, col: column })
        }
        i = j
        continue
      }
    }

    i++
  }
}

/**
 * Rewrite a ref() initial value in source code.
 * Uses OXC AST with regex fallback.
 */
function rewriteRef(source: string, edit: RewriteEdit): string | null {
  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)

  // Try AST: parse the script block and find ref() call
  // Extract <script setup> content for parsing
  const scriptMatch = source.match(/<script[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/)
  if (scriptMatch) {
    const scriptContent = scriptMatch[1]
    const scriptOffset = scriptMatch.index! + scriptMatch[0].indexOf(scriptContent)
    // Count lines before script block to adjust line numbers
    const linesBeforeScript = source.slice(0, scriptOffset).split('\n').length - 1

    const parsed = parseJSX('script.ts', scriptContent)
    if (parsed) {
      const hooks = findHookCalls(parsed.program, 0, scriptContent.length, parsed.lineStarts)
      const targetLine = edit.line - linesBeforeScript
      for (const hook of hooks) {
        if (hook.hookName === 'useRef' || hook.hookName === 'ref') {
          // Check if this hook is near the target line (within +/- 2 lines)
          if (Math.abs(hook.line - targetLine) <= 2 && hook.firstArgRange) {
            return spliceSource(source, [{
              start: scriptOffset + hook.firstArgRange[0],
              end: scriptOffset + hook.firstArgRange[1],
              replacement: serialized,
            }])
          }
        }
      }
    }
  }

  // Fallback: regex
  return rewriteRefRegex(source, edit)
}

function rewriteRefRegex(source: string, edit: RewriteEdit): string | null {
  const lines = source.split('\n')
  const targetLine = lines[edit.line - 1]
  if (!targetLine || !targetLine.includes('ref(')) return null

  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)
  const replaced = targetLine.replace(/ref\(\s*([^,)]+)/, `ref(${serialized}`)
  if (replaced === targetLine) return null

  lines[edit.line - 1] = replaced
  return lines.join('\n')
}

/**
 * Rewrite a template prop binding in a .vue SFC.
 * Uses @vue/compiler-sfc AST + OXC for bound props. Regex fallback.
 */
function rewriteTemplateProp(source: string, edit: RewriteEdit, projectRoot?: string): string | null {
  const propKey = (edit.editHint as any).propKey as string
  if (!propKey) return null

  // Try AST approach if projectRoot is available
  if (projectRoot) {
    const parse = tryLoadVueCompiler(projectRoot)
    if (parse) {
      const result = rewriteTemplatePropAST(source, edit, propKey, parse)
      if (result !== null) return result
    }
  }

  // Fallback: regex
  return rewriteTemplatePropRegex(source, edit)
}

function rewriteTemplatePropAST(
  source: string,
  edit: RewriteEdit,
  propKey: string,
  parse: (code: string) => any,
): string | null {
  try {
    const { descriptor } = parse(source)
    const ast = descriptor?.template?.ast
    if (!ast) return null

    // Find the element near the target line
    const node = findTemplateElement(ast, edit.line)
    if (!node || !node.props) return null

    for (const prop of node.props) {
      // Static attribute (type 6): propKey="value"
      if (prop.type === 6 && prop.name === propKey && prop.value) {
        if (typeof edit.value === 'string') {
          // Replace the content between quotes (prop.value.loc gives us the position including quotes)
          const start = prop.value.loc.start.offset
          const end = prop.value.loc.end.offset
          return spliceSource(source, [{
            start,
            end,
            replacement: `"${edit.value}"`,
          }])
        }
      }

      // Bound directive (type 7): :propKey="expr" or v-bind:propKey="expr"
      if (prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === propKey) {
        if (!prop.exp || prop.exp.type !== 4) continue

        const exprContent = prop.exp.content
        const exprStart = prop.exp.loc.start.offset
        const exprEnd = prop.exp.loc.end.offset

        if (typeof edit.value === 'string') {
          // Parse the expression with OXC to find string literals
          const parsed = parseJSX('expr.ts', exprContent)
          if (parsed) {
            const literals = findStringLiterals(parsed.program, 0, exprContent.length)
            if (literals.length === 1) {
              // Single string literal — replace only its content, preserve function wrapper
              const lit = literals[0]
              const quote = lit.raw[0]
              return spliceSource(source, [{
                start: exprStart + lit.range[0],
                end: exprStart + lit.range[1],
                replacement: quote + edit.value + quote,
              }])
            }
          }
          // Multiple/zero literals: replace entire expression content
          return spliceSource(source, [{
            start: exprStart,
            end: exprEnd,
            replacement: JSON.stringify(edit.value),
          }])
        }

        // Non-string value: replace entire expression
        const serialized = edit.value === null ? 'null' : String(edit.value)
        return spliceSource(source, [{
          start: exprStart,
          end: exprEnd,
          replacement: serialized,
        }])
      }
    }
  } catch {
    // AST parsing failed — fall through to regex
  }
  return null
}

/** Walk Vue template AST to find an element node near a target line */
function findTemplateElement(node: any, targetLine: number): any | null {
  if (!node) return null

  if (node.type === 1 && node.loc?.start?.line) {
    // Check if this element's tag is near the target line
    if (Math.abs(node.loc.start.line - targetLine) <= 3) {
      return node
    }
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findTemplateElement(child, targetLine)
      if (found) return found
    }
  }

  return null
}

function rewriteTemplatePropRegex(source: string, edit: RewriteEdit): string | null {
  const propKey = (edit.editHint as any).propKey as string
  if (!propKey) return null

  const lines = source.split('\n')
  const searchStart = Math.max(0, edit.line - 3)
  const searchEnd = Math.min(lines.length, edit.line + 5)

  for (let i = searchStart; i < searchEnd; i++) {
    const line = lines[i]

    // Match: :propKey="value" (bound prop expression) — reject dynamic bindings in regex mode
    const boundRe = new RegExp(`(:${propKey}\\s*=\\s*)"([^"]*)"`)
    if (boundRe.test(line)) {
      return null
    }

    // Match: propKey="value" (static string prop)
    const staticRe = new RegExp(`((?<!:)${propKey}\\s*=\\s*)"([^"]*)"`)
    if (staticRe.test(line) && typeof edit.value === 'string') {
      lines[i] = line.replace(staticRe, `$1"${edit.value}"`)
      return lines.join('\n')
    }

    // Boolean shorthand
    if (edit.value === false) {
      const shorthandRe = new RegExp(`(\\s)${propKey}(\\s|>|/>)`)
      if (shorthandRe.test(line)) {
        lines[i] = line.replace(shorthandRe, `$1:${propKey}="false"$2`)
        return lines.join('\n')
      }
    }
  }

  return null
}

export const vueAdapter: FrameworkAdapter = {
  name: 'vue',
  accent: '#42b883',
  virtualRuntimeId: '\0virtual:devtools-vue-runtime',
  supportedSettings: ['hideLibrary'],

  detectVersion(root: string): string | null {
    return detectVueVersion(root)
  },

  transform(code: string, id: string, projectRoot: string) {
    return injectSourceAttributes(code, id, projectRoot)
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
    if (edit.editHint.kind === 'vue-path') {
      return rewriteRef(source, edit)
    }
    if (edit.editHint.kind === 'vue-prop') {
      return rewriteTemplateProp(source, edit, storedProjectRoot || undefined)
    }
    return null
  },


  configureServer(server: any) {
    const projectRoot = server.config.root
    storedProjectRoot = projectRoot

    // Persist-prop endpoint — rewrites template prop bindings in parent .vue file
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
          const patched = rewriteTemplateProp(content, {
            editHint: { kind: 'vue-prop', propKey },
            value: newValue,
            line: lineNumber,
            componentName: '',
          }, projectRoot)

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
  },
} as FrameworkAdapter & { configureServer: (server: any) => void }
