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
    if (components.length === 0) return null

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

    if (annotations.length === 0) return null
    return { code: code + '\n' + annotations.join('\n'), map: null }
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
