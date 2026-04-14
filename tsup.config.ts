import { defineConfig } from 'tsup'

export default defineConfig([
  // React server plugin (Node.js, imported in vite.config.ts)
  {
    entry: { react: 'src/adapters/react/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['vite', 'launch-editor', 'oxc-parser'],
  },
  // React component (browser, imported in app code)
  {
    entry: { devtools: 'src/adapters/react/devtools-entry.ts' },
    format: ['esm'],
    dts: true,
    external: ['react'],
  },
  // Vue server plugin (Node.js, imported in vite.config.ts)
  {
    entry: { vue: 'src/adapters/vue/index.ts' },
    format: ['esm'],
    dts: true,
    external: ['vite', 'launch-editor', 'unplugin-vue-source', 'oxc-parser'],
  },
  // Vue component (browser, imported in app code)
  {
    entry: { 'vue-devtools': 'src/adapters/vue/devtools-entry.ts' },
    format: ['esm'],
    dts: true,
    external: ['vue'],
  },
  // Client bundles (browser, served by Vite dev server)
  {
    entry: {
      overlay: 'src/core/client.ts',
      'react-runtime': 'src/adapters/react/client-runtime.ts',
      'vue-runtime': 'src/adapters/vue/client-runtime.ts',
    },
    format: ['esm'],
    outExtension: () => ({ js: '.mjs' }),
    external: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
    minify: false,
    splitting: false,
    esbuildOptions(options) {
      options.jsx = 'automatic'
      options.jsxImportSource = 'preact'
    },
  },
])
