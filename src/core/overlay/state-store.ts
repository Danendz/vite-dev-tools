import type { NormalizedNode, ConsoleEntry, ActionSource } from '../types'

/** Shared state readable by the MCP bridge client */
export const devtoolsState = {
  tree: [] as NormalizedNode[],
  selectedNode: null as NormalizedNode | null,
  consoleEntries: [] as ConsoleEntry[],

  setTree(tree: NormalizedNode[]) { this.tree = tree },
  setSelectedNode(node: NormalizedNode | null) { this.selectedNode = node },
  setConsoleEntries(entries: ConsoleEntry[]) { this.consoleEntries = entries },

  // Action callbacks registered by App.tsx
  onSelectNode: null as ((node: NormalizedNode) => void) | null,
  onHighlight: null as ((node: NormalizedNode | null, source?: ActionSource, persist?: boolean) => void) | null,
}
