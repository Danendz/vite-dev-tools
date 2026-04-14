import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { FrameworkAdapter, RewriteEdit } from '../../core/adapter'
import { ENDPOINTS } from '../../shared/constants'
import { HOOK_SCRIPT } from './hook'

const require = createRequire(import.meta.url)

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
 * Walk a Vue compiler AST node tree, collecting dynamic prop names for
 * component elements that match entries in the `usages` map.
 */
function walkASTForDynamicProps(
  node: any,
  usages: Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>>,
): void {
  if (!node) return

  // Element node (type 1) with a tag that matches a component usage
  if (node.type === 1 && node.tag && usages[node.tag]) {
    const line = node.loc?.start?.line
    const entries = usages[node.tag]
    const entry = entries.find((e: any) => e.line === line)
    if (entry && node.props) {
      const dynamicProps: string[] = []
      for (const prop of node.props) {
        // type 7 = DIRECTIVE (v-bind, v-model, etc.)
        if (prop.type === 7) {
          if (prop.name === 'bind' && prop.arg?.type === 4) {
            // :propName="expr" or v-bind:propName="expr"
            dynamicProps.push(prop.arg.content)
          } else if (prop.name === 'model') {
            // v-model or v-model:propName
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

  if (node.children) {
    for (const child of node.children) {
      walkASTForDynamicProps(child, usages)
    }
  }
}

/**
 * Enrich component usage entries with dynamic prop information by parsing
 * the SFC template with `@vue/compiler-sfc`. Gracefully skips if the
 * compiler is not available.
 */
function enrichWithDynamicProps(
  code: string,
  usages: Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>>,
  projectRoot: string,
): void {
  try {
    // Resolve @vue/compiler-sfc via vue's own module scope (works with pnpm strict hoisting)
    const projectRequire = createRequire(path.resolve(projectRoot, 'package.json'))
    const vuePkgPath = projectRequire.resolve('vue/package.json')
    const vueRequire = createRequire(vuePkgPath)
    const { parse } = vueRequire('@vue/compiler-sfc')
    const { descriptor } = parse(code)
    const ast = descriptor?.template?.ast
    if (!ast) return
    walkASTForDynamicProps(ast, usages)
  } catch {
    // @vue/compiler-sfc not available — skip dynamic prop detection
  }
}

/**
 * Scan Vue SFC templates for component usage locations and register them in a
 * global map (`globalThis.__DEVTOOLS_USAGE_MAP__`).  A small `<script>` block is
 * injected so the map is populated at module-load time — entirely outside Vue's
 * prop / attr / fallthrough system, which would otherwise overwrite the values
 * in single-root-component chains.
 */
function injectSourceAttributes(code: string, id: string, projectRoot: string): { code: string; map: null } | null {
  if (!id.endsWith('.vue')) return null

  // Find the template block
  const templateOpenMatch = code.match(/<template(\s[^>]*)?>/)
  if (!templateOpenMatch) return null

  const templateStart = templateOpenMatch.index! + templateOpenMatch[0].length
  const templateEnd = code.lastIndexOf('</template>')
  if (templateEnd < 0 || templateEnd <= templateStart) return null

  const relativePath = path.relative(projectRoot, id).replace(/\\/g, '/')

  // Pre-compute line starts for fast line/column lookup
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

  // Collect component tag usages: { tagName: [{ line, col, dynamicProps }] }
  const usages: Record<string, Array<{ line: number; col: number; dynamicProps?: string[] }>> = {}
  let i = templateStart

  while (i < templateEnd) {
    // Skip HTML comments
    if (code[i] === '<' && code[i + 1] === '!' && code[i + 2] === '-' && code[i + 3] === '-') {
      const commentEnd = code.indexOf('-->', i + 4)
      if (commentEnd < 0) break
      i = commentEnd + 3
      continue
    }

    // Match opening tag: < followed by a letter
    if (code[i] === '<' && i + 1 < templateEnd) {
      const next = code[i + 1]
      if ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z')) {
        const tagStart = i
        let j = i + 1
        while (j < templateEnd && /[\w.-]/.test(code[j])) j++

        const tagName = code.slice(tagStart + 1, j)

        // Only track component tags (PascalCase or kebab-case with hyphen)
        const isComponent = /[A-Z]/.test(tagName) || tagName.includes('-')
        if (isComponent) {
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

  if (Object.keys(usages).length === 0) return null

  // Enrich usages with dynamic prop information from the template AST
  enrichWithDynamicProps(code, usages, projectRoot)

  // Build a script that registers component usage locations in a global map.
  const usageJson = JSON.stringify(usages)
  const regCode = `;(globalThis.__DEVTOOLS_USAGE_MAP__||(globalThis.__DEVTOOLS_USAGE_MAP__={}))["${relativePath}"]=${usageJson};`

  let result = code

  // Inject into existing <script> (non-setup) block, or add a new one.
  // When adding a new block, match the lang attribute of any existing <script setup>.
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

/**
 * Rewrite a ref() initial value in source code.
 * Matches: ref(value) on the target line and replaces the argument.
 */
function rewriteRef(source: string, edit: RewriteEdit): string | null {
  const lines = source.split('\n')
  const targetLine = lines[edit.line - 1]

  if (!targetLine || !targetLine.includes('ref(')) return null

  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)
  const replaced = targetLine.replace(
    /ref\(\s*([^,)]+)/,
    `ref(${serialized}`,
  )

  if (replaced === targetLine) return null

  lines[edit.line - 1] = replaced
  return lines.join('\n')
}

/**
 * Rewrite a template prop binding in a .vue SFC.
 * Handles: :prop="value", prop="value", and boolean shorthand.
 */
function rewriteTemplateProp(source: string, edit: RewriteEdit): string | null {
  const propKey = (edit.editHint as any).propKey as string
  if (!propKey) return null

  const lines = source.split('\n')
  const serialized = typeof edit.value === 'string' ? JSON.stringify(edit.value) : String(edit.value)

  const searchStart = Math.max(0, edit.line - 3)
  const searchEnd = Math.min(lines.length, edit.line + 5)

  for (let i = searchStart; i < searchEnd; i++) {
    const line = lines[i]

    // Match: :propKey="value" (bound prop expression) — reject dynamic bindings
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
      return rewriteTemplateProp(source, edit)
    }
    return null
  },


  configureServer(server: any) {
    const projectRoot = server.config.root

    // Persist-prop endpoint — rewrites template prop bindings in parent .vue file
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
          const patched = rewriteTemplateProp(content, {
            editHint: { kind: 'vue-prop', propKey },
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
  },
} as FrameworkAdapter & { configureServer: (server: any) => void }
