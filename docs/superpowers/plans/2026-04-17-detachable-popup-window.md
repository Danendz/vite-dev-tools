# Detachable Popup Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to detach the devtools panel into a separate `window.open()` popup while preserving all existing functionality (element picker, highlights, MCP bridge, console capture, render-cause tracking).

**Architecture:** The single Preact `App` instance moves between the in-page Shadow DOM and the popup window. When detached, the page shows a floating button + highlight overlays in the existing Shadow DOM, while the popup renders the full panel. A `BroadcastChannel` enables reconnection after page reload. The popup is invisible to MCP tab routing — zero bridge changes needed.

**Tech Stack:** Preact, CSS-in-JS (`styles.ts`), BroadcastChannel API, `window.open()`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/core/overlay/popup-manager.ts` | Opens/closes popup window, manages lifecycle, BroadcastChannel reconnection, mounts/unmounts App between Shadow DOM and popup |
| Create | `src/core/overlay/DetachedButton.tsx` | Floating button shown when detached (framework icon + external-window badge), click to refocus popup |
| Create | `tests/core/overlay/popup-manager.test.ts` | Tests for popup-manager lifecycle, reconnection, state reset |
| Modify | `src/core/overlay/App.tsx` | Add detach/re-dock callbacks, render `DetachedButton` + `Highlight` when detached, skip `Panel`/`FloatingIcon` when detached |
| Modify | `src/core/overlay/Panel.tsx` | Accept `mode: 'docked' \| 'popup'` prop, hide dock/resize controls in popup mode, show "dock back" button in popup mode |
| Modify | `src/core/overlay/styles.ts` | Add styles for `DetachedButton` and popup-mode panel |
| Modify | `src/shared/constants.ts` | Add `STORAGE_KEYS.DETACHED`, `STORAGE_KEYS.POPUP_WIDTH`, `STORAGE_KEYS.POPUP_HEIGHT` |
| Modify | `src/core/client.ts` | Export shadow root references for popup-manager to use, pass popup-manager to App |

---

## Task 1: Add New Storage Keys

**Files:**
- Modify: `src/shared/constants.ts:21-37`
- Test: `tests/shared/constants.test.ts` (not needed — constants are trivial)

- [ ] **Step 1: Add storage keys to constants.ts**

In `src/shared/constants.ts`, add three new keys to the `STORAGE_KEYS` object:

```typescript
// Inside STORAGE_KEYS, after RENDER_INCLUDE_VALUES:
  DETACHED: 'danendz-devtools:detached',
  POPUP_WIDTH: 'danendz-devtools:popup-width',
  POPUP_HEIGHT: 'danendz-devtools:popup-height',
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants.ts
git commit -m "feat: add storage keys for detachable popup window"
```

---

## Task 2: Create popup-manager Module

This is the core module that handles opening/closing the popup, mounting the App into it, BroadcastChannel lifecycle, and reconnection.

**Files:**
- Create: `src/core/overlay/popup-manager.ts`
- Create: `tests/core/overlay/popup-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/overlay/popup-manager.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STORAGE_KEYS } from '@/shared/constants'

// happy-dom does not implement BroadcastChannel; provide a minimal stub
class FakeBroadcastChannel {
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
  constructor(name: string) { this.name = name }
}

vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

