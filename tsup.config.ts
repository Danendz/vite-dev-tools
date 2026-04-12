import { defineConfig } from 'tsup'

export default defineConfig([
  // Server plugin (Node.js, imported in vite.config.ts)
  {
    entry: { react: 'src/adapters/react/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['vite', 'launch-editor'],
  },
  // Client overlay (browser, served by Vite dev server)
  {
    entry: {
      overlay: 'src/core/client.ts',
      'react-runtime': 'src/adapters/react/client-runtime.ts',
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
