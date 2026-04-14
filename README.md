# @danendz/vite-dev-tools

Lightweight devtools overlay for Vite. Inspect your component tree, capture console errors, and jump to source — all without leaving the browser.

Supports **React** and **Vue 3**.

## Features

- **Component tree inspector** — browse your component tree with props, state, and hooks (React) or setup/computed/provide/inject (Vue)
- **Console capture** — errors and warnings captured with stack traces, structured copy for AI
- **Element picker** — click any element on the page to find its component in the tree
- **Library filtering** — hide `node_modules` components to see only your code
- **Open in Editor** — click to open any component in your IDE
- **Live editing** — edit props and state values at runtime, persist changes to source
- **Dockable panel** — dock to bottom, left, or right; resize by dragging
- **Framework theming** — each framework gets its own accent color (React blue, Vue green)

## Install

```bash
pnpm add -D @danendz/vite-dev-tools
```

## React Setup

Add the plugin to your Vite config — that's it. The plugin automatically injects the devtools overlay into your page.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devtools } from '@danendz/vite-dev-tools/react'

export default defineConfig({
  plugins: [react(), devtools()],
})
```

### WordPress / SSR / Micro-frontends

For projects where Vite doesn't serve `index.html` (e.g., WordPress with a proxied backend), use the `<DevToolsPanel />` component instead:

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

The Vite plugin is still required in `vite.config.ts` for source transforms and serving the overlay files.

## Vue 3 Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { devtools } from '@danendz/vite-dev-tools/vue'

export default defineConfig({
  plugins: [vue(), devtools()],
})
```

### WordPress / SSR / Micro-frontends

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

Pass options to the Vite plugin:

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

## Usage

### Keyboard shortcut

Press `Ctrl+Shift+D` (or your custom shortcut) to toggle the panel.

### Inspect tab

Browse the component tree on the left, click a component to see its details on the right:

- **React** — props, hooks (useState, useRef, etc.), class component state
- **Vue** — props, setup state (ref, reactive), computed, provide/inject

Hover a component to highlight it on the page.

### Console tab

Captures `console.error`, `console.warn`, unhandled errors, and promise rejections. Each entry has a copy button that formats the error with stack trace and page URL — ready to paste into AI or an issue tracker.

### Element picker

Click the magnifying glass icon in the panel header. Hover over any element on the page to see which component owns it. Click to select it in the tree. Press `Escape` to cancel.

### Live editing

Double-click a prop or state value to edit it at runtime. For persistable values (React `useState`, Vue `ref`), click "Persist" to save the change back to your source file.

### Library filtering

By default, components from `node_modules` are hidden. Open settings (gear icon) to toggle "Hide library components" off if you need to inspect library internals.

### Settings

Click the gear icon to access:
- **Hide library components** — toggle library component visibility
- **Hide providers** — hide React Context providers (React only)
- **Font size** — adjust tree and detail panel font size (9–14px)
- **Editor** — choose your IDE for "Open in Editor"

## Compatibility

| Dependency | Supported versions |
|------------|-------------------|
| Vite | 5, 6, 7, 8 |
| React | 18, 19+ |
| Vue | 3.3+ |
| Node.js | 18+ |

## License

MIT
