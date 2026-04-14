import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, HtmlTagDescriptor } from 'vite'
import type { FrameworkAdapter } from './adapter'
import type { DevToolsConfig } from './types'
import { createEditorMiddleware } from '../shared/editor'
import { DEFAULT_CONFIG, ENDPOINTS } from '../shared/constants'
import { undoStore } from '../shared/undo-store'
import { buildDiff } from '../shared/diff'

const DIR = path.dirname(fileURLToPath(import.meta.url))

const SOURCE_FILE_RE = /\.([jt]sx?|vue)$/

export function createDevtoolsPlugin(adapter: FrameworkAdapter, config?: DevToolsConfig): Plugin {
  const mergedConfig: DevToolsConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    accentColor: config?.accentColor ?? adapter.accent,
    supportedSettings: adapter.supportedSettings,
  }
  let projectRoot = ''

  // Virtual module URLs served via middleware
  const VIRTUAL_CLIENT = `/@danendz-devtools/client`
  const VIRTUAL_RUNTIME = `/@danendz-devtools/${adapter.name}-runtime`

  return {
    name: `@danendz/devtools-${adapter.name}`,
    enforce: 'pre',
    apply: 'serve',

    config() {
      const overlayPath = path.resolve(DIR, 'overlay.mjs').replace(/\\/g, '/')
      const runtimePath = path.resolve(DIR, `${adapter.name}-runtime.mjs`).replace(/\\/g, '/')
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
      const version = adapter.detectVersion(projectRoot)
      if (version) {
        console.log(`[devtools] Detected ${adapter.name} ${version}`)
      }
      // Detect if the JSX transformer injects __source (OXC in Vite 6+, SWC, Babel plugin)
      // esbuild (Vite < 6) does NOT inject __source by default
      const hasJsxSourceTransform = resolvedConfig.plugins?.some(
        (p: any) => p.name === 'vite:oxc' || p.name === 'vite:swc'
      ) ?? false
      ;(adapter as any)._hasJsxSourceTransform = hasJsxSourceTransform
    },

    transformIndexHtml(html) {
      // First let the adapter do any custom HTML injection
      const transformed = adapter.injectHtml(html)

      // Then inject the standard devtools scripts
      const tags: HtmlTagDescriptor[] = [
        {
          // Hook MUST run before the framework loads — inline, non-module, head-prepend
          tag: 'script',
          children: adapter.getHookScript(),
          injectTo: 'head-prepend',
        },
        {
          // Framework runtime — tree walker + commit listener
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

      return { html: transformed, tags }
    },

    transform(code, id) {
      if (!adapter.transform) return
      if (!SOURCE_FILE_RE.test(id)) return
      if (id.includes('node_modules') || id.includes('.vite') || id.startsWith('\0')) return
      return adapter.transform(code, id, projectRoot)
    },

    configureServer(server) {
      // Extend Vite's fs.allow to include the plugin's dist directory
      server.config.server.fs.allow.push(DIR)

      // Shared editor middleware
      server.middlewares.use(createEditorMiddleware(server.config.root))

      // Serve virtual modules as middleware
      server.middlewares.use((req: any, res: any, next: any) => {
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
          const runtimePath = path.resolve(DIR, `${adapter.name}-runtime.mjs`).replace(/\\/g, '/')
          const code = `import "/@fs/${runtimePath}";`
          res.setHeader('Content-Type', 'application/javascript')
          res.end(code)
          return
        }

        next()
      })

      // Generic persist-edit endpoint — delegates to adapter.rewriteSource
      // Supports preview mode (dry-run) via `preview: true` in body
      if (adapter.rewriteSource) {
        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.method !== 'POST' || req.url !== ENDPOINTS.PERSIST_EDIT) return next()

          let body = ''
          req.on('data', (chunk: string) => { body += chunk })
          req.on('end', () => {
            res.setHeader('Content-Type', 'application/json')
            try {
              const { editHint, value, fileName, lineNumber, componentName, preview } = JSON.parse(body)

              let filePath = path.resolve(projectRoot, fileName.replace(/^\//, ''))
              if (!fs.existsSync(filePath)) {
                filePath = fileName
                if (!fs.existsSync(filePath)) {
                  res.statusCode = 400
                  res.end(JSON.stringify({ ok: false, error: 'File not found' }))
                  return
                }
              }

              const source = fs.readFileSync(filePath, 'utf-8')
              const patched = adapter.rewriteSource!(source, {
                editHint,
                value,
                line: lineNumber,
                componentName,
              })

              if (patched === null) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, error: 'Could not rewrite source — target not found' }))
                return
              }

              if (preview) {
                // Return diff without writing
                res.end(JSON.stringify({ ok: true, preview: true, diff: buildDiff(source, patched, fileName, lineNumber) }))
                return
              }

              // Store undo backup before writing
              undoStore.set(filePath, { previousContent: source, timestamp: Date.now() })
              fs.writeFileSync(filePath, patched, 'utf-8')
              res.end(JSON.stringify({ ok: true }))
            } catch (e: any) {
              res.statusCode = 500
              res.end(JSON.stringify({ ok: false, error: e.message }))
            }
          })
        })
      }

      // Undo endpoint — restores the last written file from in-memory backup
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.method !== 'POST' || req.url !== ENDPOINTS.UNDO_EDIT) return next()

        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const { fileName, preview } = JSON.parse(body)

            let filePath = path.resolve(projectRoot, fileName.replace(/^\//, ''))
            if (!fs.existsSync(filePath)) {
              filePath = fileName
            }

            const backup = undoStore.get(filePath)
            if (!backup) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'No undo available for this file' }))
              return
            }

            if (preview) {
              const current = fs.readFileSync(filePath, 'utf-8')
              res.end(JSON.stringify({ ok: true, preview: true, diff: buildDiff(current, backup.previousContent, fileName, 1) }))
              return
            }

            fs.writeFileSync(filePath, backup.previousContent, 'utf-8')
            undoStore.delete(filePath)
            res.end(JSON.stringify({ ok: true }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: e.message }))
          }
        })
      })

      // Let adapter register additional middlewares (e.g. legacy persist endpoints)
      if ((adapter as any).configureServer) {
        (adapter as any).configureServer(server)
      }
    },
  }
}

