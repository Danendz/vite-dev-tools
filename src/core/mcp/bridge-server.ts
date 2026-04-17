import { randomUUID } from 'node:crypto'
import type { ViteDevServer } from 'vite'
import type { ConnectedTab, BridgeRequest, BridgeResponse } from '../types'
import { BRIDGE_EVENTS, RENDER_HISTORY_DEFAULTS } from '../../shared/constants'

export interface BridgeRequestOptions {
  /** Override the default 10s timeout. Useful for long-running tools like waitForCommit. */
  timeoutMs?: number
}

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

  // Store bound handlers for cleanup
  private _onRegister = (data: { tabId: string; path: string; title?: string }) => {
    this.tabs.set(data.tabId, {
      tabId: data.tabId,
      path: data.path,
      title: data.title,
      lastFocused: Date.now(),
    })
  }
  private _onFocus = (data: { tabId: string }) => {
    const tab = this.tabs.get(data.tabId)
    if (tab) tab.lastFocused = Date.now()
  }
  private _onUnload = (data: { tabId: string }) => {
    this.tabs.delete(data.tabId)
    for (const [id, pending] of this.pending) {
      if (pending.tabId === data.tabId) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(new Error('Tab disconnected.'))
      }
    }
  }
  private _onResponse = (data: BridgeResponse) => {
    const pending = this.pending.get(data.id)
    if (!pending) return
    this.pending.delete(data.id)
    clearTimeout(pending.timer)
    if (data.error) {
      pending.reject(new Error(data.error))
    } else {
      pending.resolve(data.result)
    }
  }

  attach(server: ViteDevServer) {
    if (this.server) this.detach()
    this.server = server

    server.hot.on(BRIDGE_EVENTS.TAB_REGISTER, this._onRegister)
    server.hot.on(BRIDGE_EVENTS.TAB_FOCUS, this._onFocus)
    server.hot.on(BRIDGE_EVENTS.TAB_UNLOAD, this._onUnload)
    server.hot.on(BRIDGE_EVENTS.RESPONSE, this._onResponse)
  }

  detach() {
    if (!this.server) return
    this.server.hot.off(BRIDGE_EVENTS.TAB_REGISTER, this._onRegister)
    this.server.hot.off(BRIDGE_EVENTS.TAB_FOCUS, this._onFocus)
    this.server.hot.off(BRIDGE_EVENTS.TAB_UNLOAD, this._onUnload)
    this.server.hot.off(BRIDGE_EVENTS.RESPONSE, this._onResponse)
    // Flush all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Bridge detached.'))
    }
    this.pending.clear()
    this.server = null
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

  async request(
    method: string,
    params?: Record<string, unknown>,
    tabId?: string,
    options?: BridgeRequestOptions,
  ): Promise<unknown> {
    if (!this.server) throw new Error('Bridge not attached to a Vite server.')

    const tab = this.resolveTab(tabId)
    if (!tab) throw new Error('No browser tab connected. The user needs to open the app in their browser.')

    const id = randomUUID()
    const request: BridgeRequest = {
      id,
      method,
      params: { ...params, _targetTabId: tab.tabId },
    }

    const timeoutMs = options?.timeoutMs ?? RENDER_HISTORY_DEFAULTS.DEFAULT_BRIDGE_TIMEOUT_MS

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Tab disconnected during request.'))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer, tabId: tab.tabId })
      this.server!.hot.send(BRIDGE_EVENTS.REQUEST, request)
    })
  }
}
