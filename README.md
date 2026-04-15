# @danendz/vite-dev-tools

[![npm version](https://img.shields.io/npm/v/@danendz/vite-dev-tools)](https://www.npmjs.com/package/@danendz/vite-dev-tools)
[![license](https://img.shields.io/npm/l/@danendz/vite-dev-tools)](https://github.com/Danendz/vite-dev-tools/blob/main/LICENSE)

Lightweight devtools overlay for Vite. Inspect your component tree, capture console errors, and jump to source — all without leaving the browser.

Supports **React** and **Vue 3**.

- Click a component → opens in your editor at the exact line
- Edit a value in the overlay → writes it back to your source file
- Hover any element → instantly find which component owns it
- See only what renders — strips away providers, wrappers, and internals to show your actual UI tree

Console capture with AI-ready copy · Dockable & resizable panel · Hover-to-highlight · Keyboard shortcut toggle · Framework-themed UI

## Why vite-dev-tools?

- **No browser extension needed** — works right inside your app
- **Click any HTML element, not just components** — traces DOM elements back to their owning component
- **Persist edits to source** — official devtools can't write changes back to your files
- **One tool for React and Vue** — zero config, one line in vite.config

## Quick Start

### React

```bash
pnpm add -D @danendz/vite-dev-tools
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devtools } from '@danendz/vite-dev-tools/react'

export default defineConfig({
  plugins: [react(), devtools()],
})
```

### Vue 3

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { devtools } from '@danendz/vite-dev-tools/vue'

export default defineConfig({
  plugins: [vue(), devtools()],
})
```

## Manual Setup

For projects where Vite doesn't serve `index.html` (e.g., WordPress, SSR, micro-frontends), use the `<DevToolsPanel />` component instead. The Vite plugin is still required in `vite.config.ts`.

### React

```tsx
import { DevToolsPanel } from '@danendz/vite-dev-tools/react/devtools'

function App() {
  return (
    <>
      <YourApp />
      <DevToolsPanel />
    </>
  )
}
```

### Vue

```vue
<script setup>
import { DevToolsPanel } from '@danendz/vite-dev-tools/vue/devtools'
</script>

<template>
  <YourApp />
  <DevToolsPanel />
</template>
```

## Configuration

```ts
devtools({
  open: false,
  shortcut: 'ctrl+shift+d',
  accentColor: '#58c4dc', // React default; Vue default is '#42b883'
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `open` | `boolean` | `false` | Show panel on page load |
| `shortcut` | `string` | `'ctrl+shift+d'` | Keyboard shortcut to toggle panel |
| `accentColor` | `string` | framework default | Primary UI color (hex) |

## Compatibility

**Requires** Vite 5+ · React 18+ or Vue 3.3+ · Node 18+

## Contributing

PRs welcome — open an issue first to discuss.

## License

MIT
