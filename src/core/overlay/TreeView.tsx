import { h } from 'preact'
import type { NormalizedNode } from '../types'
import { TreeNode } from './TreeNode'

interface TreeViewProps {
  tree: NormalizedNode[]
  selectedId: string | null
  expandedNodeIds?: Set<string> | null
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
}

export function TreeView({ tree, selectedId, expandedNodeIds, onSelect, onHover, onContextMenu }: TreeViewProps) {
  if (tree.length === 0) {
    return (
      <div style={{ padding: '20px', color: '#666', fontStyle: 'italic', textAlign: 'center' }}>
        No React components detected
      </div>
    )
  }

  return (
    <div>
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          expandedNodeIds={expandedNodeIds}
          onSelect={onSelect}
          onHover={onHover}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  )
}
