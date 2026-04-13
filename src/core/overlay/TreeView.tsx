import { h } from 'preact'
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks'
import type { NormalizedNode } from '../types'
import { TreeNode } from './TreeNode'

interface TreeViewProps {
  tree: NormalizedNode[]
  selectedId: string | null
  expandedNodeIds?: Set<string> | null
  searchQuery: string
  matchingNodeIds: Set<string> | null
  searchAncestorIds: Set<string> | null
  editedProps: Map<string, Set<string>>
  expandedPropsSet: Set<string>
  onSearchChange: (query: string) => void
  onPropEdit: (nodeId: string, propKey: string) => void
  onExpandProps: (nodeId: string) => void
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
}

/** Collect all node IDs where isFromNodeModules is true (default collapsed) */
function collectDefaultCollapsed(nodes: NormalizedNode[], out: Set<string>) {
  for (const node of nodes) {
    if (node.isFromNodeModules) out.add(node.id)
    collectDefaultCollapsed(node.children, out)
  }
}

/** Build a map from nodeId to parent nodeId */
function buildParentMap(nodes: NormalizedNode[], parentId: string | null, out: Map<string, string | null>) {
  for (const node of nodes) {
    out.set(node.id, parentId)
    buildParentMap(node.children, node.id, out)
  }
}

/** Depth-first list of visible (not hidden by collapse) nodes */
function flattenVisible(nodes: NormalizedNode[], collapsedSet: Set<string>): NormalizedNode[] {
  const result: NormalizedNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (!collapsedSet.has(node.id) && node.children.length > 0) {
      result.push(...flattenVisible(node.children, collapsedSet))
    }
  }
  return result
}

/** Collect all node IDs in the tree */
function collectAllIds(nodes: NormalizedNode[], out: Set<string>) {
  for (const node of nodes) {
    out.add(node.id)
    collectAllIds(node.children, out)
  }
}

export function TreeView({
  tree,
  selectedId,
  expandedNodeIds,
  searchQuery,
  matchingNodeIds,
  searchAncestorIds,
  editedProps,
  expandedPropsSet,
  onSearchChange,
  onPropEdit,
  onExpandProps,
  onSelect,
  onHover,
  onContextMenu,
}: TreeViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Collapse state: set of node IDs that are collapsed
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(() => {
    const s = new Set<string>()
    collectDefaultCollapsed(tree, s)
    return s
  })

  // When tree changes, add newly appeared node_modules nodes to collapsed set
  useEffect(() => {
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      let changed = false
      function addNew(nodes: NormalizedNode[]) {
        for (const node of nodes) {
          if (node.isFromNodeModules && !next.has(node.id)) {
            // Only auto-collapse if this is a new node we haven't seen
            // Check if it was previously explicitly expanded (not in prev means it's new)
            next.add(node.id)
            changed = true
          }
          addNew(node.children)
        }
      }
      addNew(tree)
      return changed ? next : prev
    })
  }, [tree])

  // Picker expand: uncollapse path to picked node
  useEffect(() => {
    if (!expandedNodeIds) return
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of expandedNodeIds) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
  }, [expandedNodeIds])

  // Search ancestor expand: uncollapse ancestors of matching nodes
  useEffect(() => {
    if (!searchAncestorIds) return
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of searchAncestorIds) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
  }, [searchAncestorIds])

  const handleToggle = useCallback((nodeId: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const handleCollapseAll = useCallback(() => {
    setCollapsedSet(() => {
      const all = new Set<string>()
      collectAllIds(tree, all)
      return all
    })
  }, [tree])

  const handleExpandAll = useCallback(() => {
    setCollapsedSet(new Set())
  }, [])

  // Flat list of visible nodes for keyboard navigation
  const flatVisible = useMemo(
    () => flattenVisible(tree, collapsedSet),
    [tree, collapsedSet],
  )

  // Parent map for Left-arrow "jump to parent"
  const parentMap = useMemo(() => {
    const m = new Map<string, string | null>()
    buildParentMap(tree, null, m)
    return m
  }, [tree])

  // Find node by ID in flat list
  const nodeById = useMemo(() => {
    const m = new Map<string, NormalizedNode>()
    for (const node of flatVisible) m.set(node.id, node)
    return m
  }, [flatVisible])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept if typing in the search input
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return

    const key = e.key
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return

    e.preventDefault()

    const currentIdx = selectedId ? flatVisible.findIndex((n) => n.id === selectedId) : -1

    if (key === 'ArrowDown') {
      const nextIdx = currentIdx + 1
      if (nextIdx < flatVisible.length) {
        onSelect(flatVisible[nextIdx])
      }
    } else if (key === 'ArrowUp') {
      const prevIdx = currentIdx - 1
      if (prevIdx >= 0) {
        onSelect(flatVisible[prevIdx])
      }
    } else if (key === 'ArrowLeft') {
      if (!selectedId) return
      const node = nodeById.get(selectedId)
      if (!node) return
      // If expanded and has children → collapse
      if (node.children.length > 0 && !collapsedSet.has(selectedId)) {
        handleToggle(selectedId)
      } else {
        // Jump to parent
        const parentId = parentMap.get(selectedId)
        if (parentId) {
          const parentNode = nodeById.get(parentId)
          if (parentNode) onSelect(parentNode)
        }
      }
    } else if (key === 'ArrowRight') {
      if (!selectedId) return
      const node = nodeById.get(selectedId)
      if (!node) return
      // If collapsed and has children → expand
      if (node.children.length > 0 && collapsedSet.has(selectedId)) {
        handleToggle(selectedId)
      } else if (node.children.length > 0) {
        // Jump to first child
        onSelect(node.children[0])
      }
    } else if (key === 'Enter') {
      // Enter just confirms selection — scrollIntoView handled by TreeNode
    }
  }, [selectedId, flatVisible, collapsedSet, parentMap, nodeById, onSelect, handleToggle])

  // Scroll selected node into view on keyboard navigation
  useEffect(() => {
    if (!selectedId || !scrollRef.current) return
    const row = scrollRef.current.querySelector(`[data-node-id="${selectedId}"]`) as HTMLElement | null
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedId])

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
        <button class="search-bar-btn" onClick={handleExpandAll} title="Expand all">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <button class="search-bar-btn" onClick={handleCollapseAll} title="Collapse all">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        class="tree-scroll-container"
        style={{ flex: 1, overflow: 'auto', overscrollBehavior: 'contain', padding: '4px 0', outline: 'none' }}
        onKeyDown={handleKeyDown}
      >
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
              collapsedSet={collapsedSet}
              matchingNodeIds={matchingNodeIds}
              editedProps={editedProps}
              expandedPropsSet={expandedPropsSet}
              onToggle={handleToggle}
              onPropEdit={onPropEdit}
              onExpandProps={onExpandProps}
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
