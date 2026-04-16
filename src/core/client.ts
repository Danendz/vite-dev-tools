import { h, render } from 'preact'
import type { DevToolsConfig } from './types'
import { App } from './overlay/App'
import { STYLES } from './overlay/styles'
import { initBridgeClient } from './mcp/bridge-client'

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

  render(h(App, { config }), mountPoint)

  // Initialize MCP bridge if enabled
  if (config.mcp) {
    initBridgeClient()
  }
}
