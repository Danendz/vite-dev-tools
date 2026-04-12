import type { Plugin } from 'vite'
import type { DevToolsConfig } from '../../core/types'
import { createReactDevToolsPlugin } from './plugin'

export type { DevToolsConfig } from '../../core/types'

export function devtools(config?: DevToolsConfig): Plugin {
  return createReactDevToolsPlugin(config)
}
