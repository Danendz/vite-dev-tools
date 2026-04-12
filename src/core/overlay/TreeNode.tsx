import { h } from 'preact'
import { useState, useMemo, useEffect, useRef } from 'preact/hooks'
import type { NormalizedNode } from '../types'
import { shouldCollapse } from '../collapse'

interface TreeNodeProps {
  node: NormalizedNode
  depth: number
  selectedId: string | null
  expandedNodeIds?: Set<string> | null
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
}

export function TreeNode({
  node,
  depth,
  selectedId,
  expandedNodeIds,
  onSelect,
  onHover,
  onContextMenu,
}: TreeNodeProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const defaultCollapsed = useMemo(
    () => shouldCollapse(node.name, node.isFromNodeModules),
    [node.name, node.isFromNodeModules],
  )
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  // Force expand when picker selects a descendant
  useEffect(() => {
    if (expandedNodeIds?.has(node.id)) {
      setCollapsed(false)
    }
  }, [expandedNodeIds])

  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  // Scroll into view when selected via picker
  useEffect(() => {
    if (isSelected && expandedNodeIds) {
      requestAnimationFrame(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }, [isSelected, expandedNodeIds])

  function countCollapsedChildren(n: NormalizedNode): number {
    let count = n.children.length
    for (const child of n.children) {
      count += countCollapsedChildren(child)
    }
    return count
  }

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    onSelect(node)
  }

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation()
    setCollapsed(!collapsed)
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node)
  }

  return (
    <div class="tree-node">
      <div
        ref={rowRef}
        class={`tree-node-row${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={() => onHover(node)}
        onMouseLeave={() => onHover(null)}
        onContextMenu={handleContextMenu}
      >
        <span class="tree-node-toggle" onClick={hasChildren ? handleToggle : undefined}>
          {hasChildren ? (collapsed ? '\u25B6' : '\u25BC') : ''}
        </span>
        <span class={`tree-node-name${node.isFromNodeModules ? ' from-node-modules' : ''}`}>
          {'<'}{node.name}{'>'}
        </span>
        {collapsed && hasChildren && (
          <span class="tree-node-collapsed-count">
            ({countCollapsedChildren(node)})
          </span>
        )}
      </div>
      {!collapsed && hasChildren && (
        <div class="tree-node-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedNodeIds={expandedNodeIds}
              onSelect={onSelect}
              onHover={onHover}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}
