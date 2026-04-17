import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { FrameworkAdapter, RewriteEdit } from '../../core/adapter'
import { ENDPOINTS } from '../../shared/constants'
import { HOOK_SCRIPT } from './hook'
import {
  parseJSX,
  findStringLiterals,
  findHookCalls,
  findHookCallsDeep,
  findLocalVarDeclarations,
  findFunctionDefinition,
  findImportSource,
  findReactiveObjectProperty,
  spliceSource,
  VUE_BUILT_IN_COMPOSABLES,
} from '../../shared/ast-utils'
import type { HookMeta, ResolvedHookSource } from '../../shared/ast-utils'
import { undoStore } from '../../shared/undo-store'
import { buildDiff } from '../../shared/diff'

const require = createRequire(import.meta.url)

/** Stored during configureServer for use by rewriteSource */
let storedProjectRoot = ''

/** Call filter for Vue: matches useX() composables AND Vue built-in composable functions */
const VUE_CALL_FILTER = (name: string) =>
  /^use[A-Z]/.test(name) || VUE_BUILT_IN_COMPOSABLES.has(name)

/** Serialize HookMeta[] to compact JSON for injection */
function serializeComposableMeta(hooks: HookMeta[]): any[] {
  return hooks.map(h => {
    const entry: any = { n: h.varName, h: h.hookName, l: h.line }
    if (h.depNames) entry.d = h.depNames
    if (h.innerHooks && h.innerHooks.length > 0) {
      entry.i = serializeComposableMeta(h.innerHooks)
    }
    if (h.sourceFile) entry.f = h.sourceFile
    return entry
  })
}

/**
 * Build a composable import resolver for the current file.
 */
function buildComposableResolver(
  program: any,
  filePath: string,
  lineStarts: number[] | null,
): ((hookName: string) => ResolvedHookSource | null) {
  return (hookName: string) => {
    const imp = findImportSource(program, hookName, lineStarts ?? undefined)
    if (!imp || !imp.importPath.startsWith('.')) return null

    const dir = path.dirname(filePath)
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '']
    let resolvedPath: string | null = null
    let resolvedContent: string | null = null

    for (const ext of extensions) {
      const candidate = path.resolve(dir, imp.importPath + ext)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedPath = candidate
        resolvedContent = fs.readFileSync(candidate, 'utf-8')
        break
      }
      if (ext) {
        const indexCandidate = path.resolve(dir, imp.importPath, 'index' + ext)
        if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
          resolvedPath = indexCandidate
          resolvedContent = fs.readFileSync(indexCandidate, 'utf-8')
          break
        }
      }
    }

    if (!resolvedPath || !resolvedContent) return null

    const parsed = parseJSX(resolvedPath, resolvedContent)
    if (!parsed) return null

    const funcDef = findFunctionDefinition(parsed.program, hookName, parsed.lineStarts)
    if (!funcDef) return null

    return {
      program: parsed.program,
      bodyRange: funcDef.bodyRange,
      lineStarts: parsed.lineStarts,
      sourceFile: resolvedPath,
    }
  }
}

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
 * When inside a component's children (slot content), routes elements to __slots__ sub-structure.
 */
