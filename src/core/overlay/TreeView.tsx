import { h } from 'preact'
import type { NormalizedNode } from '../types'
import { TreeNode } from './TreeNode'

interface TreeViewProps {
  tree: NormalizedNode[]
  selectedId: string | null
  expandedNodeIds?: Set<string> | null
  searchQuery: string
  matchingNodeIds: Set<string> | null
  searchAncestorIds: Set<string> | null
  collapseTarget: 'all' | 'none' | null
  collapseVersion: number
  onSearchChange: (query: string) => void
  onCollapseAll: () => void
  onExpandAll: () => void
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
}

export function TreeView({
  tree,
  selectedId,
  expandedNodeIds,
  searchQuery,
  matchingNodeIds,
  searchAncestorIds,
  collapseTarget,
  collapseVersion,
  onSearchChange,
  onCollapseAll,
  onExpandAll,
  onSelect,
  onHover,
  onContextMenu,
}: TreeViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="6.5" cy="6.5" r="4" />
          <line x1="10" y1="10" x2="14" y2="14" />
        </svg>
        <input
          class="search-input"
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
        />
        <button class="search-bar-btn" onClick={onExpandAll} title="Expand all">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <button class="search-bar-btn" onClick={onCollapseAll} title="Collapse all">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', overscrollBehavior: 'contain', padding: '4px 0' }}>
        {tree.length === 0 ? (
          <div style={{ padding: '20px', color: '#666', fontStyle: 'italic', textAlign: 'center' }}>
            {searchQuery ? 'No matching components' : 'No React components detected'}
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expandedNodeIds={expandedNodeIds}
              matchingNodeIds={matchingNodeIds}
              searchAncestorIds={searchAncestorIds}
              collapseTarget={collapseTarget}
              collapseVersion={collapseVersion}
              onSelect={onSelect}
              onHover={onHover}
              onContextMenu={onContextMenu}
            />
          ))
        )}
      </div>
    </div>
  )
}
