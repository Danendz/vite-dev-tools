# CLAUDE.md — AI Development Context

## Project

`@danendz/vite-dev-tools` — A Vite plugin that provides a browser-embedded devtools overlay for React and Vue applications. Inspect component trees, capture console errors, edit state/props live, and jump to source. Includes an MCP server so AI agents can query and control the overlay.

## Architecture

Framework-agnostic core with adapter pattern. Each adapter (React, Vue) plugs into a shared plugin factory and overlay.

### Core — `src/core/`

- `plugin-factory.ts` — `createDevtoolsPlugin()`: shared Vite plugin logic both adapters call. Injects scripts into HTML, serves virtual modules, registers persistent-edit endpoints (`PERSIST_EDIT`, `PERSIST_TEXT`, `UNDO_EDIT`), optionally initializes MCP server.
- `adapter.ts` — `FrameworkAdapter` interface that React/Vue adapters implement.
- `client.ts` — Mounts the Preact overlay app inside Shadow DOM, sets CSS custom properties for accent color.
- `types.ts` — All TypeScript interfaces (`NormalizedNode`, `DevToolsConfig`, `ConsoleEntry`, etc.).
- `communication.ts` — `openInEditor()` HTTP call.
- `console-capture.ts` — Patches `console.error/warn`, listens for `error`/`unhandledrejection` events.
- `console-format.ts` — Formats console entries for clipboard (structured prefix for AI).

### UI Overlay — `src/core/overlay/`

Built with **Preact** (not React) inside **Shadow DOM** for isolation.

- `App.tsx` — Root component, manages all state (tree, selection, picker, console, settings).
- `Panel.tsx` — Dockable/resizable panel with tabs, header controls (picker, settings, dock buttons).
- `TreeView.tsx` + `TreeNode.tsx` — Recursive component tree with collapse, expand, scroll-into-view.
- `DetailPanel.tsx` — Props, hooks, state inspector for selected component.
- `ConsolePane.tsx` — Error/warning log with filter, clear, copy-for-AI.
- `SettingsModal.tsx` — Full settings modal with tabs: General, Appearance, MCP (connection commands for Claude Code, VS Code, Codex).
- `SettingsPopover.tsx` — Legacy settings dropdown (hide library, font size).
- `Highlight.tsx` — DOM element highlight overlay.
- `state-store.ts` — Shared state object (`devtoolsState`) bridging overlay UI with MCP server. Holds live tree, selected node, console entries, and callbacks.
- `styles.ts` — All CSS as template string (required for Shadow DOM injection). Uses `var(--accent)` and `var(--accent-rgb)` CSS custom properties for framework-specific theming.
- `FloatingIcon.tsx`, `ContextMenu.tsx`, `PreviewModal.tsx`, `ToastContainer.tsx` — Supporting UI components.

### MCP Server — `src/core/mcp/`

Full Model Context Protocol support for AI agents to query/control the overlay. Enabled by default (`mcp: true` in config).

- `mcp-server.ts` — Defines 16 MCP tools: query tools (`listConnectedTabs`, `getComponentTree`, `getSelectedComponent`, `getConsoleErrors`, `getPropsOf`, `getSourceLocation`, `searchComponents`), action tools (`selectComponent`, `highlightDom`, `clearHighlight`, `openInEditor`), and interaction tools (`click`, `type`, `keypress`, `selectOption`, `getElementInfo`).
- `bridge-server.ts` — Vite-server side. Manages browser tab registry and routes RPC requests/responses over Vite HMR WebSocket. Auto-selects most recently focused tab.
- `bridge-client.ts` — Browser side. Registers tab via HMR, handles incoming MCP requests by reading/mutating `devtoolsState`.
- `middleware.ts` — HTTP transport at `/__devtools/mcp`. Handles POST/GET/DELETE for Streamable HTTP MCP sessions.
- `index.ts` — Barrel export.

**MCP flow**: AI agent -> HTTP POST `/__devtools/mcp` -> MCP server -> `bridge.request()` over HMR -> browser handler reads/mutates `devtoolsState` -> response back.

### React Adapter — `src/adapters/react/`

- `adapter.ts` — `FrameworkAdapter` implementation. Detects React version, version-aware transforms (React 18: `_debugSource`; React 19+: injects `__devtools_source` + `__source` prop + component usage map via OXC parser or regex fallback). Edit types: `react-hook` (useState), `react-prop` (JSX attr).
- `client-runtime.ts` — Listens for fiber commit events, calls `walkFiberTree()`, dispatches tree update events.
- `fiber-walker.ts` — Walks React fiber tree, normalizes to `NormalizedNode[]`. Supports `hideLibrary` mode.
- `hook.ts` — Inline script injected before React loads. Sets up `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`.
- `devtools-entry.ts` — `<DevToolsPanel>` React component entry point.
- `index.ts` — Public entry. Exports `devtools()` and `DevToolsConfig`.

### Vue Adapter — `src/adapters/vue/`

- `adapter.ts` — `FrameworkAdapter` implementation. Injects `__DEVTOOLS_USAGE_MAP__` global with component usage locations from `@vue/compiler-sfc` AST or regex fallback. Edit types: `vue-path` (ref()), `vue-prop` (template binding). Custom `PERSIST_PROP` middleware for template-specific logic.
- `client-runtime.ts` — Listens to Vue instance updates, calls `walkInstanceTree()`, tracks pending edits that survive HMR re-walks.
- `instance-walker.ts` — Walks Vue component instance tree, builds `NormalizedNode[]`.
- `state-extractor.ts` — Extracts reactive state from Vue instances.
- `hook.ts` — Inline script for Vue devtools hook setup.
- `devtools-entry.ts` — `<DevToolsPanel>` Vue component entry point.
- `index.ts` — Public entry. Exports `devtools()` and `DevToolsConfig`.

