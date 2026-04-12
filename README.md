# @danendz/vite-dev-tools

Lightweight devtools overlay for Vite + React. Inspect your component tree, capture console errors, and jump to source — all without leaving the browser.

## Features

- **Component tree inspector** — browse your React component tree with props, hooks, and state
- **Console capture** — errors and warnings captured with stack traces, structured copy for AI
- **Element picker** — click any element on the page to find its component in the tree
- **Library filtering** — hide `node_modules` components (Chakra UI, MUI, etc.) to see only your code
- **Open in Editor** — click to open any component in your IDE
- **Dockable panel** — dock to bottom, left, or right; resize by dragging
- **Framework theming** — React gets its own accent color; extensible per framework

## Install

```bash
pnpm add -D @danendz/vite-dev-tools
```

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devtools } from '@danendz/vite-dev-tools/react'

export default defineConfig({
  plugins: [react(), devtools()],
})
```

The plugin only runs in `serve` mode — it's automatically excluded from production builds.

## Configuration

```ts
devtools({
  open: false,           // panel open by default
  shortcut: 'ctrl+shift+d', // keyboard shortcut to toggle
  accentColor: '#58c4dc',   // UI accent color (default: React cyan)
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `open` | `boolean` | `false` | Show panel on page load |
| `shortcut` | `string` | `'ctrl+shift+d'` | Keyboard shortcut to toggle panel |
| `accentColor` | `string` | `'#58c4dc'` | Primary UI color (hex) |

## Usage

### Keyboard shortcut

Press `Ctrl+Shift+D` (or your custom shortcut) to toggle the panel.

### Inspect tab

Browse the component tree on the left, click a component to see its props, hooks, and state on the right. Hover a component to highlight it on the page.

### Console tab

Captures `console.error`, `console.warn`, unhandled errors, and promise rejections. Each entry has a copy button that formats the error with stack trace and page URL — ready to paste into AI or an issue tracker.

### Element picker

Click the magnifying glass icon in the panel header. Hover over any element on the page to see which component owns it. Click to select it in the tree. Press `Escape` to cancel.

### Library filtering

By default, components from `node_modules` are hidden. Open settings (gear icon) to toggle "Hide library components" off if you need to inspect library internals.

### Settings

Click the gear icon to access:
- **Hide library components** — toggle library component visibility
- **Font size** — adjust tree and detail panel font size (9–14px)

## Compatibility

| Dependency | Supported versions |
|------------|-------------------|
| Vite | 5, 6, 7, 8 |
| React | 18, 19+ |
| Node.js | 18+ |

## License

MIT
