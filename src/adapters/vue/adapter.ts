import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import type { FrameworkAdapter, RewriteEdit } from '../../core/adapter'
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

    // Match: :propKey="value" (bound prop expression)
    const boundRe = new RegExp(`(:${propKey}\\s*=\\s*)"([^"]*)"`)
    if (boundRe.test(line)) {
      lines[i] = line.replace(boundRe, `$1"${serialized}"`)
      return lines.join('\n')
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

  // No custom transform — unplugin-vue-source handles source annotations
  transform: undefined,

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

  composedPlugins(): Plugin[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('unplugin-vue-source')
      const plugin = mod.default?.vite ?? mod.vite ?? mod.default
      if (typeof plugin === 'function') {
        return [plugin()]
      }
    } catch {
      // unplugin-vue-source not installed — fall back to file-level __file
    }
    return []
  },
}
