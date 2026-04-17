import type { NormalizedNode, ConsoleEntry, ActionSource, CommitRecord } from '../types'

/** Shared state readable by the MCP bridge client */
export const devtoolsState = {
  tree: [] as NormalizedNode[],
  selectedNode: null as NormalizedNode | null,
  consoleEntries: [] as ConsoleEntry[],

  /** Ring-buffered render-commit history (React adapter, when enabled) */
  renderHistory: [] as CommitRecord[],
  /** Whether the buffer is currently accepting new commits */
  renderHistoryRecording: true as boolean,

  setTree(tree: NormalizedNode[]) { this.tree = tree },
  setSelectedNode(node: NormalizedNode | null) { this.selectedNode = node },
  setConsoleEntries(entries: ConsoleEntry[]) { this.consoleEntries = entries },
  setRenderHistory(commits: CommitRecord[]) { this.renderHistory = commits },
  setRenderHistoryRecording(enabled: boolean) { this.renderHistoryRecording = enabled },

  // Action callbacks registered by App.tsx
  onSelectNode: null as ((node: NormalizedNode) => void) | null,
  onHighlight: null as ((node: NormalizedNode | null, source?: ActionSource, persist?: boolean) => void) | null,

  // MCP integration: control hooks for render history from bridge
  onClearRenderHistory: null as (() => void) | null,
  onSetRenderHistoryRecording: null as ((enabled: boolean) => void) | null,
}