### Shared — `src/shared/`

- `constants.ts` — Event names, localStorage keys, endpoints, bridge events, default config.
- `editor.ts` — Express middleware for `launch-editor` integration.
- `ast-utils.ts` — Shared AST utilities.
- `diff.ts` — Diffing utilities.
- `undo-store.ts` — In-memory undo store for persistent edits.

## Build

```bash
pnpm build        # one-time build
pnpm dev          # watch mode
pnpm typecheck    # run tsc --noEmit
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm test:coverage # run tests with coverage report
```

Always run `pnpm typecheck` after changes to catch type errors.

## Testing

Tests use **Vitest** with **happy-dom** for DOM-dependent tests. Test files live in `tests/` mirroring the `src/` structure.

Path aliases: `@/` → `src/`, `@helpers/` → `tests/helpers/` (configured in `vitest.config.ts`).

### What's tested

| Layer | Files | What |
|-------|-------|------|
| Pure utilities | `diff`, `ast-utils`, `tree-utils`, `console-format` | Pure functions, no mocking |
| DOM interaction | `dispatch-events`, `resolve-element`, `settle`, `action-response`, `console-capture` | happy-dom environment |
| MCP server/bridge | `bridge-server`, `mcp-server`, `bridge-client`, `middleware` | Mock HMR + HTTP |
| Framework walkers | `fiber-walker`, `instance-walker`, `state-extractor` | Hand-crafted fake fibers/instances |
| Adapter transforms | `react/adapter`, `vue/adapter` | Assertion-based (no snapshots) |

### What's NOT tested

- **Overlay UI components** (Preact `.tsx` files) — low ROI for devtools visual correctness
- **`plugin-factory.ts`** — would require full Vite server mock
- **`client-runtime.ts`** — tightly coupled to React/Vue runtime internals

### CI

GitHub Actions runs on every PR to `main`: `typecheck` → `test` → `build`. See `.github/workflows/ci.yml`.

tsup produces 7 outputs across 5 entries:

| Entry | Output | Target | Description |
|-------|--------|--------|-------------|
| `src/adapters/react/index.ts` | `dist/react.js` + `.d.ts` | Node.js (ESM) | React server plugin |
| `src/adapters/react/devtools-entry.ts` | `dist/devtools.js` + `.d.ts` | Browser (ESM) | React `<DevToolsPanel>` component |
| `src/adapters/vue/index.ts` | `dist/vue.js` + `.d.ts` | Node.js (ESM) | Vue server plugin |
| `src/adapters/vue/devtools-entry.ts` | `dist/vue-devtools.js` + `.d.ts` | Browser (ESM) | Vue `<DevToolsPanel>` component |
| `src/core/client.ts` + runtimes | `dist/overlay.mjs`, `dist/react-runtime.mjs`, `dist/vue-runtime.mjs` | Browser (ESM) | Preact overlay + framework runtimes |

## Test App

Located at `~/Projects/test-devtools`. Uses the plugin via `pnpm link:../vite-dev-tools`. After building the plugin, reload the test app to see changes.

## Key Patterns

- **Styles are CSS-in-JS** (`styles.ts`) because the overlay lives in Shadow DOM. Regular CSS files cannot reach into shadow roots.
- **CSS custom properties** `--accent` and `--accent-rgb` are set on the shadow host by `client.ts`. All accent colors in styles use `var(--accent)` / `rgba(var(--accent-rgb), opacity)`. Each framework adapter sets its own accent (React = `#58c4dc`).
- **Communication** between the runtime and overlay uses `CustomEvent` on `window`. Events: `devtools:tree-update`, `devtools:rewalk`.
- **Library component detection**: Components without source location info are from libraries. Vite transform only injects source on user files.
- **`hideLibrary` mode**: Skips library components and re-parents their children to the nearest user component.
- **Element picker**: Builds a reverse `Map<HTMLElement, NormalizedNode>` on each tree update. During picker mode, `mousemove`/`click` listeners on `document` (capture phase) look up hovered elements in the map. Ignores clicks inside the devtools shadow host.
- **Preact, not React**: The overlay uses Preact to avoid conflicts with the host app's React/Vue. JSX configured via `jsxImportSource: 'preact'` in tsconfig.
- **MCP bridge over HMR**: MCP server communicates with browser overlay via Vite's HMR WebSocket (bridge events in `constants.ts`). Actions triggered by AI are tagged with `source: 'ai'`.
- **Adapter pattern**: Both React and Vue adapters implement `FrameworkAdapter` and call `createDevtoolsPlugin()` from `plugin-factory.ts`.

## React Version Handling

- **React 18**: `fiber._debugSource` available on fibers. No code transform needed.
- **React 19+**: `_debugSource` removed. Plugin injects `__devtools_source` via Vite `transform` hook on user source files. Also injects `__source` prop on host elements and builds component usage map. Fallback: parse `fiber._debugStack` for usage-site location (line numbers may be approximate).

## When Adding New Features

- Add state in `App.tsx`, pass props through `Panel.tsx` to leaf components.
- Add styles to `styles.ts` — append new CSS sections. Use `var(--accent)` for accent colors.
- Add new localStorage keys to `STORAGE_KEYS` in `constants.ts`.
- Always run `pnpm build` and `pnpm typecheck` after changes and reload the test app.
- If modifying walker files (`fiber-walker.ts`, `instance-walker.ts`) or runtime files (`client-runtime.ts`), the tree structure or communication may change — verify the overlay still receives updates.
- If adding MCP tools, add handler in `bridge-client.ts` and tool definition in `mcp-server.ts`.
- For adapter-specific server endpoints, use `adapter.configureServer()`.
