# CLAUDE.md — AI Development Context

## Project

`@danendz/vite-dev-tools` — A Vite plugin that provides a browser-embedded devtools overlay for React applications. Inspect component trees, capture console errors, and jump to source.

## Architecture

Three layers, each with separate build targets:

### 1. Server Plugin (Node.js) — `src/adapters/react/`
- `plugin.ts` — Vite plugin factory. Detects React version, injects scripts into HTML, serves virtual modules, provides editor middleware.
- `hook.ts` — Inline script injected before React loads. Sets up `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` to intercept fiber commits.
- `index.ts` — Public entry point. Exports `devtools()` function and `DevToolsConfig` type.

### 2. Browser Runtime — `src/adapters/react/`
- `client-runtime.ts` — Listens for fiber commit events, calls `walkFiberTree()`, dispatches tree update events to the overlay.
- `fiber-walker.ts` — Walks React fiber tree and normalizes to `NormalizedNode[]`. Handles React 18 (`_debugSource`) and React 19+ (`__devtools_source` injected by Vite transform, `_debugStack` fallback). Supports `hideLibrary` mode to skip `node_modules` components.

### 3. UI Overlay — `src/core/`
- Built with **Preact** (not React) inside **Shadow DOM** for isolation.
- `client.ts` — Mounts Preact app, sets CSS custom properties for accent color.
- `overlay/App.tsx` — Root component, manages all state (tree, selection, picker, console, settings).
- `overlay/Panel.tsx` — Dockable/resizable panel with tabs, header controls (picker, settings, dock buttons).
- `overlay/TreeView.tsx` + `TreeNode.tsx` — Recursive component tree with collapse, expand, scroll-into-view.
- `overlay/DetailPanel.tsx` — Props, hooks, state inspector for selected component.
- `overlay/ConsolePane.tsx` — Error/warning log with filter, clear, copy-for-AI.
- `overlay/SettingsPopover.tsx` — Settings dropdown (hide library, font size).
- `overlay/Highlight.tsx` — DOM element highlight overlay.
- `overlay/styles.ts` — All CSS as template string (required for Shadow DOM injection). Uses `var(--accent)` and `var(--accent-rgb)` CSS custom properties for framework-specific theming.

### Shared — `src/shared/`
- `constants.ts` — Event names, localStorage keys, endpoints, default config.
- `editor.ts` — Express middleware for `launch-editor` integration.

### Core utilities — `src/core/`
- `types.ts` — All TypeScript interfaces (`NormalizedNode`, `DevToolsConfig`, `ConsoleEntry`, etc.).
- `collapse.ts` — Component collapse/show/hide overrides (localStorage-backed).
- `console-capture.ts` — Patches `console.error/warn`, listens for `error`/`unhandledrejection` events.
- `console-format.ts` — Formats console entries for clipboard (structured prefix for AI).
- `communication.ts` — `openInEditor()` HTTP call.

## Build

```bash
pnpm build    # one-time build
pnpm dev      # watch mode
```

tsup produces two build targets:
1. `dist/react.js` + `dist/react.d.ts` — Server plugin (ESM, Node.js)
2. `dist/overlay.mjs` + `dist/react-runtime.mjs` — Browser bundles (ESM)

## Test App

Located at `~/Projects/test-devtools`. Uses the plugin via `pnpm link:../vite-dev-tools`. After building the plugin, reload the test app to see changes.

## Key Patterns

- **Styles are CSS-in-JS** (`styles.ts`) because the overlay lives in Shadow DOM. Regular CSS files cannot reach into shadow roots.
- **CSS custom properties** `--accent` and `--accent-rgb` are set on the shadow host by `client.ts`. All accent colors in styles use `var(--accent)` / `rgba(var(--accent-rgb), opacity)`. Each framework adapter sets its own accent (React = `#58c4dc`).
- **Communication** between the runtime and overlay uses `CustomEvent` on `window`. Events: `devtools:tree-update`, `devtools:rewalk`.
- **Library component detection**: `isFromNodeModules()` in `fiber-walker.ts` — if a component has no source location (no `__devtools_source`, no `_debugSource`), it's from a library. Our Vite transform only injects `__devtools_source` on user files.
- **`hideLibrary` mode**: When enabled, `walkFiberChildren` skips library components and re-parents their children to the nearest user component.
- **Element picker**: Builds a reverse `Map<HTMLElement, NormalizedNode>` on each tree update. During picker mode, `mousemove`/`click` listeners on `document` (capture phase) look up hovered elements in the map. Ignores clicks inside the devtools shadow host.
- **Preact, not React**: The overlay uses Preact to avoid conflicts with the host app's React. JSX configured via `jsxImportSource: 'preact'` in tsconfig.

## React Version Handling

- **React 18**: `fiber._debugSource` available on fibers. No code transform needed.
- **React 19+**: `_debugSource` removed. Plugin injects `__devtools_source` via Vite `transform` hook on user source files. Fallback: parse `fiber._debugStack` for usage-site location (line numbers may be approximate).

## When Adding New Features

- Add state in `App.tsx`, pass props through `Panel.tsx` to leaf components.
- Add styles to `styles.ts` — append new CSS sections. Use `var(--accent)` for accent colors.
- Add new localStorage keys to `STORAGE_KEYS` in `constants.ts`.
- Always run `pnpm build` after changes and reload the test app.
- If modifying `fiber-walker.ts` or `client-runtime.ts` (browser runtime), the tree structure or communication may change — verify the overlay still receives updates.
