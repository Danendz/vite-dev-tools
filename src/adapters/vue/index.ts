import type { Plugin } from 'vite'
import type { DevToolsConfig } from '../../core/types'
import { createDevtoolsPlugin } from '../../core/plugin-factory'
import { vueAdapter } from './adapter'

export type { DevToolsConfig } from '../../core/types'

export function devtools(config?: DevToolsConfig): Plugin {
  return createDevtoolsPlugin(vueAdapter, config)
}
