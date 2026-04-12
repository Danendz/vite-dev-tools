import { useEffect, useRef } from 'react'
import type { DevToolsConfig } from '../../core/types'
import { HOOK_SCRIPT } from './hook'

// These are replaced by Vite at dev time via the plugin's `config.define`
// They resolve to /@fs/ URLs that bypass any proxy setup
declare const __DEVTOOLS_OVERLAY_URL__: string
declare const __DEVTOOLS_RUNTIME_URL__: string
declare const __DEVTOOLS_CONFIG__: DevToolsConfig

/**
 * React component that mounts the devtools overlay.
 * Use this for projects where Vite doesn't serve index.html
 * (e.g., WordPress, custom SSR, micro-frontends).
 *
 * The Vite plugin (`devtools()`) is still required in vite.config.ts
 * for source transforms and serving the overlay files.
 *
 * Usage:
 * ```tsx
 * import { DevToolsPanel } from '@danendz/vite-dev-tools/react/devtools'
 *
 * function App() {
 *   return (
 *     <>
 *       <YourApp />
 *       <DevToolsPanel />
 *     </>
 *   )
 * }
 * ```
 */
export function DevToolsPanel(props: DevToolsConfig = {}): null {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const config = { ...__DEVTOOLS_CONFIG__, ...props }

    // 1. Inject hook script (wraps existing __REACT_DEVTOOLS_GLOBAL_HOOK__)
    const script = document.createElement('script')
    script.textContent = HOOK_SCRIPT
    document.head.prepend(script)

    // 2. Load runtime (fiber walker + commit listener)
    import(/* @vite-ignore */ __DEVTOOLS_RUNTIME_URL__)

    // 3. Load and mount overlay
    import(/* @vite-ignore */ __DEVTOOLS_OVERLAY_URL__).then((mod) => {
      mod.mountOverlay(config)
    })

    return () => {
      const host = document.getElementById('danendz-devtools')
      if (host) host.remove()
    }
  }, [])

  return null
}
