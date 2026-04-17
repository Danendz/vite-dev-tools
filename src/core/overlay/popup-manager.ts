import { STORAGE_KEYS } from '../../shared/constants'
import { STYLES } from './styles'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PopupManagerConfig {
  /** Accent hex color, e.g. '#58c4dc' */
  accent: string
  /** RGB triplet for the accent, e.g. '88, 196, 220' */
  accentRgb: string
}

export interface PopupManager {
  /** Whether the devtools are currently in a detached popup window. */
  isDetached(): boolean
  /** Open the popup window, inject styles, set DETACHED flag. Returns the popup Window. */
  detach(): Window
  /** Close the popup, clear DETACHED flag. */
  dock(): void
  /** Focus the existing popup window (no-op if none). */
  refocusPopup(): void
  /** Return the current popup Window or null. */
  getPopupWindow(): Window | null
  /** Broadcast `page-closing` so the popup knows the page is going away. */
  notifyPageClosing(): void
  /**
   * Called on page load when DETACHED flag is set.
   * Sends `page-ready` over BroadcastChannel, waits up to 3 s for `popup-ack`.
   * Falls back to docked mode if no response arrives.
   */
  attemptReconnect(): void
  /** Cancel any pending timers and close the BroadcastChannel. */
  destroy(): void
  onDetach(cb: (win: Window) => void): void
  onDock(cb: () => void): void
  onReconnect(cb: (win: Window) => void): void
}

// ── BroadcastChannel message types ───────────────────────────────────────────

type PageToPopupMessage =
  | { type: 'page-ready'; title: string }
  | { type: 'page-closing' }

type PopupToPageMessage =
  | { type: 'popup-ready' }
  | { type: 'popup-ack' }

type ChannelMessage = PageToPopupMessage | PopupToPageMessage

const CHANNEL_NAME = 'vite-devtools'
const RECONNECT_TIMEOUT_MS = 3_000
const POPUP_CLOSED_POLL_MS = 500
const DEFAULT_POPUP_WIDTH = 900
const DEFAULT_POPUP_HEIGHT = 600

// ── createPopupManager ────────────────────────────────────────────────────────

