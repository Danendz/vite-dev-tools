export interface NormalizedNode {
  id: string
  name: string
  source: SourceLocation | null
  props: Record<string, unknown>
  hooks: HookInfo[]
  state: unknown
  children: NormalizedNode[]
  isFromNodeModules: boolean
  /** Usage-site source location (where component is rendered in parent JSX) */
  usageSource?: SourceLocation
  /** DOM element references for highlight — multiple when component returns a fragment */
  _domElements?: HTMLElement[]
}

export interface SourceLocation {
  fileName: string
  lineNumber: number
  columnNumber: number
}

export interface HookInfo {
  name: string
  value: unknown
  varName?: string
  lineNumber?: number
}

export type DockPosition = 'bottom' | 'left' | 'right'

export interface DevToolsConfig {
  /** Panel open by default (default: false) */
  open?: boolean
  /** Keyboard shortcut to toggle panel (default: 'ctrl+shift+d') */
  shortcut?: string
  /** Primary accent color hex — set by each framework adapter (default: '#8b5cf6') */
  accentColor?: string
}

export interface CollapseOverrides {
  alwaysShow: string[]
  alwaysHide: string[]
}

export interface TreeUpdateEvent {
  tree: NormalizedNode[]
}

export type ConsoleEntryType = 'error' | 'warning'

export interface ConsoleEntry {
  id: string
  type: ConsoleEntryType
  timestamp: number
  message: string
  stack: string | null
}

export type ActiveTab = 'inspect' | 'console'
