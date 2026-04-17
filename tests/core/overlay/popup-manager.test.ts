// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STORAGE_KEYS } from '@/shared/constants'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock styles to keep tests lightweight
vi.mock('@/core/overlay/styles', () => ({ STYLES: '/* test-styles */' }))

// ── BroadcastChannel mock ─────────────────────────────────────────────────────

type MessageHandler = (event: MessageEvent) => void

/** Registry of all channels keyed by name so they can communicate. */
const channelRegistry = new Map<string, Set<MockBroadcastChannel>>()

class MockBroadcastChannel {
  name: string
  private _listeners: MessageHandler[] = []
  closed = false

  constructor(name: string) {
    this.name = name
    if (!channelRegistry.has(name)) {
      channelRegistry.set(name, new Set())
    }
    channelRegistry.get(name)!.add(this)
  }

  addEventListener(_type: string, listener: MessageHandler) {
    this._listeners.push(listener)
  }

  removeEventListener(_type: string, listener: MessageHandler) {
    const idx = this._listeners.indexOf(listener)
    if (idx !== -1) this._listeners.splice(idx, 1)
  }

  postMessage(data: unknown) {
    if (this.closed) return
    const peers = channelRegistry.get(this.name) ?? new Set()
    peers.forEach((ch) => {
      if (ch !== this && !ch.closed) {
        const event = { data } as MessageEvent
        ch._listeners.forEach((fn) => fn(event))
      }
    })
  }

  close() {
    this.closed = true
    channelRegistry.get(this.name)?.delete(this)
  }

  /** Test helper: deliver a message directly to THIS channel's own listeners. */
  _deliverToSelf(data: unknown) {
    const event = { data } as MessageEvent
    this._listeners.forEach((fn) => fn(event))
  }
}

// ── Fake popup window factory ─────────────────────────────────────────────────

