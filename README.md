# @danendz/vite-dev-tools

[![npm version](https://img.shields.io/npm/v/@danendz/vite-dev-tools)](https://www.npmjs.com/package/@danendz/vite-dev-tools)
[![license](https://img.shields.io/npm/l/@danendz/vite-dev-tools)](https://github.com/Danendz/vite-dev-tools/blob/main/LICENSE)

Lightweight devtools overlay for Vite. Inspect your component tree, capture console errors, and jump to source — all without leaving the browser. Built-in MCP server lets AI agents query and control your running app.

Supports **React** and **Vue 3**.

- Click a component → opens in your editor at the exact line
- Edit a value in the overlay → writes it back to your source file
- Hover any element → instantly find which component owns it
- See only what renders — strips away providers, wrappers, and internals to show your actual UI tree
- AI agents can inspect your component tree, read props/state, highlight elements, and interact with the UI (click, type, select) via MCP

Console capture with AI-ready copy · Dockable & resizable panel · Hover-to-highlight · Keyboard shortcut toggle · Framework-themed UI · MCP server for AI agents

## Why vite-dev-tools?

- **No browser extension needed** — works right inside your app
- **Click any HTML element, not just components** — traces DOM elements back to their owning component
- **Persist edits to source** — official devtools can't write changes back to your files
- **One tool for React and Vue** — zero config, one line in vite.config
- **AI-ready** — built-in MCP server so Claude, Copilot, and Codex can see what's on screen

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
  mcp: true, // Enable MCP server (default: true)
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `open` | `boolean` | `false` | Show panel on page load |
| `shortcut` | `string` | `'ctrl+shift+d'` | Keyboard shortcut to toggle panel |
| `accentColor` | `string` | framework default | Primary UI color (hex) |
| `mcp` | `boolean` | `true` | Enable MCP server for AI agents |

## MCP Server

The built-in MCP server lets AI coding agents inspect and interact with your running app. It exposes 16 tools over Streamable HTTP at `/__devtools/mcp`.

### Connecting your AI agent

**Claude Code:**
```bash
claude mcp add vite-devtools --transport http http://localhost:5173/__devtools/mcp
```

**VS Code (Copilot)** — add to `.vscode/settings.json`:
```json
{
  "mcp": {
    "servers": {
      "vite-devtools": {
        "type": "http",
        "url": "http://localhost:5173/__devtools/mcp"
      }
    }
  }
}
```

**Codex:**
```bash
codex --mcp-config '{"vite-devtools":{"type":"url","url":"http://localhost:5173/__devtools/mcp"}}'
```

Replace `5173` with your Vite dev server port.

### Available tools

**Query tools:**

| Tool | Description |
|------|-------------|
| `listConnectedTabs` | List all browser tabs connected to devtools |
| `getComponentTree` | Get the live component tree (supports depth limit) |
| `getSelectedComponent` | Get the currently selected component's full details |
| `getPropsOf` | Get props, state, and hooks for a component by ID |
| `getSourceLocation` | Get where a component is defined and where it's used |
| `searchComponents` | Search components by name |
| `getConsoleErrors` | Get captured console errors and warnings |

**Action tools:**

| Tool | Description |
|------|-------------|
| `selectComponent` | Select a component in the devtools panel |
| `highlightDom` | Highlight a component's DOM elements in the browser |
| `clearHighlight` | Clear any active AI highlight |
| `openInEditor` | Open a component's source file in your editor |

**Interaction tools** — for AI-driven testing and automation:

| Tool | Description |
|------|-------------|
| `click` | Click a DOM element by component nodeId, CSS selector, or visible text |
| `type` | Type text into an input or textarea (works with React controlled inputs and Vue `v-model`) |
| `keypress` | Press a keyboard key (Enter, Escape, Tab, etc.) on a targeted element |
| `selectOption` | Select an option from a `<select>` dropdown |
| `getElementInfo` | Get element details: text content, visibility, attributes, and bounding rect |

Interaction tools support three targeting methods (at least one required):
- **`nodeId`** — component node ID from the tree, scopes to that component's DOM subtree
- **`selector`** — CSS selector, scoped to component if `nodeId` is also given
- **`text`** — find element by visible text content (e.g., click the "Submit" button)

Action responses include whether the DOM settled after the interaction, how many elements matched, and any console errors that occurred during the action.

### Multi-tab support

When multiple browser tabs are open, the MCP server auto-targets the most recently focused tab. All tools accept an optional `tab` parameter to target a specific tab by ID.

## Compatibility

**Requires** Vite 5+ · React 18+ or Vue 3.3+ · Node 18+

## Contributing

PRs welcome — open an issue first to discuss.

## License

MIT
