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
  /** Nested hooks inside a custom hook (for composable/custom hook introspection) */
  innerHooks?: InspectorItem[]
  /** Dependency array variable names (for useEffect/useMemo/useCallback) */
  depNames?: string[]
  /** Current dep values (for diff display in render-cause) */
  depValues?: unknown[]
  /** Source file path (for hooks defined in other files) */
  sourceFile?: string
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
  /** Stable ID across commits — persists while the fiber is mounted (React-only for now) */
  persistentId?: number
  /** Why this node re-rendered on the current commit (React-only for now) */
  renderCause?: RenderCause
  /** Hook dependency lint warnings (unstable deps, missing deps) */
  depWarnings?: DepWarning[]
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
  /** True when this component is an error boundary (React: componentDidCatch/getDerivedStateFromError, Vue: errorCaptured) */
  isErrorBoundary?: boolean
  /** True when the wasted-render threshold is met — component should be wrapped in memo() */
  memoSuggested?: boolean
  /** Wasted-render stats for the memo suggestion UI */
  memoStats?: { totalRenders: number; wastedRenders: number; wastedPercentage: number }
  /** Local variable names in this component's body (for jump-to-source, no runtime values) */
  locals?: Array<{ name: string; line: number }>
  /** Prop origins — which variable/import each prop value references */
  propOrigins?: Record<string, {
    source: 'local' | 'import'
    varName: string
    line: number
    file?: string
    isStatic: boolean
  }>
}

export interface SourceLocation {
  fileName: string
  lineNumber: number
  columnNumber: number
  /** End line of the component function — used for error attribution line-range matching */
  endLineNumber?: number
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
  /** Framework name — set automatically by the adapter (e.g. 'react', 'vue') */
  framework?: string
}

export interface TreeUpdateEvent {
  tree: NormalizedNode[]
  /** The commit that just occurred (React adapter only, when render-cause attribution is enabled) */
  commit?: CommitRecord
}

export type ConsoleEntryType = 'error' | 'warning' | 'log'

export interface StackFrame {
  fn: string | null
  file: string
  /** Original URL with query params (e.g. Vue SFC ?vue&type=script...) for source map lookup */
  rawFile?: string
  line: number
  col: number
  isLibrary: boolean
}

export interface NormalizedNodeSnapshot {
  id: string
  name: string
  source: SourceLocation | null
  props: Record<string, unknown>
  sections: InspectorSection[]
  isErrorBoundary?: boolean
  renderCause?: RenderCause
  depWarnings?: DepWarning[]
  memoStats?: { totalRenders: number; wastedRenders: number; wastedPercentage: number }
  locals?: Array<{ name: string; line: number }>
}

export interface ConsoleEntry {
  id: string
  type: ConsoleEntryType
  timestamp: number
  message: string
  stack: string | null
  frames: StackFrame[] | null
  count: number
  groupKey: string | null
  /** Attributed owning component — set at capture time via error attribution */
  ownedBy?: { name: string; nodeId: string; source: SourceLocation | null }
  /** Nearest error boundary ancestor that caught this error */
  caughtBy?: { componentName: string; nodeId: string }
  /** Snapshot of the owning component at capture time (clone minus live refs) */
  snapshot?: NormalizedNodeSnapshot
}

export interface RawFrame {
  file: string
  line: number
  col: number
}

export interface ResolvedFrame extends RawFrame {
  original: { file: string; line: number; col: number } | null
}

export interface ToastItem {
  id: string
  type: 'error' | 'warning'
  message: string
  dismissedAt: number | null
}

export type ActiveTab = 'inspect' | 'console' | 'renders'

// Render-cause attribution types (React adapter)

export type RenderCauseKind =
  | 'mount'
  | 'props'
  | 'state'
  | 'context'
  | 'parent'
  | 'bailout'

export interface ChangedHook {
  index: number
  hookName: string
  varName?: string
  /** Which specific deps changed (for effect/memo/callback hooks) */
  changedDeps?: Array<{ name: string; prev: unknown; next: unknown }>
}

export interface RenderCause {
  /** Drives the pip color; chosen by precedence: mount > state > context > props > parent > bailout */
  primary: RenderCauseKind
  /** All cause kinds that applied this commit (may be a single entry) */
  contributors: RenderCauseKind[]
  changedProps?: string[]
  changedHooks?: ChangedHook[]
  changedContexts?: string[]
  /** The commit index this cause belongs to */
  commitIndex: number
  /** For bailed-out nodes: the last commit on which this component actually rendered */
  lastRenderedCommit?: number
  /** Dep-level changes for effects/memos/callbacks */
  effectChanges?: Array<{
    hookIndex: number
    hookName: string
    varName?: string
    changedDeps: Array<{ name: string; prev: unknown; next: unknown }>
  }>
  /** True when the component is wrapped in React.memo (MemoComponent or SimpleMemoComponent) */
  isMemo?: boolean
}

export interface DepWarning {
  hookIndex: number
  hookName: string
  varName?: string
  kind: 'unstable' | 'missing' | 'was-unstable' | 'memo-suggested'
  /** For 'unstable': the dep names that are unstable */
  unstableDeps?: string[]
  /** For 'missing': identifiers referenced in callback but not in dep array */
  missingDeps?: string[]
  /** For 'was-unstable': how many consecutive stable renders */
  stableSince?: number
  /** Source line number of the hook (for click-to-source) */
  lineNumber?: number
  /** For 'memo-suggested': total renders tracked */
  totalRenders?: number
  /** For 'memo-suggested': how many of those were wasted (parent re-render, identical props) */
  wastedRenders?: number
}

export interface CommitComponentEntry {
  persistentId: number
  name: string
  source: SourceLocation | null
  cause: RenderCauseKind
  contributors: RenderCauseKind[]
  changedProps?: string[]
  changedHooks?: ChangedHook[]
  changedContexts?: string[]
  /** Only populated when includeValues is requested — truncated previews */
  previousValues?: Record<string, string>
  nextValues?: Record<string, string>
  previousHookValues?: Record<string, string>
  nextHookValues?: Record<string, string>
  /** Full pretty-printed values for modal inspection */
  fullPreviousValues?: Record<string, string>
  fullNextValues?: Record<string, string>
  fullPreviousHookValues?: Record<string, string>
  fullNextHookValues?: Record<string, string>
  /** Dep-level changes for effects/memos/callbacks */
  effectChanges?: Array<{
    hookIndex: number
    hookName: string
    varName?: string
    changedDeps: Array<{ name: string; prev: unknown; next: unknown }>
  }>
  /** True when this specific render was wasted (parent-caused, identical props, not memo-wrapped) */
  wastedRender?: boolean
}

export interface CommitRecord {
  commitIndex: number
  timestampMs: number
  components: CommitComponentEntry[]
}

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
  framework?: string
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
