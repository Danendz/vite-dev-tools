import { randomUUID } from 'node:crypto'
import type { ViteDevServer } from 'vite'
import type { ConnectedTab, BridgeRequest, BridgeResponse } from '../types'
import { BRIDGE_EVENTS } from '../../shared/constants'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  tabId: string
}

export class BridgeServer {
  private tabs = new Map<string, ConnectedTab>()
  private pending = new Map<string, PendingRequest>()
  private server: ViteDevServer | null = null

  attach(server: ViteDevServer) {
    this.server = server

    server.hot.on(BRIDGE_EVENTS.TAB_REGISTER, (data: { tabId: string; path: string; title?: string }) => {
      this.tabs.set(data.tabId, {
        tabId: data.tabId,
        path: data.path,
        title: data.title,
        lastFocused: Date.now(),
      })
    })

    server.hot.on(BRIDGE_EVENTS.TAB_FOCUS, (data: { tabId: string }) => {
      const tab = this.tabs.get(data.tabId)
      if (tab) tab.lastFocused = Date.now()
    })

    server.hot.on(BRIDGE_EVENTS.TAB_UNLOAD, (data: { tabId: string }) => {
      this.tabs.delete(data.tabId)
      // Flush pending requests for this tab
      for (const [id, pending] of this.pending) {
        if (pending.tabId === data.tabId) {
          clearTimeout(pending.timer)
          this.pending.delete(id)
          pending.reject(new Error('Tab disconnected.'))
        }
      }
    })

    server.hot.on(BRIDGE_EVENTS.RESPONSE, (data: BridgeResponse) => {
      const pending = this.pending.get(data.id)
      if (!pending) return
      this.pending.delete(data.id)
      clearTimeout(pending.timer)
      if (data.error) {
        pending.reject(new Error(data.error))
      } else {
        pending.resolve(data.result)
      }
    })
  }

  getConnectedTabs(): ConnectedTab[] {
    return Array.from(this.tabs.values())
  }

  private resolveTab(tabParam?: string): ConnectedTab | null {
    if (tabParam) return this.tabs.get(tabParam) ?? null

    const tabs = Array.from(this.tabs.values())
    if (tabs.length === 0) return null
    if (tabs.length === 1) return tabs[0]

    // Multiple tabs — return most recently focused
    return tabs.reduce((a, b) => (a.lastFocused >= b.lastFocused ? a : b))
  }

  async request(method: string, params?: Record<string, unknown>, tabId?: string): Promise<unknown> {
    if (!this.server) throw new Error('Bridge not attached to a Vite server.')

    const tab = this.resolveTab(tabId)
    if (!tab) throw new Error('No browser tab connected. The user needs to open the app in their browser.')

    const id = randomUUID()
    const request: BridgeRequest = {
      id,
      method,
      params: { ...params, _targetTabId: tab.tabId },
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Tab disconnected during request.'))
      }, 10_000)

      this.pending.set(id, { resolve, reject, timer, tabId: tab.tabId })
      this.server!.hot.send(BRIDGE_EVENTS.REQUEST, request)
    })
  }
}
