import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BridgeServer } from '@/core/mcp/bridge-server'
import { BRIDGE_EVENTS } from '@/shared/constants'

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1'),
}))

type Handler = (...args: any[]) => void

function createFakeServer() {
  const listeners = new Map<string, Handler[]>()
  return {
    hot: {
      on(event: string, handler: Handler) {
        if (!listeners.has(event)) listeners.set(event, [])
        listeners.get(event)!.push(handler)
      },
      off(event: string, handler: Handler) {
        const fns = listeners.get(event)
        if (fns) listeners.set(event, fns.filter(f => f !== handler))
      },
      send: vi.fn(),
      // Test helper: simulate an incoming event
      _emit(event: string, data: any) {
        for (const fn of listeners.get(event) ?? []) fn(data)
      },
      _listeners: listeners,
    },
  }
}

describe('BridgeServer', () => {
  let bridge: BridgeServer
  let server: ReturnType<typeof createFakeServer>

  beforeEach(() => {
    vi.useFakeTimers()
    bridge = new BridgeServer()
    server = createFakeServer()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('attach/detach', () => {
    it('registers HMR event handlers on attach', () => {
      bridge.attach(server as any)
      expect(server.hot._listeners.get(BRIDGE_EVENTS.TAB_REGISTER)?.length).toBe(1)
      expect(server.hot._listeners.get(BRIDGE_EVENTS.RESPONSE)?.length).toBe(1)
    })

    it('removes handlers and rejects pending on detach', async () => {
      bridge.attach(server as any)

      // Register a tab and start a request
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })
      const promise = bridge.request('test')

      bridge.detach()

      await expect(promise).rejects.toThrow('Bridge detached.')
      // Handlers should be removed
      expect(server.hot._listeners.get(BRIDGE_EVENTS.TAB_REGISTER)?.length).toBe(0)
    })
  })

  describe('tab management', () => {
    it('tracks registered tabs', () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/', title: 'Tab 1' })
      const tabs = bridge.getConnectedTabs()
      expect(tabs.length).toBe(1)
      expect(tabs[0].tabId).toBe('t1')
      expect(tabs[0].title).toBe('Tab 1')
    })

    it('updates lastFocused on focus event', () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })
      const before = bridge.getConnectedTabs()[0].lastFocused

      vi.advanceTimersByTime(100)
      server.hot._emit(BRIDGE_EVENTS.TAB_FOCUS, { tabId: 't1' })
      const after = bridge.getConnectedTabs()[0].lastFocused

      expect(after).toBeGreaterThan(before)
    })

    it('removes tab on unload and rejects pending requests for that tab', async () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })

      const promise = bridge.request('test')
      server.hot._emit(BRIDGE_EVENTS.TAB_UNLOAD, { tabId: 't1' })

      await expect(promise).rejects.toThrow('Tab disconnected.')
      expect(bridge.getConnectedTabs().length).toBe(0)
    })
  })

  describe('request/response', () => {
    it('throws if not attached', async () => {
      await expect(bridge.request('test')).rejects.toThrow('Bridge not attached')
    })

    it('throws if no tabs connected', async () => {
      bridge.attach(server as any)
      await expect(bridge.request('test')).rejects.toThrow('No browser tab connected')
    })

    it('sends bridge request event via hot.send', () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })
      bridge.request('getComponentTree', { depth: 3 })

      expect(server.hot.send).toHaveBeenCalledWith(
        BRIDGE_EVENTS.REQUEST,
        expect.objectContaining({
          id: 'test-uuid-1',
          method: 'getComponentTree',
          params: expect.objectContaining({ depth: 3, _targetTabId: 't1' }),
        }),
      )
    })

    it('resolves when a matching response arrives', async () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })

      const promise = bridge.request('test')

      // Simulate response
      server.hot._emit(BRIDGE_EVENTS.RESPONSE, { id: 'test-uuid-1', result: { data: 'ok' } })

      const result = await promise
      expect(result).toEqual({ data: 'ok' })
    })

    it('rejects when response has an error', async () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })

      const promise = bridge.request('test')
      server.hot._emit(BRIDGE_EVENTS.RESPONSE, { id: 'test-uuid-1', error: 'Something failed' })

      await expect(promise).rejects.toThrow('Something failed')
    })

    it('times out after 10 seconds', async () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })

      const promise = bridge.request('test')
      vi.advanceTimersByTime(10_001)

      await expect(promise).rejects.toThrow('Tab disconnected during request.')
    })

    it('honors a custom timeoutMs', async () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })

      const promise = bridge.request('test', {}, undefined, { timeoutMs: 500 })
      vi.advanceTimersByTime(501)

      await expect(promise).rejects.toThrow('Tab disconnected during request.')
    })

    it('a longer custom timeoutMs does NOT trigger at the default 10s', async () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/' })

      const promise = bridge.request('test', {}, undefined, { timeoutMs: 20_000 })
      vi.advanceTimersByTime(15_000)
      // Resolve the request now that we've passed the old default timeout.
      server.hot._emit(BRIDGE_EVENTS.RESPONSE, { id: 'test-uuid-1', result: 'late' })

      await expect(promise).resolves.toBe('late')
    })

    it('auto-selects most recently focused tab', () => {
      bridge.attach(server as any)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't1', path: '/a' })
      vi.advanceTimersByTime(100)
      server.hot._emit(BRIDGE_EVENTS.TAB_REGISTER, { tabId: 't2', path: '/b' })

      bridge.request('test')

      expect(server.hot.send).toHaveBeenCalledWith(
        BRIDGE_EVENTS.REQUEST,
        expect.objectContaining({
          params: expect.objectContaining({ _targetTabId: 't2' }),
        }),
      )
    })
  })
})
