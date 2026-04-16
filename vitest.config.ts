import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@helpers': path.resolve(__dirname, 'tests/helpers'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/core/mcp/interaction/**', 'happy-dom'],
      ['tests/core/console-capture.test.ts', 'happy-dom'],
      ['tests/core/console-format.test.ts', 'happy-dom'],
      ['tests/core/mcp/bridge-client.test.ts', 'happy-dom'],
      ['tests/adapters/vue/instance-walker.test.ts', 'happy-dom'],
      ['tests/adapters/react/fiber-walker.test.ts', 'happy-dom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.tsx',
        'src/**/index.ts',
        'src/env.d.ts',
        'src/**/hook.ts',
        'src/**/devtools-entry.ts',
        'src/**/client-runtime.ts',
        'src/core/client.ts',
      ],
    },
  },
})
