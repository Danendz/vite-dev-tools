import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, HtmlTagDescriptor } from 'vite'
import type { FrameworkAdapter } from './adapter'
import type { DevToolsConfig } from './types'
import { createEditorMiddleware } from '../shared/editor'
import { DEFAULT_CONFIG, ENDPOINTS } from '../shared/constants'

const DIR = path.dirname(fileURLToPath(import.meta.url))

const SOURCE_FILE_RE = /\.[jt]sx?$/

export function createDevtoolsPlugin(adapter: FrameworkAdapter, config?: DevToolsConfig): Plugin {
  const mergedConfig: DevToolsConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    accentColor: config?.accentColor ?? adapter.accent,
    supportedSettings: adapter.supportedSettings,
  }
  let projectRoot = ''

  const composedPlugins = adapter.composedPlugins?.() ?? []

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
        plugins: composedPlugins,
      }
    },

    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root
      const version = adapter.detectVersion(projectRoot)
      if (version) {
        console.log(`[devtools] Detected ${adapter.name} ${version}`)
      }
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
      if (adapter.rewriteSource) {
        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.method !== 'POST' || req.url !== ENDPOINTS.PERSIST_EDIT) return next()

          let body = ''
          req.on('data', (chunk: string) => { body += chunk })
          req.on('end', () => {
            res.setHeader('Content-Type', 'application/json')
            try {
              const { editHint, value, fileName, lineNumber, componentName } = JSON.parse(body)

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

              fs.writeFileSync(filePath, patched, 'utf-8')
              res.end(JSON.stringify({ ok: true }))
            } catch (e: any) {
              res.statusCode = 500
              res.end(JSON.stringify({ ok: false, error: e.message }))
            }
          })
        })
      }

      // Let adapter register additional middlewares (e.g. legacy persist endpoints)
      if ((adapter as any).configureServer) {
        (adapter as any).configureServer(server)
      }
    },
  }
}