function createFakePopupWindow(opts: { closed?: boolean } = {}) {
  let _closed = opts.closed ?? false
  const beforeUnloadListeners: (() => void)[] = []

  const win = {
    get closed() { return _closed },
    close() { _closed = true },
    focus: vi.fn(),
    outerWidth: 900,
    outerHeight: 600,
    addEventListener(event: string, handler: () => void) {
      if (event === 'beforeunload') beforeUnloadListeners.push(handler)
    },
    document: {
      title: '',
      head: { appendChild: vi.fn() },
      body: {
        style: {
          setProperty: vi.fn(),
          margin: '',
          padding: '',
          background: '',
          overflow: '',
          fontFamily: '',
        },
      },
      createElement: vi.fn((tag: string) => {
        if (tag === 'style') return { textContent: '' }
        return {}
      }),
    },
    _fireBeforeUnload() {
      beforeUnloadListeners.forEach((fn) => fn())
    },
  }

  return win
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear channel registry between tests
  channelRegistry.clear()
  // Clear localStorage
  localStorage.clear()
  // Install mock BroadcastChannel
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
  // Default document title
  Object.defineProperty(document, 'title', { value: 'Test Page', configurable: true, writable: true })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  channelRegistry.clear()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function importManager() {
  const mod = await import('@/core/overlay/popup-manager')
  return mod
}

function makeConfig() {
  return { accent: '#58c4dc', accentRgb: '88, 196, 220' }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createPopupManager', () => {
  it('initial state: getPopupWindow returns null', async () => {
    const { createPopupManager } = await importManager()
    const manager = createPopupManager(makeConfig())
    expect(manager.getPopupWindow()).toBeNull()
  })

  describe('detach()', () => {
    it('calls window.open with named popup and returns the window', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      const openSpy = vi.fn(() => fakeWin as unknown as Window)
      vi.stubGlobal('window', { ...window, open: openSpy, document })

      const manager = createPopupManager(makeConfig())
      const result = manager.detach()

      expect(openSpy).toHaveBeenCalledWith('', 'vite-devtools-popup', expect.any(String))
      expect(result).toBe(fakeWin)
      manager.destroy()
    })

    it('sets DETACHED flag in localStorage', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBe('1')
      manager.destroy()
    })

    it('getPopupWindow returns the popup after detach', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      expect(manager.getPopupWindow()).toBe(fakeWin)
      manager.destroy()
    })

    it('calls onDetach callbacks with the popup window', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      const cb = vi.fn()
      manager.onDetach(cb)
      manager.detach()
      expect(cb).toHaveBeenCalledWith(fakeWin)
      manager.destroy()
    })

    it('uses default size 900x600 when no persisted size', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      const openSpy = vi.fn(() => fakeWin as unknown as Window)
      vi.stubGlobal('window', { ...window, open: openSpy, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      const features: string = openSpy.mock.calls[0][2] as string
      expect(features).toContain('width=900')
      expect(features).toContain('height=600')
      manager.destroy()
    })

    it('uses persisted size from localStorage', async () => {
      const { createPopupManager } = await importManager()
      localStorage.setItem(STORAGE_KEYS.POPUP_WIDTH, '1200')
      localStorage.setItem(STORAGE_KEYS.POPUP_HEIGHT, '800')
      const fakeWin = createFakePopupWindow()
      const openSpy = vi.fn(() => fakeWin as unknown as Window)
      vi.stubGlobal('window', { ...window, open: openSpy, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      const features: string = openSpy.mock.calls[0][2] as string
      expect(features).toContain('width=1200')
      expect(features).toContain('height=800')
      manager.destroy()
    })

    it('injects styles into popup document', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()

      expect(fakeWin.document.head.appendChild).toHaveBeenCalled()
      const styleEl = (fakeWin.document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value
      expect(styleEl.textContent).toBe('/* test-styles */')
      manager.destroy()
    })

    it('sets accent CSS custom properties on popup body', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()

      const { setProperty } = fakeWin.document.body.style
      expect(setProperty).toHaveBeenCalledWith('--accent', '#58c4dc')
      expect(setProperty).toHaveBeenCalledWith('--accent-rgb', '88, 196, 220')
      manager.destroy()
    })

    it('sets popup document title from page title', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      expect(fakeWin.document.title).toBe('Vite DevTools \u2014 Test Page')
      manager.destroy()
    })

    it('saves popup size to localStorage on beforeunload', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      fakeWin.outerWidth = 1100
      fakeWin.outerHeight = 750
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      fakeWin._fireBeforeUnload()

      expect(localStorage.getItem(STORAGE_KEYS.POPUP_WIDTH)).toBe('1100')
      expect(localStorage.getItem(STORAGE_KEYS.POPUP_HEIGHT)).toBe('750')
      manager.destroy()
    })

    it('returns same window and focuses if popup already open', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      const openSpy = vi.fn(() => fakeWin as unknown as Window)
      vi.stubGlobal('window', { ...window, open: openSpy, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      const result2 = manager.detach()

      // window.open should only be called once
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(result2).toBe(fakeWin)
      expect(fakeWin.focus).toHaveBeenCalledTimes(1)
      manager.destroy()
    })

    it('throws if window.open returns null', async () => {
      const { createPopupManager } = await importManager()
      vi.stubGlobal('window', { ...window, open: () => null, document })

      const manager = createPopupManager(makeConfig())
      expect(() => manager.detach()).toThrow('window.open() was blocked')
      manager.destroy()
    })
  })

  describe('dock()', () => {
    it('closes the popup and clears DETACHED flag', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBe('1')

      manager.dock()
      expect(fakeWin.closed).toBe(true)
      expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBeNull()
    })

    it('calls onDock callbacks', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      const cb = vi.fn()
      manager.onDock(cb)
      manager.detach()
      manager.dock()
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('sets getPopupWindow to null after dock', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      manager.dock()
      expect(manager.getPopupWindow()).toBeNull()
    })

    it('dock() is a no-op when already docked', async () => {
      const { createPopupManager } = await importManager()
      const manager = createPopupManager(makeConfig())
      const cb = vi.fn()
      manager.onDock(cb)
      // Should not throw and should still call callbacks
      manager.dock()
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  describe('refocusPopup()', () => {
    it('calls focus() on the popup window', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      manager.detach()
      manager.refocusPopup()
      expect(fakeWin.focus).toHaveBeenCalled()
      manager.destroy()
    })

    it('is a no-op when no popup is open', async () => {
      const { createPopupManager } = await importManager()
      const manager = createPopupManager(makeConfig())
      // Should not throw
      expect(() => manager.refocusPopup()).not.toThrow()
    })
  })

  describe('auto-dock on popup close (polling)', () => {
    it('docks and calls onDock when popup is closed externally', async () => {
      const { createPopupManager } = await importManager()
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      const dockCb = vi.fn()
      manager.onDock(dockCb)
      manager.detach()

      // Simulate external closure
      fakeWin.close()
      expect(fakeWin.closed).toBe(true)

      // Advance time past the poll interval (500 ms)
      vi.advanceTimersByTime(600)

      expect(dockCb).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBeNull()
      expect(manager.getPopupWindow()).toBeNull()
      manager.destroy()
    })
  })

  describe('notifyPageClosing()', () => {
    it('broadcasts page-closing message over BroadcastChannel', async () => {
      const { createPopupManager } = await importManager()

      // Intercept messages on the channel by opening a receiving channel
      const receiver = new MockBroadcastChannel('vite-devtools')
      const received: unknown[] = []
      receiver.addEventListener('message', (e: MessageEvent) => received.push(e.data))

      const manager = createPopupManager(makeConfig())
      manager.notifyPageClosing()

      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({ type: 'page-closing' })

      receiver.close()
      manager.destroy()
    })
  })

  describe('attemptReconnect()', () => {
    it('does nothing when DETACHED flag is not set', async () => {
      const { createPopupManager } = await importManager()
      const manager = createPopupManager(makeConfig())
      const dockCb = vi.fn()
      manager.onDock(dockCb)
      manager.attemptReconnect()
      vi.advanceTimersByTime(4000)
      expect(dockCb).not.toHaveBeenCalled()
      manager.destroy()
    })

    it('sends page-ready with document title over BroadcastChannel', async () => {
      const { createPopupManager } = await importManager()
      localStorage.setItem(STORAGE_KEYS.DETACHED, '1')

      const receiver = new MockBroadcastChannel('vite-devtools')
      const received: unknown[] = []
      receiver.addEventListener('message', (e: MessageEvent) => received.push(e.data))

      const manager = createPopupManager(makeConfig())
      manager.attemptReconnect()

      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({ type: 'page-ready', title: 'Test Page' })

      vi.advanceTimersByTime(4000)
      receiver.close()
      manager.destroy()
    })

    it('falls back to docked after 3 s with no ack', async () => {
      const { createPopupManager } = await importManager()
      localStorage.setItem(STORAGE_KEYS.DETACHED, '1')

      const manager = createPopupManager(makeConfig())
      const dockCb = vi.fn()
      manager.onDock(dockCb)
      manager.attemptReconnect()

      // Not yet
      vi.advanceTimersByTime(2999)
      expect(dockCb).not.toHaveBeenCalled()

      // Trigger timeout
      vi.advanceTimersByTime(1)
      expect(dockCb).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem(STORAGE_KEYS.DETACHED)).toBeNull()
      manager.destroy()
    })

    it('calls onReconnect and does not dock when popup-ack arrives in time', async () => {
      const { createPopupManager } = await importManager()
      localStorage.setItem(STORAGE_KEYS.DETACHED, '1')

      // Simulate a "popup" that is a peer on the channel
      const popupChannel = new MockBroadcastChannel('vite-devtools')

      // The popup responds to page-ready with popup-ack
      popupChannel.addEventListener('message', (e: MessageEvent) => {
        if (e.data.type === 'page-ready') {
          // Reply ack through the channel
          popupChannel.postMessage({ type: 'popup-ack' })
        }
      })

      // We need window.open to return something for the reconnect logic
      const fakeWin = createFakePopupWindow()
      vi.stubGlobal('window', { ...window, open: () => fakeWin as unknown as Window, document })

      const manager = createPopupManager(makeConfig())
      const dockCb = vi.fn()
      const reconnectCb = vi.fn()
      manager.onDock(dockCb)
      manager.onReconnect(reconnectCb)

      manager.attemptReconnect()

      // Give any microtasks a chance to run
      await Promise.resolve()

      expect(dockCb).not.toHaveBeenCalled()
      expect(reconnectCb).toHaveBeenCalledTimes(1)

      popupChannel.close()
      manager.destroy()
    })
  })

  describe('destroy()', () => {
    it('cancels reconnect timer so fallback dock does not fire', async () => {
      const { createPopupManager } = await importManager()
      localStorage.setItem(STORAGE_KEYS.DETACHED, '1')

      const manager = createPopupManager(makeConfig())
      const dockCb = vi.fn()
      manager.onDock(dockCb)
      manager.attemptReconnect()
      manager.destroy()

      vi.advanceTimersByTime(4000)
      expect(dockCb).not.toHaveBeenCalled()
    })
  })
})