function walkTemplateAST(
  node: any,
  usages: Record<string, any>,
  slotContext?: { componentTag: string; slotName: string },
): void {
  if (!node) return

  // Track <slot> definitions for slot source mapping
  if (node.type === 1 && node.tag === 'slot') {
    let slotDefName = 'default'
    if (node.props) {
      for (const prop of node.props) {
        if (prop.type === 6 && prop.name === 'name' && prop.value) {
          slotDefName = prop.value.content
        }
      }
    }
    const line = node.loc?.start?.line
    const col = node.loc?.start?.column != null ? node.loc.start.column + 1 : 1
    if (!usages.__slotDefs__) usages.__slotDefs__ = {}
    usages.__slotDefs__[slotDefName] = { line, col }
  }

  // Element node (type 1)
  if (node.type === 1 && node.tag) {
    const tagName = node.tag
    const isComponent = /[A-Z]/.test(tagName) || tagName.includes('-')
    const isTrackable = !isComponent && !VUE_BUILTIN_ELEMENTS.has(tagName)

    if (isComponent || isTrackable) {
      const line = node.loc?.start?.line
      const col = node.loc?.start?.column != null ? node.loc.start.column + 1 : 1

      const entry = { line, col, dynamicProps: undefined as string[] | undefined }

      if (slotContext && isTrackable) {
        // Route slot content elements to __slots__ sub-structure
        if (!usages.__slots__) usages.__slots__ = {}
        const compSlots = usages.__slots__[slotContext.componentTag] ??= {}
        const slotGroup = compSlots[slotContext.slotName] ??= {}
        if (!slotGroup[tagName]) slotGroup[tagName] = []
        slotGroup[tagName].push(entry)
      } else {
        // Direct template elements (components always go top-level for usage tracking)
        if (!usages[tagName]) usages[tagName] = []
        usages[tagName].push(entry)
      }

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
    // When current node is a component, its children are slot content
    const isComponent = node.type === 1 && node.tag && (/[A-Z]/.test(node.tag) || node.tag.includes('-'))
      && !VUE_BUILTIN_ELEMENTS.has(node.tag)

    if (isComponent) {
      for (const child of node.children) {
        // <template #slotName> — named slot wrapper
        if (child.type === 1 && child.tag === 'template' && child.props) {
          let slotName = 'default'
          for (const prop of child.props) {
            if (prop.type === 7 && prop.name === 'slot') {
              slotName = prop.arg?.content ?? 'default'
              break
            }
          }
          // Recurse into template children with the slot context
          if (child.children) {
            for (const grandchild of child.children) {
              walkTemplateAST(grandchild, usages, { componentTag: node.tag, slotName })
            }
          }
        } else {
          // Direct children are default slot content
          walkTemplateAST(child, usages, { componentTag: node.tag, slotName: 'default' })
        }
      }
    } else {
      for (const child of node.children) {
        walkTemplateAST(child, usages, slotContext)
      }
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

  // Extract composable metadata from <script setup>
  let composableCode = ''
  const scriptSetupMatch = code.match(/<script[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/)
  if (scriptSetupMatch) {
    const scriptContent = scriptSetupMatch[1]
    const scriptOffset = scriptSetupMatch.index! + scriptSetupMatch[0].indexOf(scriptContent)
    const parsed = parseJSX('script.ts', scriptContent)
    if (parsed) {
      const resolveHook = buildComposableResolver(parsed.program, id, parsed.lineStarts)
      // Find top-level useX() composable calls (not Vue built-ins like ref/computed)
      const composables = findHookCallsDeep(
        parsed.program, 0, scriptContent.length, parsed.lineStarts,
        { builtIns: VUE_BUILT_IN_COMPOSABLES, callFilter: VUE_CALL_FILTER, resolveHook },
      )
      // Filter to only custom composables (not bare ref/reactive/computed calls)
      const customComposables = composables.filter(h => !VUE_BUILT_IN_COMPOSABLES.has(h.hookName))

      const linesBeforeScript = code.slice(0, scriptOffset).split('\n').length - 1
      const locals = findLocalVarDeclarations(parsed.program, 0, scriptContent.length, parsed.lineStarts)
        .filter(l => !VUE_BUILT_IN_COMPOSABLES.has(l.name))

      if (customComposables.length > 0 || locals.length > 0) {
        const meta = JSON.stringify({
          composables: serializeComposableMeta(customComposables),
          locals: locals.map(l => ({ n: l.name, l: l.line + linesBeforeScript })),
        })
        composableCode = `;(globalThis.__DEVTOOLS_COMPOSABLES__||(globalThis.__DEVTOOLS_COMPOSABLES__={}))["${relativePath}"]=${meta};`
      }
    }
  }

  if (Object.keys(usages).length === 0 && !composableCode) return null

  // Build a script that registers component usage locations in a global map.
  const usageJson = JSON.stringify(usages)
  const regCode = (Object.keys(usages).length > 0
    ? `;(globalThis.__DEVTOOLS_USAGE_MAP__||(globalThis.__DEVTOOLS_USAGE_MAP__={}))["${relativePath}"]=${usageJson};`
    : '') + composableCode

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
      const hooks = findHookCalls(parsed.program, 0, scriptContent.length, parsed.lineStarts, { callFilter: VUE_CALL_FILTER })
      const targetLine = edit.line - linesBeforeScript
      for (const hook of hooks) {
        if (hook.hookName === 'ref' || hook.hookName === 'shallowRef') {
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

/** Walk Vue template AST to find the closest element node to a target line */
function findTemplateElement(node: any, targetLine: number): any | null {
  let best: any = null
  let bestDist = Infinity

  function walk(n: any) {
    if (!n) return

    if (n.type === 1 && n.loc?.start?.line) {
      const dist = Math.abs(n.loc.start.line - targetLine)
      if (dist <= 3 && dist < bestDist) {
        best = n
        bestDist = dist
      }
    }

    if (n.children) {
      for (const child of n.children) {
        walk(child)
      }
    }
  }

  walk(node)
  return best
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

/**
 * Rewrite a nested property in a reactive() object literal.
 * editHint: { kind: 'vue-reactive-path', varName: string, propertyPath: string[] }
 */
function rewriteReactivePath(source: string, edit: RewriteEdit): string | null {
  const hint = edit.editHint as any
  const varName = hint.varName as string
  const propertyPath = hint.propertyPath as string[]
  if (!varName || !propertyPath?.length) return null

  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)

  const scriptMatch = source.match(/<script[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/)
  if (!scriptMatch) return null

  const scriptContent = scriptMatch[1]
  const scriptOffset = scriptMatch.index! + scriptMatch[0].indexOf(scriptContent)

  const parsed = parseJSX('script.ts', scriptContent)
  if (!parsed) return null

  const prop = findReactiveObjectProperty(parsed.program, varName, propertyPath, parsed.lineStarts)
  if (!prop) return null

  return spliceSource(source, [{
    start: scriptOffset + prop.range[0],
    end: scriptOffset + prop.range[1],
    replacement: serialized,
  }])
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
    if (edit.editHint.kind === 'vue-reactive-path') {
      return rewriteReactivePath(source, edit)
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
