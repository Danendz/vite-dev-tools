# CLAUDE.md — AI Development Context

## Project

`@danendz/vite-dev-tools` — A Vite plugin that provides a browser-embedded devtools overlay for React and Vue applications. Inspect component trees, capture console errors, edit state/props live, and jump to source. Includes an MCP server (24 tools) so AI agents can query and control the overlay.

## Architecture

Framework-agnostic core with adapter pattern. Each adapter (React, Vue) implements `FrameworkAdapter` and calls `createDevtoolsPlugin()` from the shared plugin factory.

- **Core** (`src/core/`) — Plugin factory, adapter interface, types, client bootstrap (mounts Preact overlay in Shadow DOM), console capture, editor integration.
- **Overlay** (`src/core/overlay/`) — Preact UI inside Shadow DOM. Root state in `App.tsx`, dockable panel with tabs (tree, detail, console, renders, settings). `state-store.ts` bridges overlay UI with MCP server.
- **MCP** (`src/core/mcp/`) — 24 tools over Streamable HTTP at `/__devtools/mcp`. Server defines tools, bridge routes RPC over Vite HMR WebSocket to browser-side handlers. Categories: query (7), action (4), interaction (5), render-cause (5), deep inspection (3: `getHookTree`, `getLocalVars`, `getWatchers`).
- **React Adapter** (`src/adapters/react/`) — Fiber tree walking, version-aware source transforms (React 18 `_debugSource` vs React 19+ injected `__devtools_source`), render-cause attribution (props/state/context/parent/mount/bailout), commit history ring buffer, persistent fiber identity via WeakMap.
- **Vue Adapter** (`src/adapters/vue/`) — Instance tree walking, reactive state extraction, composable introspection, watcher detection, provide/inject navigation, component usage map via `@vue/compiler-sfc` AST.
- **Shared** (`src/shared/`) — Constants, AST utilities, diffing, value preview, undo store, editor middleware.

## Build & Test

```bash
pnpm build        # one-time build
pnpm dev          # watch mode
pnpm typecheck    # run tsc --noEmit
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm test:coverage # run tests with coverage report
```

Always run `pnpm typecheck` after changes. Tests use **Vitest** with **happy-dom**. Test files in `tests/` mirror `src/` structure. Path aliases: `@/` → `src/`, `@helpers/` → `tests/helpers/`. CI runs `typecheck` → `test` → `build` on every PR.

## Test App

Located at `~/Projects/test-devtools`. Uses the plugin via `pnpm link:../vite-dev-tools`. After building the plugin, reload the test app to see changes.

## Key Patterns

- **Styles are CSS-in-JS** (`styles.ts`) because the overlay lives in Shadow DOM. Regular CSS files cannot reach into shadow roots.
- **CSS custom properties** `--accent` and `--accent-rgb` are set on the shadow host by `client.ts`. All accent colors use `var(--accent)` / `rgba(var(--accent-rgb), opacity)`. Each adapter sets its own accent (React = `#58c4dc`, Vue = `#42b883`).
- **Communication** between runtime and overlay uses `CustomEvent` on `window` (`devtools:tree-update`, `devtools:rewalk`).
- **Library component detection**: Components without source location info are from libraries. `hideLibrary` mode skips them and re-parents their children.
- **Element picker**: Reverse `Map<HTMLElement, NormalizedNode>` rebuilt on each tree update. Capture-phase listeners on `document`, ignoring clicks inside the devtools shadow host.
- **Preact, not React**: The overlay uses Preact to avoid conflicts with the host app. JSX via `jsxImportSource: 'preact'` in tsconfig.
- **MCP bridge over HMR**: AI agent → HTTP `/__devtools/mcp` → MCP server → `bridge.request()` over HMR → browser handler reads/mutates `devtoolsState` → response. Actions triggered by AI are tagged with `source: 'ai'`.
- **Render-cause attribution** (opt-in via Settings): Diffs `fiber.alternate` (React) or tracks Vue reactivity to detect why components re-rendered. Causes collected into `CommitRecord` ring buffer. UI: colored pip in tree + "Why" in DetailPanel + "Renders" tab. MCP: 5 render-cause tools.
- **Persistent fiber identity**: Stable numeric ID per fiber via WeakMap, mirrored to `fiber.alternate`. React 19 aggressively detaches alternates — `isKnownFiber()` prevents false mount labels.
- **Max-delay debounce**: Commit walks debounced at 100ms but capped at 200ms burst duration, so high-frequency updates still get recorded.

## When Adding Features

- State goes in `App.tsx`, passed through `Panel.tsx` to leaf components.
- Styles go in `styles.ts` (Shadow DOM). Use `var(--accent)` for accent colors.
- New localStorage keys go in `STORAGE_KEYS` in `constants.ts`.
- New MCP tools: handler in `bridge-client.ts` (or `render-history-handlers.ts`), tool definition in `mcp-server.ts`.
- Adapter-specific server endpoints: use `adapter.configureServer()`.
- Modifying walkers (`fiber-walker.ts`, `instance-walker.ts`) or runtimes (`client-runtime.ts`) can break tree updates — verify the overlay still receives data.
- **Always run `pnpm build` after changes.** The test app uses the built output, not source files. Without rebuilding, changes won't be visible. Run `pnpm typecheck` as well, then reload the test app.
- **Do not commit after every change.** Only commit when the user explicitly asks to commit or when a logical feature is fully complete and verified.
- **Do not commit plan files to the repo.** Plans should stay in `~/.claude/plans/` and never be added to git.