export function createPopupManager(config: PopupManagerConfig): PopupManager {
  let popupWin: Window | null = null
  let channel: BroadcastChannel | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const detachCallbacks: Array<(win: Window) => void> = []
  const dockCallbacks: Array<() => void> = []
  const reconnectCallbacks: Array<(win: Window) => void> = []

  function getChannel(): BroadcastChannel {
    if (!channel) {
      channel = new BroadcastChannel(CHANNEL_NAME)
    }
    return channel
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function startClosedPoller(win: Window) {
    clearPollTimer()
    pollTimer = setInterval(() => {
      if (win.closed) {
        clearPollTimer()
        // The popup was closed externally — auto-dock
        popupWin = null
        localStorage.removeItem(STORAGE_KEYS.DETACHED)
        dockCallbacks.forEach((cb) => cb())
      }
    }, POPUP_CLOSED_POLL_MS)
  }

  function getPersistedSize(): { width: number; height: number } {
    const w = parseInt(localStorage.getItem(STORAGE_KEYS.POPUP_WIDTH) ?? '', 10)
    const h = parseInt(localStorage.getItem(STORAGE_KEYS.POPUP_HEIGHT) ?? '', 10)
    return {
      width: Number.isFinite(w) && w > 0 ? w : DEFAULT_POPUP_WIDTH,
      height: Number.isFinite(h) && h > 0 ? h : DEFAULT_POPUP_HEIGHT,
    }
  }

  function injectIntoPopup(win: Window) {
    const doc = win.document

    // Inject stylesheet
    const style = doc.createElement('style')
    style.textContent = STYLES
    doc.head.appendChild(style)

    // Set accent CSS custom properties and body baseline styles
    doc.body.style.setProperty('--accent', config.accent)
    doc.body.style.setProperty('--accent-rgb', config.accentRgb)
    doc.body.style.margin = '0'
    doc.body.style.padding = '0'
    doc.body.style.background = '#18181b'
    doc.body.style.overflow = 'hidden'
    doc.body.style.fontFamily = "'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace"

    // Set popup title
    doc.title = `Vite DevTools \u2014 ${document.title}`

    // Prevent reload in popup (about:blank would wipe the portal)
    win.addEventListener('keydown', (e: KeyboardEvent) => {
      if (
        e.key === 'F5' ||
        ((e.ctrlKey || e.metaKey) && e.key === 'r')
      ) {
        e.preventDefault()
      }
    })

    // Persist size when popup is closed
    win.addEventListener('beforeunload', () => {
      localStorage.setItem(STORAGE_KEYS.POPUP_WIDTH, String(win.outerWidth))
      localStorage.setItem(STORAGE_KEYS.POPUP_HEIGHT, String(win.outerHeight))
    })
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function detach(): Window {
    if (popupWin && !popupWin.closed) {
      popupWin.focus()
      return popupWin
    }

    const { width, height } = getPersistedSize()
    const features = [
      `width=${width}`,
      `height=${height}`,
      'resizable=yes',
      'scrollbars=no',
      'toolbar=no',
      'menubar=no',
      'location=no',
      'status=no',
    ].join(',')

    const win = window.open('', 'vite-devtools-popup', features)
    if (!win) {
      throw new Error('[vite-dev-tools] window.open() was blocked or failed')
    }

    popupWin = win
    localStorage.setItem(STORAGE_KEYS.DETACHED, '1')

    injectIntoPopup(win)
    startClosedPoller(win)
    detachCallbacks.forEach((cb) => cb(win))

    return win
  }

  function dock(): void {
    if (!popupWin) return

    clearPollTimer()
    clearReconnectTimer()

    if (!popupWin.closed) {
      popupWin.close()
    }
    popupWin = null
    localStorage.removeItem(STORAGE_KEYS.DETACHED)
    dockCallbacks.forEach((cb) => cb())
  }

  function refocusPopup(): void {
    if (popupWin && !popupWin.closed) {
      popupWin.focus()
    }
  }

  function getPopupWindow(): Window | null {
    return popupWin
  }

  function notifyPageClosing(): void {
    const msg: PageToPopupMessage = { type: 'page-closing' }
    getChannel().postMessage(msg)
  }

  function attemptReconnect(): void {
    if (!localStorage.getItem(STORAGE_KEYS.DETACHED)) return

    const ch = getChannel()

    // Listen for popup-ack confirming the popup is alive
    const onMessage = (event: MessageEvent<ChannelMessage>) => {
      if (event.data.type === 'popup-ack') {
        clearReconnectTimer()
        ch.removeEventListener('message', onMessage)

        // The popup is alive — we don't have a direct Window ref here
        // (the popup was opened by a previous page load), so we signal
        // reconnect success via onReconnect with a proxy-like reference.
        // In practice callers may mount the overlay into an existing popup
        // using the BroadcastChannel alone; we pass null-safe stub.
        // If the popup opened itself it has its own Window, so we expose
        // what we can: attempt to locate it via window.open with no url
        // (returns existing named popup if same origin).
        let win: Window | null = null
        try {
          win = window.open('', 'vite-devtools-popup')
        } catch {
          // cross-origin or blocked — ignore
        }

        if (win && !win.closed) {
          popupWin = win
          startClosedPoller(win)
          reconnectCallbacks.forEach((cb) => cb(win!))
        } else {
          // Could not get popup reference — still signal reconnect
          reconnectCallbacks.forEach((cb) => {
            if (win) cb(win)
          })
        }
      }
    }

    ch.addEventListener('message', onMessage)

    // Send page-ready so popup knows the page is live
    const msg: PageToPopupMessage = { type: 'page-ready', title: document.title }
    ch.postMessage(msg)

    // Fall back to docked after timeout
    reconnectTimer = setTimeout(() => {
      ch.removeEventListener('message', onMessage)
      // No ack received — clear detached state and go docked
      localStorage.removeItem(STORAGE_KEYS.DETACHED)
      dockCallbacks.forEach((cb) => cb())
    }, RECONNECT_TIMEOUT_MS)
  }

  function destroy(): void {
    clearPollTimer()
    clearReconnectTimer()
    if (channel) {
      channel.close()
      channel = null
    }
  }

  function onDetach(cb: (win: Window) => void): void {
    detachCallbacks.push(cb)
  }

  function onDock(cb: () => void): void {
    dockCallbacks.push(cb)
  }

  function onReconnect(cb: (win: Window) => void): void {
    reconnectCallbacks.push(cb)
  }

  function isDetached(): boolean {
    return popupWin !== null && !popupWin.closed
  }

  return {
    isDetached,
    detach,
    dock,
    refocusPopup,
    getPopupWindow,
    notifyPageClosing,
    attemptReconnect,
    destroy,
    onDetach,
    onDock,
    onReconnect,
  }
}

// ── initPopupSideChannel ──────────────────────────────────────────────────────

/**
 * Called from within the popup window.
 * Handles the popup side of the BroadcastChannel protocol.
 *
 * @param popupDocument - The popup's document (used for title updates etc.)
 * @param onPageReady   - Called when the page sends `page-ready`
 * @param onPageGone    - Called when the page sends `page-closing` and no
 *                        reconnect arrives within 3 s
 * @returns Cleanup function
 */
export function initPopupSideChannel(
  _popupDocument: Document,
  onPageReady: (title: string) => void,
  onPageGone: () => void,
): () => void {
  const ch = new BroadcastChannel(CHANNEL_NAME)
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null

  function clearDisconnectTimer() {
    if (disconnectTimer !== null) {
      clearTimeout(disconnectTimer)
      disconnectTimer = null
    }
  }

  ch.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
    const { data } = event

    if (data.type === 'page-closing') {
      // Start a timer — if page reconnects within 3 s, cancel it
      clearDisconnectTimer()
      disconnectTimer = setTimeout(() => {
        onPageGone()
      }, RECONNECT_TIMEOUT_MS)
    } else if (data.type === 'page-ready') {
      // Page is alive (initial load or reconnect)
      clearDisconnectTimer()
      const ack: PopupToPageMessage = { type: 'popup-ack' }
      ch.postMessage(ack)
      onPageReady((data as { type: 'page-ready'; title: string }).title)
    }
  })

  // Ask the page if it's alive (handles the case where the page loaded first
  // and set DETACHED, then the popup was reopened manually)
  const ready: PopupToPageMessage = { type: 'popup-ready' }
  ch.postMessage(ready)

  return () => {
    clearDisconnectTimer()
    ch.close()
  }
}
