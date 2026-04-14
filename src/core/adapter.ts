import type { Plugin } from 'vite'

export interface EditHint {
  kind: string
  [key: string]: unknown
}

export interface RewriteEdit {
  editHint: EditHint
  value: unknown
  line: number
  componentName: string
}

export interface FrameworkAdapter {
  /** Framework identifier */
  name: string
  /** CSS accent color hex (e.g. '#58c4dc' for React, '#42b883' for Vue) */
  accent: string
  /** Resolved virtual module ID for the framework runtime */
  virtualRuntimeId: string
  /** Which settings toggles the overlay should show (e.g. ['hideLibrary', 'hideProviders']) */
  supportedSettings: string[]

  // --- Server-side (Vite plugin) ---

  /** Detect installed framework version. Returns version string or null if not found. */
  detectVersion(root: string): string | null
  /** Optional Vite transform hook for source annotation (e.g. React 19+ __devtools_source) */
  transform?(code: string, id: string, projectRoot: string): { code: string; map: null } | null
  /** Return the runtime module source code to serve as a virtual module */
  buildRuntimeModule(): string
  /** Return the inline hook script that must run before the framework loads */
  getHookScript(): string
  /** Optional additional HTML injection (e.g. for proxied backends) */
  injectHtml(html: string): string

  /** Rewrite source code for persist-to-source. Returns patched source or null if no match. */
  rewriteSource?(source: string, edit: RewriteEdit): string | null

  /** Return additional Vite plugins to compose (e.g. unplugin-vue-source) */
  composedPlugins?(): Plugin[]
}