// ── initPopupSideChannel ──────────────────────────────────────────────────────

describe('initPopupSideChannel', () => {
  it('broadcasts popup-ready immediately on init', async () => {
    const { initPopupSideChannel } = await importManager()

    const receiver = new MockBroadcastChannel('vite-devtools')
    const received: unknown[] = []
    receiver.addEventListener('message', (e: MessageEvent) => received.push(e.data))

    const cleanup = initPopupSideChannel(document, vi.fn(), vi.fn())

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ type: 'popup-ready' })

    cleanup()
    receiver.close()
  })

  it('sends popup-ack and calls onPageReady when page-ready is received', async () => {
    const { initPopupSideChannel } = await importManager()

    const pageSideChannel = new MockBroadcastChannel('vite-devtools')
    const pageSideReceived: unknown[] = []
    pageSideChannel.addEventListener('message', (e: MessageEvent) => pageSideReceived.push(e.data))

    const onPageReady = vi.fn()
    const cleanup = initPopupSideChannel(document, onPageReady, vi.fn())

    // Simulate the page sending page-ready
    pageSideChannel.postMessage({ type: 'page-ready', title: 'My App' })

    expect(onPageReady).toHaveBeenCalledWith('My App')
    // The popup-ack should have been broadcast back (received by pageSideChannel)
    // Filter out the popup-ready that fires at init
    const acks = pageSideReceived.filter((m: unknown) => (m as { type: string }).type === 'popup-ack')
    expect(acks).toHaveLength(1)

    cleanup()
    pageSideChannel.close()
  })

  it('calls onPageGone after 3 s when page-closing is received with no reconnect', async () => {
    const { initPopupSideChannel } = await importManager()

    const pageSideChannel = new MockBroadcastChannel('vite-devtools')
    const onPageGone = vi.fn()
    const cleanup = initPopupSideChannel(document, vi.fn(), onPageGone)

    pageSideChannel.postMessage({ type: 'page-closing' })

    vi.advanceTimersByTime(2999)
    expect(onPageGone).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onPageGone).toHaveBeenCalledTimes(1)

    cleanup()
    pageSideChannel.close()
  })

  it('cancels disconnect timer when page-ready arrives after page-closing', async () => {
    const { initPopupSideChannel } = await importManager()

    const pageSideChannel = new MockBroadcastChannel('vite-devtools')
    const onPageReady = vi.fn()
    const onPageGone = vi.fn()
    const cleanup = initPopupSideChannel(document, onPageReady, onPageGone)

    // Page closes
    pageSideChannel.postMessage({ type: 'page-closing' })
    // Page reconnects within the window
    vi.advanceTimersByTime(1000)
    pageSideChannel.postMessage({ type: 'page-ready', title: 'Reconnected App' })

    // Advance past original timeout
    vi.advanceTimersByTime(2500)
    expect(onPageGone).not.toHaveBeenCalled()
    expect(onPageReady).toHaveBeenCalledWith('Reconnected App')

    cleanup()
    pageSideChannel.close()
  })

  it('cleanup function closes the channel and prevents further handling', async () => {
    const { initPopupSideChannel } = await importManager()

    const pageSideChannel = new MockBroadcastChannel('vite-devtools')
    const onPageGone = vi.fn()
    const cleanup = initPopupSideChannel(document, vi.fn(), onPageGone)

    cleanup()

    pageSideChannel.postMessage({ type: 'page-closing' })
    vi.advanceTimersByTime(4000)
    // After cleanup the channel is closed so no listeners should fire
    expect(onPageGone).not.toHaveBeenCalled()

    pageSideChannel.close()
  })
})
