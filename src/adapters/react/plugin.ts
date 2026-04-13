import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { DevToolsConfig } from '../../core/types'
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

/**
 * Find hook calls inside a component body and extract variable names.
 * Returns an ordered array of variable names (null for hooks with no assignment like useEffect).
 */
function findHookNames(code: string, componentLine: number): { varName: string | null; line: number }[] | null {
  const lines = code.split('\n')
  const hooks: { varName: string | null; line: number }[] = []

  // Scan lines after the component declaration for hook calls
  for (let i = componentLine; i < lines.length; i++) {
    const line = lines[i]

    // Stop at next component/function declaration at the same or lower indent
    if (i > componentLine && /^(?:export\s+)?(?:function|const|let|var)\s+[A-Z]/.test(line)) break

    // Array destructuring: const [name, ...] = useHook(...)
    const arrayMatch = line.match(/(?:const|let|var)\s+\[(\w+).*?\]\s*=\s*(use\w+)\s*[\(<]/)
    if (arrayMatch) {
      hooks.push({ varName: arrayMatch[1], line: i + 1 })
      continue
    }

    // Object destructuring: const { name, ... } = useHook(...)
    const objMatch = line.match(/(?:const|let|var)\s+\{(\w+).*?\}\s*=\s*(use\w+)\s*[\(<]/)
    if (objMatch) {
      hooks.push({ varName: objMatch[1], line: i + 1 })
      continue
    }

    // Simple assignment: const name = useHook(...)
    const simpleMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(use\w+)\s*[\(<]/)
    if (simpleMatch) {
      hooks.push({ varName: simpleMatch[1], line: i + 1 })
      continue
    }

    // No assignment: useEffect(...), useLayoutEffect(...)
    const bareMatch = line.match(/^\s*(use\w+)\s*\(/)
    if (bareMatch) {
      hooks.push({ varName: null, line: i + 1 })
    }
  }

  return hooks.length > 0 ? hooks : null
}

export function createReactDevToolsPlugin(config?: DevToolsConfig): Plugin {
  const mergedConfig = { accentColor: '#58c4dc', ...DEFAULT_CONFIG, ...config }
  let projectRoot = ''
  let reactMajor = 0

  return {
    name: '@danendz/devtools-react',
    enforce: 'pre',
    apply: 'serve',

    config() {
      const overlayPath = path.resolve(DIR, 'overlay.mjs').replace(/\\/g, '/')
      const runtimePath = path.resolve(DIR, 'react-runtime.mjs').replace(/\\/g, '/')
      return {
        define: {
          __DEVTOOLS_OVERLAY_URL__: JSON.stringify(`/@fs/${overlayPath}`),
          __DEVTOOLS_RUNTIME_URL__: JSON.stringify(`/@fs/${runtimePath}`),
          __DEVTOOLS_CONFIG__: JSON.stringify(mergedConfig),
        },
      }
    },

    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root
      reactMajor = detectReactMajorVersion(projectRoot)
    },

    transform(code, id) {
      // Only process project source files, not node_modules or virtual modules
      if (!SOURCE_FILE_RE.test(id)) return
      if (id.includes('node_modules') || id.includes('.vite') || id.startsWith('\0')) return

      const components = findComponentDeclarations(code)
      if (components.length === 0) return

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

      if (annotations.length === 0) return
      return { code: code + '\n' + annotations.join('\n'), map: null }
    },

    configureServer(server) {
      // Extend Vite's fs.allow to include the plugin's dist directory
      // Must be done here (not in config hook) to avoid overriding Vite's defaults
      server.config.server.fs.allow.push(DIR)

      server.middlewares.use(createEditorMiddleware(server.config.root))
    },
  }
}
