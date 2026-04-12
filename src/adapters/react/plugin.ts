import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { DevToolsConfig } from '../../core/types'
import { HOOK_SCRIPT } from './hook'
import { createEditorMiddleware } from '../../shared/editor'
import { DEFAULT_CONFIG } from '../../shared/constants'

const DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * Detect installed React major version from node_modules.
 * Returns the major version number, or 0 if not found.
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

// Virtual module IDs — must be URL-safe for Vite to serve them
const VIRTUAL_CLIENT = '/@danendz-devtools/client'
const VIRTUAL_RUNTIME = '/@danendz-devtools/react-runtime'

const SOURCE_FILE_RE = /\.[jt]sx?$/

/**
 * Find component-like declarations in source code.
 * Matches: function App(), const App =, export default function App(), etc.
 */
function findComponentDeclarations(code: string): Array<{ name: string; line: number }> {
  const components: Array<{ name: string; line: number }> = []
  const lines = code.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // function ComponentName(
    const fnMatch = line.match(/(?:export\s+(?:default\s+)?)?function\s+([A-Z][a-zA-Z0-9_]*)\s*[\(<]/)
    if (fnMatch) {
      components.push({ name: fnMatch[1], line: i + 1 })
      continue
    }

    // const ComponentName = (...) => | const ComponentName: React.FC = | const ComponentName = React.memo(
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Z][a-zA-Z0-9_]*)\s*[=:]/)
    if (arrowMatch) {
      components.push({ name: arrowMatch[1], line: i + 1 })
    }
  }

  return components
}

export function createReactDevToolsPlugin(config?: DevToolsConfig): Plugin {
  const mergedConfig = { accentColor: '#58c4dc', ...DEFAULT_CONFIG, ...config }
  let projectRoot = ''
  let reactMajor = 0

  return {
    name: '@danendz/devtools-react',
    apply: 'serve',

    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root
      reactMajor = detectReactMajorVersion(projectRoot)
    },

    transform(code, id) {
      // React 18 and below: _debugSource is available on fibers, no transform needed
      // React 19+: _debugSource removed, we inject __devtools_source via transform
      if (reactMajor > 0 && reactMajor < 19) return

      // Only process project source files, not node_modules or virtual modules
      if (!SOURCE_FILE_RE.test(id)) return
      if (id.includes('node_modules') || id.includes('.vite') || id.startsWith('\0')) return

      const components = findComponentDeclarations(code)
      if (components.length === 0) return

      const relativePath = '/' + path.relative(projectRoot, id).replace(/\\/g, '/')

      const annotations = components.map((c) =>
        `try { if (typeof ${c.name} !== 'undefined' && (typeof ${c.name} === 'function' || typeof ${c.name} === 'object')) ${c.name}.__devtools_source = { fileName: "${relativePath}", lineNumber: ${c.line}, columnNumber: 1 }; } catch(e) {}`
      ).join('\n')

      return { code: code + '\n' + annotations, map: null }
    },

    configureServer(server) {
      // Extend Vite's fs.allow to include the plugin's dist directory
      // Must be done here (not in config hook) to avoid overriding Vite's defaults
      server.config.server.fs.allow.push(DIR)

      server.middlewares.use(createEditorMiddleware(server.config.root))

      // Serve virtual modules as middleware — this ensures the browser can fetch them
      server.middlewares.use((req, res, next) => {
        if (req.url === VIRTUAL_CLIENT) {
          const overlayPath = path.resolve(DIR, 'overlay.mjs').replace(/\\/g, '/')
          const code = [
            `import { mountOverlay } from "/@fs/${overlayPath}";`,
            `mountOverlay(${JSON.stringify(mergedConfig)});`,
          ].join('\n')
          res.setHeader('Content-Type', 'application/javascript')
          res.end(code)
          return
        }

        if (req.url === VIRTUAL_RUNTIME) {
          const runtimePath = path.resolve(DIR, 'react-runtime.mjs').replace(/\\/g, '/')
          const code = `import "/@fs/${runtimePath}";`
          res.setHeader('Content-Type', 'application/javascript')
          res.end(code)
          return
        }

        next()
      })
    },

    transformIndexHtml() {
      return [
        {
          // Hook MUST run before React loads — inline, non-module, head-prepend
          tag: 'script',
          children: HOOK_SCRIPT,
          injectTo: 'head-prepend',
        },
        {
          // React runtime — fiber walker + commit listener
          tag: 'script',
          attrs: { type: 'module', src: VIRTUAL_RUNTIME },
          injectTo: 'head',
        },
        {
          // Overlay client — Preact UI
          tag: 'script',
          attrs: { type: 'module', src: VIRTUAL_CLIENT },
          injectTo: 'body',
        },
      ]
    },
  }
}