// Stub window.open — happy-dom doesn't support it
const mockPopupWindow = {
  document: {
    head: { appendChild: vi.fn() },
    body: {} as HTMLElement,
    title: '',
    createElement: vi.fn((tag: string) => {
      const el = document.createElement(tag)
      return el
    }),
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  close: vi.fn(),
  closed: false,
  focus: vi.fn(),
}

vi.stubGlobal('open', vi.fn().mockReturnValue(mockPopupWindow))

import {
  createPopupManager,
  type PopupManager,
} from '@/core/overlay/popup-manager'

describe('popup-manager', () => {
  let manager: PopupManager

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    manager = createPopupManager({
      accentColor: '#58c4dc',
      pageTitle: 'Test App',
    })
  })

  afterEach(() => {
    manager.destroy()
  })

  it('starts in docked state', () => {
    expect(manager.isDetached()).toBe(false)
  })

  it('detach opens a popup window', () => {
    manager.detach()
    expect(window.open).toHaveBeenCalledWith(
      '',
      'vite-devtools-popup',
      expect.stringContaining('width=900'),
    )
    expect(manager.isDetached()).toBe(true)
  })

  it('detach sets localStorage DETACHED flag', () => {
    manager.detach()
    expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBe('true')
  })

  it('dock clears DETACHED flag and closes popup', () => {
    manager.detach()
    manager.dock()
    expect(manager.isDetached()).toBe(false)
    expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBe(null)
    expect(mockPopupWindow.close).toHaveBeenCalled()
  })

  it('uses persisted popup size from localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.POPUP_WIDTH, '1000')
    localStorage.setItem(STORAGE_KEYS.POPUP_HEIGHT, '700')
    manager.detach()
    expect(window.open).toHaveBeenCalledWith(
      '',
      'vite-devtools-popup',
      expect.stringContaining('width=1000'),
    )
    expect(window.open).toHaveBeenCalledWith(
      '',
      'vite-devtools-popup',
      expect.stringContaining('height=700'),
    )
  })

  it('refocusPopup calls focus on popup window', () => {
    manager.detach()
    manager.refocusPopup()
    expect(mockPopupWindow.focus).toHaveBeenCalled()
  })

  it('refocusPopup is a no-op when docked', () => {
    manager.refocusPopup()
    expect(mockPopupWindow.focus).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/core/overlay/popup-manager.test.ts`
Expected: FAIL — `Cannot find module '@/core/overlay/popup-manager'`

- [ ] **Step 3: Write the popup-manager implementation**

Create `src/core/overlay/popup-manager.ts`:

```typescript
import { STORAGE_KEYS } from '../../shared/constants'
import { STYLES } from './styles'

const CHANNEL_NAME = 'vite-devtools'
const POPUP_WINDOW_NAME = 'vite-devtools-popup'
const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 600
const RECONNECT_TIMEOUT_MS = 3000

export interface PopupManagerConfig {
  accentColor: string
  pageTitle: string
}

export interface PopupManager {
  isDetached(): boolean
  detach(): Window | null
  dock(): void
  refocusPopup(): void
  getPopupWindow(): Window | null
  /** Call on page beforeunload to notify popup */
  notifyPageClosing(): void
  /** Call on page load to attempt reconnection with existing popup */
  attemptReconnect(): boolean
  destroy(): void
  /** Register callbacks for detach/dock lifecycle */
  onDetach(cb: () => void): void
  onDock(cb: () => void): void
  onReconnect(cb: () => void): void
}

export function createPopupManager(config: PopupManagerConfig): PopupManager {
  let popupWindow: Window | null = null
  let channel: BroadcastChannel | null = null
  let detached = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const detachCallbacks: Array<() => void> = []
  const dockCallbacks: Array<() => void> = []
  const reconnectCallbacks: Array<() => void> = []

  function initChannel() {
    if (channel) return
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = handleChannelMessage
  }

  function handleChannelMessage(ev: MessageEvent) {
    const { type } = ev.data ?? {}
    if (type === 'popup-ready') {
      // Popup is asking if a page is alive (after page reload)
      // Respond with page-ready
      channel?.postMessage({ type: 'page-ready', title: config.pageTitle })
    }
  }

  function getPopupFeatures(): string {
    const w = parseInt(localStorage.getItem(STORAGE_KEYS.POPUP_WIDTH) ?? '', 10) || DEFAULT_WIDTH
    const h = parseInt(localStorage.getItem(STORAGE_KEYS.POPUP_HEIGHT) ?? '', 10) || DEFAULT_HEIGHT
    return `popup,width=${w},height=${h}`
  }

  function setupPopupDocument(win: Window) {
    // Inject styles
    const styleEl = win.document.createElement('style')
    styleEl.textContent = STYLES
    win.document.head.appendChild(styleEl)

    // Set accent color custom properties on body
    win.document.body.style.setProperty('--accent', config.accentColor)
    const hex = config.accentColor.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    win.document.body.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`)

    // Set base styles for popup body
    win.document.body.style.margin = '0'
    win.document.body.style.padding = '0'
    win.document.body.style.background = '#18181b'
    win.document.body.style.overflow = 'hidden'
    win.document.body.style.fontFamily = "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace"

    // Set title
    win.document.title = `Vite DevTools — ${config.pageTitle}`

    // Save popup size on beforeunload
    win.addEventListener('beforeunload', () => {
      localStorage.setItem(STORAGE_KEYS.POPUP_WIDTH, String(win.innerWidth))
      localStorage.setItem(STORAGE_KEYS.POPUP_HEIGHT, String(win.innerHeight))
    })
  }

  function attachPopupCloseHandler(win: Window) {
    // Detect popup close (user clicks X or window.close())
    // Use a polling interval since 'beforeunload' fires before the window is actually closed
    const checkInterval = setInterval(() => {
      if (win.closed) {
        clearInterval(checkInterval)
        if (detached) {
          // Auto re-dock
          detached = false
          popupWindow = null
          localStorage.removeItem(STORAGE_KEYS.DETACHED)
          dockCallbacks.forEach(cb => cb())
        }
      }
    }, 500)
  }

  return {
    isDetached() {
      return detached
    },

    detach() {
      if (detached && popupWindow && !popupWindow.closed) {
        popupWindow.focus()
        return popupWindow
      }

      initChannel()

      const win = window.open('', POPUP_WINDOW_NAME, getPopupFeatures())
      if (!win) return null

      popupWindow = win
      detached = true
      localStorage.setItem(STORAGE_KEYS.DETACHED, 'true')

      setupPopupDocument(win)
      attachPopupCloseHandler(win)

      detachCallbacks.forEach(cb => cb())
      return win
    },

    dock() {
      if (!detached) return
      detached = false
      localStorage.removeItem(STORAGE_KEYS.DETACHED)

      if (popupWindow && !popupWindow.closed) {
        popupWindow.close()
      }
      popupWindow = null

      dockCallbacks.forEach(cb => cb())
    },

    refocusPopup() {
      if (popupWindow && !popupWindow.closed) {
        popupWindow.focus()
      }
    },

    getPopupWindow() {
      if (popupWindow && !popupWindow.closed) return popupWindow
      return null
    },

    notifyPageClosing() {
      channel?.postMessage({ type: 'page-closing' })
    },

    attemptReconnect(): boolean {
      const wasDetached = localStorage.getItem(STORAGE_KEYS.DETACHED) === 'true'
      if (!wasDetached) return false

      initChannel()

      // Send page-ready to any existing popup
      channel!.postMessage({ type: 'page-ready', title: config.pageTitle })

      // Set a timeout — if popup doesn't respond, clear the flag and dock
      reconnectTimer = setTimeout(() => {
        // No popup responded — fall back to docked mode
        localStorage.removeItem(STORAGE_KEYS.DETACHED)
        detached = false
        dockCallbacks.forEach(cb => cb())
      }, RECONNECT_TIMEOUT_MS)

      // Listen for popup acknowledgement
      const prevHandler = channel!.onmessage
      channel!.onmessage = (ev: MessageEvent) => {
        prevHandler?.call(channel, ev)
        if (ev.data?.type === 'popup-ack') {
          // Popup confirmed it's alive
          if (reconnectTimer) clearTimeout(reconnectTimer)
          detached = true
          reconnectCallbacks.forEach(cb => cb())
        }
      }

      // Optimistically show detached state
      detached = true
      return true
    },

    destroy() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      channel?.close()
      channel = null
    },

    onDetach(cb) { detachCallbacks.push(cb) },
    onDock(cb) { dockCallbacks.push(cb) },
    onReconnect(cb) { reconnectCallbacks.push(cb) },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/core/overlay/popup-manager.test.ts`
Expected: PASS — all 7 tests

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/overlay/popup-manager.ts tests/core/overlay/popup-manager.test.ts
git commit -m "feat: add popup-manager for detachable devtools window"
```

---

## Task 3: Create DetachedButton Component

The floating button shown on the page when devtools are in a popup. Displays framework icon with an external-window badge. Click refocuses the popup.

**Files:**
- Create: `src/core/overlay/DetachedButton.tsx`
- Modify: `src/core/overlay/styles.ts` (add styles)

- [ ] **Step 1: Create DetachedButton component**

Create `src/core/overlay/DetachedButton.tsx`:

```tsx
import { h } from 'preact'
import { Tooltip } from './Tooltip'

interface DetachedButtonProps {
  onRefocus: () => void
}

export function DetachedButton({ onRefocus }: DetachedButtonProps) {
  return (
    <Tooltip text="Focus DevTools popup">
      <div class="floating-icon detached-icon" onClick={onRefocus}>
        {/* Wrench icon (same as FloatingIcon) */}
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
        </svg>
        {/* External window badge */}
        <svg class="detached-badge" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="3" width="8" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="#18181b" />
          <path d="M7 1h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M11 1L6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </div>
    </Tooltip>
  )
}
```

- [ ] **Step 2: Add styles for DetachedButton**

In `src/core/overlay/styles.ts`, add the following CSS after the existing `.floating-icon svg` rule (after approximately line 58):

```css
  /* ── Detached floating button (popup mode) ── */

  .detached-icon {
    position: relative;
  }

  .detached-badge {
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 12px;
    height: 12px;
    color: var(--accent);
    pointer-events: none;
  }
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/overlay/DetachedButton.tsx src/core/overlay/styles.ts
git commit -m "feat: add DetachedButton component for popup mode"
```

---

## Task 4: Add Popup Mode to Panel

Panel needs a `mode` prop to switch between docked and popup rendering. In popup mode: no fixed positioning, no dock buttons, no resize handles, shows "dock back" button instead of dock position buttons.

**Files:**
- Modify: `src/core/overlay/Panel.tsx:17-88` (props interface) and `src/core/overlay/Panel.tsx:259-471` (render)

- [ ] **Step 1: Add mode prop to PanelProps and update rendering**

In `src/core/overlay/Panel.tsx`, add the `mode` prop to `PanelProps`:

```typescript
// Add after the existing PanelProps interface fields, before the closing brace:
  mode?: 'docked' | 'popup'
  onDetach?: () => void
  onDockBack?: () => void
```

Destructure these new props in the component function signature (after `onFocusCommitConsumed`):

```typescript
  mode = 'docked',
  onDetach,
  onDockBack,
```

Replace the `wrapperStyle` useMemo (lines 246-255) with one that handles popup mode:

```typescript
  const wrapperStyle = useMemo(() => {
    if (mode === 'popup') {
      return { position: 'relative' as const, width: '100%', height: '100vh' }
    }
    const base = { position: 'fixed' as const, zIndex: 2147483646 }
    if (dockPosition === 'bottom') {
      return { ...base, bottom: '0', left: '0', right: '0', height: `${panelSize}px` }
    }
    if (dockPosition === 'left') {
      return { ...base, top: '0', left: '0', bottom: '0', width: `${panelSize}px` }
    }
    return { ...base, top: '0', right: '0', bottom: '0', width: `${panelSize}px` }
  }, [mode, dockPosition, panelSize])
```

Replace the panel header controls section (lines 270-347) to conditionally show dock/close or popup controls. Replace the block starting with `<div class="panel-header-controls">` through its closing `</div>`:

```tsx
          <div class="panel-header-controls">
            {/* Element picker */}
            <Tooltip text="Select element">
              <button
                class={`dock-btn${isPickerActive ? ' active' : ''}`}
                onClick={onPickerToggle}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="6.5" cy="6.5" r="4" />
                  <line x1="10" y1="10" x2="14" y2="14" />
                </svg>
              </button>
            </Tooltip>
            {/* Clear AI highlight */}
            {aiHighlightActive && (
              <Tooltip text="Clear AI highlight">
                <button
                  class="ai-highlight-clear-btn"
                  onClick={onClearAiHighlight}
                >
                  AI {'\u00d7'}
                </button>
              </Tooltip>
            )}
            {/* Settings */}
            <Tooltip text="Settings">
              <button
                class={`dock-btn${settingsOpen ? ' active' : ''}`}
                onClick={onSettingsToggle}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="8" cy="8" r="2" />
                  <path d="M13.5 8a5.5 5.5 0 0 1-.15 1.2l1.4 1.1a.3.3 0 0 1 .07.4l-1.3 2.3a.3.3 0 0 1-.38.13l-1.65-.67a5.2 5.2 0 0 1-1.04.6l-.25 1.75a.3.3 0 0 1-.3.25H7.6a.3.3 0 0 1-.3-.25l-.25-1.75a5 5 0 0 1-1.04-.6l-1.65.67a.3.3 0 0 1-.38-.13l-1.3-2.3a.3.3 0 0 1 .07-.4l1.4-1.1A5.4 5.4 0 0 1 4 8c0-.4.05-.8.15-1.2l-1.4-1.1a.3.3 0 0 1-.07-.4l1.3-2.3a.3.3 0 0 1 .38-.13l1.65.67a5.2 5.2 0 0 1 1.04-.6L7.3 1.2a.3.3 0 0 1 .3-.25h2.6a.3.3 0 0 1 .3.25l.25 1.75a5 5 0 0 1 1.04.6l1.65-.67a.3.3 0 0 1 .38.13l1.3 2.3a.3.3 0 0 1-.07.4l-1.4 1.1c.1.4.15.8.15 1.2z" transform="scale(0.85) translate(1.4, 1.4)" />
                </svg>
              </button>
            </Tooltip>
            {mode === 'docked' ? (
              <>
                {/* Dock left */}
                <Tooltip text="Dock left">
                  <button
                    class={`dock-btn${dockPosition === 'left' ? ' active' : ''}`}
                    onClick={() => onDockChange('left')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <line x1="7" y1="2" x2="7" y2="14" />
                    </svg>
                  </button>
                </Tooltip>
                {/* Dock bottom */}
                <Tooltip text="Dock bottom">
                  <button
                    class={`dock-btn${dockPosition === 'bottom' ? ' active' : ''}`}
                    onClick={() => onDockChange('bottom')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <line x1="2" y1="10" x2="14" y2="10" />
                    </svg>
                  </button>
                </Tooltip>
                {/* Dock right */}
                <Tooltip text="Dock right">
                  <button
                    class={`dock-btn${dockPosition === 'right' ? ' active' : ''}`}
                    onClick={() => onDockChange('right')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <line x1="9" y1="2" x2="9" y2="14" />
                    </svg>
                  </button>
                </Tooltip>
                {/* Pop out to window */}
                {onDetach && (
                  <Tooltip text="Open in popup window">
                    <button class="dock-btn" onClick={onDetach}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="1" y="4" width="10" height="10" rx="1" />
                        <path d="M9 1h6v6" />
                        <path d="M15 1L8 8" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
                <Tooltip text="Close" shortcut="Ctrl+Shift+D">
                  <button class="panel-close" onClick={onClose}>
                    ×
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                {/* Dock back (popup mode) */}
                <Tooltip text="Dock back to page">
                  <button class="dock-btn" onClick={onDockBack}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <path d="M6 6l-4 4" />
                      <path d="M2 7v3h3" />
                    </svg>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
```

In the JSX return, conditionally skip the resize handle when in popup mode. Wrap the existing resize-handle div:

```tsx
      {mode === 'docked' && (
        <div
          class={`resize-handle resize-handle-${dockPosition}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/overlay/Panel.tsx
git commit -m "feat: add popup mode to Panel with dock-back button"
```

---

## Task 5: Wire Detach/Dock into App.tsx

This is the core integration. App.tsx needs to:
1. Accept the popup manager
2. Track detached state
3. When detached: render only `DetachedButton` + `Highlight` in the Shadow DOM; render `Panel` into the popup
4. When docked: render as today
5. Handle the page-push-aside effect (skip when detached)

**Files:**
- Modify: `src/core/overlay/App.tsx`

- [ ] **Step 1: Add detached state and callbacks to App.tsx**

Add the import for `DetachedButton` and Preact's `createPortal` (Preact provides `createPortal` from `preact/compat`). At the top of `App.tsx`, update imports:

```typescript
import { h } from 'preact'
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks'
import { createPortal } from 'preact/compat'
```

Add the import for `DetachedButton`:

```typescript
import { DetachedButton } from './DetachedButton'
```

Add `PopupManager` to the `AppProps` interface and config:

```typescript
import type { PopupManager } from './popup-manager'

interface AppProps {
  config: DevToolsConfig
  popupManager?: PopupManager
}
```

Update the component signature:

```typescript
export function App({ config, popupManager }: AppProps) {
```

Add detached state inside the component, after the existing state declarations (after line 156):

```typescript
  const [isDetached, setIsDetached] = useState(false)
  const [popupMountPoint, setPopupMountPoint] = useState<HTMLElement | null>(null)
```

Add an effect to wire up popup-manager lifecycle callbacks (after the existing effects):

```typescript
  // Wire popup-manager lifecycle
  useEffect(() => {
    if (!popupManager) return

    popupManager.onDetach(() => {
      const win = popupManager.getPopupWindow()
      if (!win) return
      // Create a mount point in the popup's body
      const mount = win.document.createElement('div')
      mount.className = 'devtools-root'
      mount.style.width = '100%'
      mount.style.height = '100vh'
      win.document.body.appendChild(mount)
      setPopupMountPoint(mount)
      setIsDetached(true)
      // Close the panel in-page so page push-aside is cleared
      setIsOpen(false)
    })

    popupManager.onDock(() => {
      setPopupMountPoint(null)
      setIsDetached(false)
      setIsOpen(true)
    })

    popupManager.onReconnect(() => {
      setPopupMountPoint(null)
      setIsDetached(true)
      // Popup will send its mount point via BroadcastChannel
    })

    // Notify popup when page is closing
    const handleBeforeUnload = () => popupManager.notifyPageClosing()
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Attempt reconnect if previously detached
    popupManager.attemptReconnect()

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [popupManager])
```

Add detach/dock handlers:

```typescript
  const handleDetach = useCallback(() => {
    popupManager?.detach()
  }, [popupManager])

  const handleDockBack = useCallback(() => {
    popupManager?.dock()
  }, [popupManager])

  const handleRefocusPopup = useCallback(() => {
    popupManager?.refocusPopup()
  }, [popupManager])
```

- [ ] **Step 2: Update the push-aside effect to skip when detached**

Modify the existing push-aside effect (lines 276-306). Change the condition from `if (!isOpen)` to also check `isDetached`:

```typescript
  // Push page content aside when panel is open (docked mode only)
  useEffect(() => {
    const html = document.documentElement
    const cleanup = () => {
      html.style.marginLeft = ''
      html.style.marginRight = ''
      html.style.height = ''
      html.style.overflow = ''
    }

    if (!isOpen || isDetached) {
      cleanup()
      return
    }

    const marginPx = `${panelSize}px`
    html.style.marginLeft = ''
    html.style.marginRight = ''
    html.style.height = ''
    html.style.overflow = ''

    if (dockPosition === 'bottom') {
      html.style.height = `calc(100vh - ${panelSize}px)`
      html.style.overflow = 'auto'
    } else if (dockPosition === 'left') {
      html.style.marginLeft = marginPx
    } else {
      html.style.marginRight = marginPx
    }

    return cleanup
  }, [isOpen, isDetached, dockPosition, panelSize])
```

- [ ] **Step 3: Update the render output**

Replace the JSX return (lines 770-873) with the following:

```tsx
  const panelElement = (
    <Panel
      tree={filteredTree}
      selectedNode={selectedNode}
      dockPosition={dockPosition}
      panelSize={panelSize}
      activeTab={activeTab}
      searchQuery={searchQuery}
      matchingNodeIds={matchingNodeIds}
      searchAncestorIds={searchAncestorIds}
      consoleEntries={consoleEntries}
      consoleFilters={consoleFilters}
      errorCount={errorCount}
      isPickerActive={isPickerActive}
      expandedNodeIds={expandedNodeIds}
      elementExpandedNodeIds={elementExpandedNodeIds}
      showElements={showElements}
      settingsOpen={settingsOpen}
      hideLibrary={hideLibrary}
      hideProviders={hideProviders}
      editor={editor}
      fontSize={fontSize}
      supportedSettings={config.supportedSettings}
      onSearchChange={handleSearchChange}
      onPickerToggle={handlePickerToggle}
      onSettingsToggle={handleSettingsToggle}
      onHideLibraryToggle={handleHideLibraryToggle}
      onHideProvidersToggle={handleHideProvidersToggle}
      onShowElementsToggle={handleShowElementsToggle}
      showPreview={showPreview}
      onShowPreviewToggle={handleShowPreviewToggle}
      onEditorChange={handleEditorChange}
      onFontSizeChange={handleFontSizeChange}
      onDockChange={handleDockChange}
      onResize={handleResize}
      onTabChange={handleTabChange}
      onFilterChange={handleFilterChange}
      onClearConsole={handleClearConsole}
      editedProps={editedProps}
      expandedPropsSet={expandedPropsSet}
      mcpEnabled={config.mcp ?? false}
      mcpPaused={mcpPaused}
      aiHighlightActive={highlights.has('ai')}
      aiSelectedNodeIds={aiSelectedNodeIds}
      showAiActions={showAiActions}
      onClearAiHighlight={handleClearAiHighlight}
      onMcpPausedToggle={handleMcpPausedToggle}
      onShowAiActionsToggle={handleShowAiActionsToggle}
      onPropEdit={handlePropEdit}
      onPropPersisted={handlePropPersisted}
      onExpandProps={handleExpandProps}
      onSelect={handleSelect}
      onHover={handleHover}
      onContextMenu={handleContextMenu}
      onClose={isDetached ? handleDockBack : togglePanel}
      renderCauseEnabled={renderCauseEnabled}
      renderHistorySize={renderHistorySize}
      renderIncludeValues={renderIncludeValues}
      renderHistory={renderHistory}
      renderHistoryRecording={renderHistoryRecording}
      pinnedRenderComponentId={pinnedRenderComponentId}
      commitComponentIds={commitComponentIds}
      onRenderCauseToggle={handleRenderCauseToggle}
      onRenderHistorySizeChange={handleRenderHistorySizeChange}
      onRenderIncludeValuesToggle={handleRenderIncludeValuesToggle}
      onRenderHistoryRecordingToggle={handleRenderHistoryRecordingToggle}
      onClearRenderHistory={handleClearRenderHistory}
      onPinRenderComponent={handlePinRenderComponent}
      onNavigateToCommit={handleNavigateToCommit}
      focusCommitIndex={focusCommitIndex}
      onFocusCommitConsumed={() => setFocusCommitIndex(null)}
      mode={isDetached ? 'popup' : 'docked'}
      onDetach={popupManager ? handleDetach : undefined}
      onDockBack={handleDockBack}
    />
  )

  return (
    <div>
      {/* Highlights always render on the page */}
      <Highlight highlights={Array.from(highlights.values())} showAiActions={showAiActions} />

      {isDetached ? (
        <>
          {/* Floating button on the page while detached */}
          <DetachedButton onRefocus={handleRefocusPopup} />
          {/* Panel renders in popup via portal */}
          {popupMountPoint && createPortal(panelElement, popupMountPoint)}
        </>
      ) : (
        <>
          {!isOpen && <FloatingIcon onClick={togglePanel} />}
          {isOpen && panelElement}
        </>
      )}

      {contextMenu && contextMenu.node.source && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: `Open source — ${contextMenu.node.source.fileName.replace(/^.*\/src\//, 'src/')}:${contextMenu.node.source.lineNumber}`,
              onClick: () => openInEditor(contextMenu.node.source!),
            },
            ...(contextMenu.node.usageSource ? [{
              label: `Open usage — ${contextMenu.node.usageSource.fileName.replace(/^.*\/src\//, 'src/')}:${contextMenu.node.usageSource.lineNumber}`,
              onClick: () => openInEditor(contextMenu.node.usageSource!),
            }] : []),
          ]}
          onClose={closeContextMenu}
        />
      )}

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} dockPosition={dockPosition} onDismiss={handleToastDismiss} />
      )}
    </div>
  )
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/App.tsx
git commit -m "feat: integrate popup-manager into App with detach/dock lifecycle"
```

---

## Task 6: Wire popup-manager in client.ts

The bootstrap file needs to create the `PopupManager` and pass it to the `App` component.

**Files:**
- Modify: `src/core/client.ts`

- [ ] **Step 1: Update client.ts to create and pass popup-manager**

Replace the entire content of `src/core/client.ts`:

```typescript
import { h, render } from 'preact'
import type { DevToolsConfig } from './types'
import { App } from './overlay/App'
import { STYLES } from './overlay/styles'
import { initBridgeClient } from './mcp/bridge-client'
import { createPopupManager } from './overlay/popup-manager'

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

export function mountOverlay(config: DevToolsConfig, container?: HTMLElement) {
  // Create host element
  const host = document.createElement('div')
  host.id = 'danendz-devtools'
  ;(container ?? document.body).appendChild(host)

  // Attach shadow DOM for style isolation
  const shadow = host.attachShadow({ mode: 'open' })

  // Set accent color CSS custom properties
  const accent = config.accentColor ?? '#8b5cf6'
  host.style.setProperty('--accent', accent)
  host.style.setProperty('--accent-rgb', hexToRgb(accent))

  // Inject styles
  const styleEl = document.createElement('style')
  styleEl.textContent = STYLES
  shadow.appendChild(styleEl)

  // Mount Preact app into shadow DOM
  const mountPoint = document.createElement('div')
  mountPoint.className = 'devtools-root'
  shadow.appendChild(mountPoint)

  // Create popup manager for detachable window support
  const popupManager = createPopupManager({
    accentColor: accent,
    pageTitle: document.title || window.location.pathname,
  })

  render(h(App, { config, popupManager }), mountPoint)

  // Initialize MCP bridge if enabled
  if (config.mcp) {
    initBridgeClient()
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/client.ts
git commit -m "feat: create popup-manager in client bootstrap and pass to App"
```

---

## Task 7: Add Popup-Mode Panel Styles

The panel in popup mode fills the entire window. We need CSS to handle this without the fixed positioning and resize constraints.

**Files:**
- Modify: `src/core/overlay/styles.ts`

- [ ] **Step 1: Add popup-mode styles**

In `src/core/overlay/styles.ts`, add the following CSS after the existing `.resize-handle-right` block (after approximately line 113):

```css
  /* ── Popup-mode panel (fills entire popup window) ── */

  .panel-wrapper {
    display: flex;
    flex-direction: column;
  }

  .panel-wrapper .panel {
    flex: 1;
  }
```

No additional popup-specific styles are needed because:
- `wrapperStyle` is set to `position: relative; width: 100%; height: 100vh` in popup mode (handled in Panel.tsx)
- The `.panel` already uses `width: 100%; height: 100%; display: flex; flex-direction: column`
- Resize handles are hidden in popup mode (handled in Panel.tsx)

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/overlay/styles.ts
git commit -m "feat: add popup-mode panel layout styles"
```

---

## Task 8: Handle Page Reload Reconnection in Popup

When the page reloads, the popup stays alive. We need the popup to detect the disconnection, show a brief "disconnected" message, and reconnect when the page comes back.

**Files:**
- Modify: `src/core/overlay/popup-manager.ts`
- Modify: `src/core/overlay/App.tsx`

- [ ] **Step 1: Add popup-side BroadcastChannel handling to popup-manager**

In `src/core/overlay/popup-manager.ts`, add a new exported function `initPopupSideChannel` that the popup's App can call to handle disconnection/reconnection. Add it after the `createPopupManager` function:

```typescript
/**
 * Called from within the popup window to set up reconnection handling.
 * Shows a disconnection overlay when the page closes, and reconnects on page-ready.
 */
export function initPopupSideChannel(
  popupDocument: Document,
  onPageReady: (title: string) => void,
  onPageGone: () => void,
): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME)
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null

  channel.onmessage = (ev: MessageEvent) => {
    const { type, title } = ev.data ?? {}

    if (type === 'page-closing') {
      // Page is navigating away or closing — start grace period
      disconnectTimer = setTimeout(() => {
        onPageGone()
      }, RECONNECT_TIMEOUT_MS)
    }

    if (type === 'page-ready') {
      // Page reloaded — cancel disconnect timer and reconnect
      if (disconnectTimer) {
        clearTimeout(disconnectTimer)
        disconnectTimer = null
      }
      channel.postMessage({ type: 'popup-ack' })
      onPageReady(title ?? '')
    }
  }

  // Announce that popup is alive (for page that loads with DETACHED flag)
  channel.postMessage({ type: 'popup-ready' })

  return () => {
    if (disconnectTimer) clearTimeout(disconnectTimer)
    channel.close()
  }
}
```

- [ ] **Step 2: Wire reconnection into App.tsx popup lifecycle**

In `App.tsx`, inside the `popupManager.onDetach` callback, after setting `setIsDetached(true)`, add popup-side channel initialization:

```typescript
    popupManager.onDetach(() => {
      const win = popupManager.getPopupWindow()
      if (!win) return
      // Create a mount point in the popup's body
      const mount = win.document.createElement('div')
      mount.className = 'devtools-root'
      mount.style.width = '100%'
      mount.style.height = '100vh'
      win.document.body.appendChild(mount)
      setPopupMountPoint(mount)
      setIsDetached(true)
      setIsOpen(false)

      // Set up reconnection handling in the popup
      initPopupSideChannel(
        win.document,
        (title) => {
          // Page reloaded — update popup title
          win.document.title = `Vite DevTools — ${title}`
        },
        () => {
          // Page gone — auto-close popup and dock
          win.close()
        },
      )
    })
```

Add the import at the top of `App.tsx`:

```typescript
import { initPopupSideChannel } from './popup-manager'
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS — no regressions

- [ ] **Step 5: Commit**

```bash
git add src/core/overlay/popup-manager.ts src/core/overlay/App.tsx
git commit -m "feat: add page-reload reconnection via BroadcastChannel"
```

---

## Task 9: Build, Typecheck, and Manual Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: PASS — all existing tests still pass + new popup-manager tests

- [ ] **Step 3: Build the plugin**

Run: `pnpm build`
Expected: PASS — clean build with no errors

- [ ] **Step 4: Manual test in test app**

1. Navigate to the test app (`~/Projects/test-devtools`), reload it
2. Open devtools (Ctrl+Shift+D or click floating icon)
3. Verify the new "popout" button appears in the panel header (next to dock buttons)
4. Click the popout button — devtools should open in a new popup window
5. Verify the page shows a floating button with external-window badge
6. Verify element picker works: click picker in popup, hover elements on page — highlights appear on the page
7. Verify component tree updates in the popup when interacting with the page
8. Verify clicking the floating page button refocuses the popup
9. Close the popup (click X) — devtools should auto re-dock to the page
10. Detach again, then reload the page — popup should reconnect and show fresh tree
11. Detach again, then close the page tab — popup should auto-close after ~3 seconds

- [ ] **Step 5: Commit all remaining changes (if any fixups needed)**

```bash
git add -A
git commit -m "feat: detachable devtools popup window with full functionality"
```
