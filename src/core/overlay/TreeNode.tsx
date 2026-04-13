import { h } from 'preact'
import { useState, useMemo, useEffect, useRef } from 'preact/hooks'
import type { NormalizedNode } from '../types'
import { shouldCollapse } from '../collapse'

interface TreeNodeProps {
  node: NormalizedNode
  depth: number
  selectedId: string | null
  expandedNodeIds?: Set<string> | null
  matchingNodeIds?: Set<string> | null
  searchAncestorIds?: Set<string> | null
  collapseTarget: 'all' | 'none' | null
  collapseVersion: number
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
}

export function TreeNode({
  node,
  depth,
  selectedId,
  expandedNodeIds,
  matchingNodeIds,
  searchAncestorIds,
  collapseTarget,
  collapseVersion,
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

  // Force expand ancestors when search is active
  useEffect(() => {
    if (searchAncestorIds?.has(node.id)) {
      setCollapsed(false)
    }
  }, [searchAncestorIds])

  // Collapse all / Expand all
  useEffect(() => {
    if (collapseVersion === 0) return
    setCollapsed(collapseTarget === 'all')
  }, [collapseVersion])

  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id
  const isSearchMatch = matchingNodeIds?.has(node.id) ?? false

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
        style={{ marginLeft: `${-depth * 14}px`, paddingLeft: `${depth * 14 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={() => onHover(node)}
        onMouseLeave={() => onHover(null)}
        onContextMenu={handleContextMenu}
      >
        <span class="tree-node-toggle" onClick={hasChildren ? handleToggle : undefined}>
          {hasChildren ? (collapsed ? '\u25B6' : '\u25BC') : ''}
        </span>
        <span class={`tree-node-name${node.isFromNodeModules ? ' from-node-modules' : ''}${isSearchMatch ? ' search-match' : ''}`}>
          {'<'}{node.name}
          {(() => {
            const primitives: Array<{ key: string; display: string }> = []
            const objects: Array<{ key: string; display: string }> = []
            for (const [key, value] of Object.entries(node.props)) {
              if (value === 'fn()') continue
              let display: string
              if (value === null) { display = '{null}'; primitives.push({ key, display }); continue }
              if (typeof value === 'string') { display = `"${value.length > 20 ? value.slice(0, 20) + '\u2026' : value}"`; primitives.push({ key, display }); continue }
              if (typeof value === 'boolean' || typeof value === 'number') { display = `{${value}}`; primitives.push({ key, display }); continue }
              if (typeof value === 'object') {
                const json = JSON.stringify(value)
                display = `{${json.length > 30 ? json.slice(0, 30) + '\u2026' : json}}`
                objects.push({ key, display }); continue
              }
            }
            const displayable = [...primitives, ...objects]
            let charBudget = 120
            const shown: typeof displayable = []
            for (const prop of displayable) {
              const len = prop.key.length + 1 + prop.display.length
              if (shown.length > 0 && charBudget - len < 0) break
              shown.push(prop)
              charBudget -= len
            }
            const remaining = displayable.length - shown.length
            return (
              <>
                {shown.map(({ key, display }) => (
                  <span key={key}>
                    {' '}<span class="tree-node-prop-name">{key}</span>
                    <span class="tree-node-prop-eq">=</span>
                    <span class="tree-node-prop-value">{display}</span>
                  </span>
                ))}
                {remaining > 0 && (
                  <span class="tree-node-prop-overflow"> ...+{remaining}</span>
                )}
              </>
            )
          })()}
          {'>'}
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
              matchingNodeIds={matchingNodeIds}
              searchAncestorIds={searchAncestorIds}
              collapseTarget={collapseTarget}
              collapseVersion={collapseVersion}
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
