import { defineComponent, onMounted, onBeforeUnmount, ref, h } from 'vue'
import type { DevToolsConfig } from '../../core/types'
import { HOOK_SCRIPT } from './hook'

// These are replaced by Vite at dev time via the plugin's `config.define`
declare const __DEVTOOLS_OVERLAY_URL__: string
declare const __DEVTOOLS_RUNTIME_URL__: string
declare const __DEVTOOLS_CONFIG__: DevToolsConfig

/**
 * Vue component that mounts the devtools overlay.
 *
 * The Vite plugin (`devtools()`) is still required in vite.config.ts
 * for serving the overlay files.
 *
 * Usage:
 * ```vue
 * <script setup>
 * import { DevToolsPanel } from '@danendz/vite-dev-tools/vue/devtools'
 * </script>
 *
 * <template>
 *   <YourApp />
 *   <DevToolsPanel />
 * </template>
 * ```
 */
export const DevToolsPanel = defineComponent({
  name: 'DevToolsPanel',
  props: {
    open: { type: Boolean, default: undefined },
    shortcut: { type: String, default: undefined },
    accentColor: { type: String, default: undefined },
  },
  setup(props) {
    const containerRef = ref<HTMLDivElement | null>(null)
    const initialized = ref(false)

    // In production builds Vite replaces import.meta.env.DEV with false,
    // making the entire setup body dead code that the bundler tree-shakes away.
    if (!import.meta.env.DEV) return () => null

    onMounted(() => {
      if (initialized.value || !containerRef.value) return
      initialized.value = true

      const container = containerRef.value
      const config = { ...__DEVTOOLS_CONFIG__, ...props }

      // 1. Inject hook script (sets up __VUE_DEVTOOLS_GLOBAL_HOOK__)
      const script = document.createElement('script')
      script.textContent = HOOK_SCRIPT
      document.head.prepend(script)

      // 2. Load runtime (instance walker + update listener)
      import(/* @vite-ignore */ __DEVTOOLS_RUNTIME_URL__)

      // 3. Load and mount overlay inside this component's container
      import(/* @vite-ignore */ __DEVTOOLS_OVERLAY_URL__).then((mod) => {
        mod.mountOverlay(config, container)
      })
    })

    onBeforeUnmount(() => {
      if (containerRef.value) {
        const host = containerRef.value.querySelector('#danendz-devtools')
        if (host) host.remove()
      }
    })

    return () => h('div', { ref: containerRef })
  },
})

export type { DevToolsConfig } from '../../core/types'
