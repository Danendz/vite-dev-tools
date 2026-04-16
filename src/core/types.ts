import type { EditHint } from './adapter'

export type { EditHint } from './adapter'

export interface InspectorItem {
  key: string
  value: unknown
  editable: boolean
  persistable: boolean
  editHint?: EditHint
  /** Display adornment, e.g. "[useState]", "ref" */
  badge?: string
  /** Line number for click-to-navigate */
  lineNumber?: number
}

export interface InspectorSection {
  id: string
  label: string
  items: InspectorItem[]
}

export interface NormalizedNode {
  id: string
  name: string
  source: SourceLocation | null
  /** Props — kept top-level for tree row preview */
  props: Record<string, unknown>
  /** Generic inspector sections (replaces hooks/state) */
  sections: InspectorSection[]
  children: NormalizedNode[]
  isFromNodeModules: boolean
  /** Usage-site source location (where component is rendered in parent JSX) */
  usageSource?: SourceLocation
  /** Prop names that use dynamic bindings (:prop="expr") — persist-to-source is disabled for these */
  dynamicProps?: string[]
  /** True for DOM/host elements (div, span, etc.) vs components */
  isHostElement?: boolean
  /** Fallback source from parent component — used for library host elements that lack own source */
  _parentSource?: SourceLocation
  /** DOM element references for highlight — multiple when component returns a fragment */
  _domElements?: HTMLElement[]
  /** Joined text content from direct HostText children (for tree row preview) */
  textContent?: string
  /** Individual text fragments from direct HostText children (for DetailPanel editing) */
  textFragments?: string[]
  /** Live HostText fiber references for runtime text editing (React-only) */
  _textFibers?: any[]
  /** When this node is slot content, identifies the component that owns the <slot /> */
  slotOwner?: {
    componentName: string
    source: SourceLocation
  }
}

export interface SourceLocation {
  fileName: string
  lineNumber: number
  columnNumber: number
}

export type DockPosition = 'bottom' | 'left' | 'right'

export interface DevToolsConfig {
  /** Panel open by default (default: false) */
  open?: boolean
  /** Keyboard shortcut to toggle panel (default: 'ctrl+shift+d') */
  shortcut?: string
  /** Primary accent color hex — set by each framework adapter (default: '#8b5cf6') */
  accentColor?: string
  /** Which settings toggles are supported by the current adapter */
  supportedSettings?: string[]
  /** Enable MCP server for AI agent integration (default: false) */
  mcp?: boolean
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

export interface ToastItem {
  id: string
  type: 'error' | 'warning'
  message: string
  dismissedAt: number | null
}

export type ActiveTab = 'inspect' | 'console'

// MCP bridge types

export interface BridgeRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface BridgeResponse {
  id: string
  result?: unknown
  error?: string
}

export interface ConnectedTab {
  tabId: string
  path: string
  title?: string
  lastFocused: number
}

export interface CompactNode {
  id: string
  name: string
  children: CompactNode[]
  isFromNodeModules: boolean
  source: { fileName: string } | null
}

export type ActionSource = 'ai' | 'user'

export interface HighlightEntry {
  id: string
  rect: DOMRect
  name: string
  source: ActionSource
  domElements: HTMLElement[]
  persist: boolean
  _gen?: number
}
