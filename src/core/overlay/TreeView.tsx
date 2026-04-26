import { h } from 'preact'
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks'
import type { NormalizedNode } from '../types'
import { TreeNode } from './TreeNode'
import { Tooltip } from './Tooltip'
import { useT } from './i18n'

/** Flatten past host elements to extract component children when not element-expanded */
function flattenPastHostElements(children: NormalizedNode[]): NormalizedNode[] {
  const result: NormalizedNode[] = []
  for (const child of children) {
    if (child.isHostElement) {
      result.push(...flattenPastHostElements(child.children))
    } else {
      result.push(child)
    }
  }
  return result
}

/** Get visible children based on element expand state */
function getVisibleChildren(node: NormalizedNode, elementExpandedSet: Set<string>, showAllElements: boolean): NormalizedNode[] {
  if (showAllElements || elementExpandedSet.has(node.id) || node.isHostElement) {
    return node.children
  }
  return flattenPastHostElements(node.children)
}

interface TreeViewProps {
  tree: NormalizedNode[]
  selectedId: string | null
  expandedNodeIds?: Set<string> | null
  elementExpandedNodeIds?: Set<string> | null
  showAllElements: boolean
  searchQuery: string
  matchingNodeIds: Set<string> | null
  searchAncestorIds: Set<string> | null
  editedProps: Map<string, Set<string>>
  expandedPropsSet: Set<string>
  errorCountMap?: Map<string, number>
  directErrorMap?: Map<string, number>
  nodeHasError?: Set<string>
  errorFilterActive?: boolean
  errorAncestorIds?: Set<string> | null
  onErrorFilterToggle?: () => void
  aiSelectedNodeIds?: Set<string>
  showAiActions?: boolean
  commitComponentIds?: Set<number> | null
  onSearchChange: (query: string) => void
  onPropEdit: (nodeId: string, propKey: string) => void
  onExpandProps: (nodeId: string) => void
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
  onPropSourceClick?: (componentId: string, propName: string) => void
}

/** Collect all node IDs where isFromNodeModules is true (default collapsed) */
function collectDefaultCollapsed(nodes: NormalizedNode[], out: Set<string>, elementExpandedSet: Set<string>, showAllElements: boolean) {
  for (const node of nodes) {
    if (node.isFromNodeModules) out.add(node.id)
    const children = getVisibleChildren(node, elementExpandedSet, showAllElements)
    collectDefaultCollapsed(children, out, elementExpandedSet, showAllElements)
  }
}

/** Build a map from nodeId to parent nodeId */
function buildParentMap(nodes: NormalizedNode[], parentId: string | null, out: Map<string, string | null>, elementExpandedSet: Set<string>, showAllElements: boolean) {
  for (const node of nodes) {
    out.set(node.id, parentId)
    const children = getVisibleChildren(node, elementExpandedSet, showAllElements)
    buildParentMap(children, node.id, out, elementExpandedSet, showAllElements)
  }
}

/** Depth-first list of visible (not hidden by collapse) nodes */
function flattenVisible(nodes: NormalizedNode[], collapsedSet: Set<string>, elementExpandedSet: Set<string>, showAllElements: boolean): NormalizedNode[] {
  const result: NormalizedNode[] = []
  for (const node of nodes) {
    result.push(node)
    const children = getVisibleChildren(node, elementExpandedSet, showAllElements)
    if (!collapsedSet.has(node.id) && children.length > 0) {
      result.push(...flattenVisible(children, collapsedSet, elementExpandedSet, showAllElements))
    }
  }
  return result
}

/** Collect all node IDs in the tree */
function collectAllIds(nodes: NormalizedNode[], out: Set<string>, elementExpandedSet: Set<string>, showAllElements: boolean) {
  for (const node of nodes) {
    out.add(node.id)
    const children = getVisibleChildren(node, elementExpandedSet, showAllElements)
    collectAllIds(children, out, elementExpandedSet, showAllElements)
  }
}

export function TreeView({
  tree,
  selectedId,
  expandedNodeIds,
  elementExpandedNodeIds,
  showAllElements,
  searchQuery,
  matchingNodeIds,
  searchAncestorIds,
  editedProps,
  expandedPropsSet,
  errorCountMap,
  directErrorMap,
  nodeHasError,
  errorFilterActive,
  errorAncestorIds,
  onErrorFilterToggle,
  aiSelectedNodeIds,
  showAiActions,
  commitComponentIds,
  onSearchChange,
  onPropEdit,
  onExpandProps,
  onSelect,
  onHover,
  onContextMenu,
  onPropSourceClick,
}: TreeViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { t } = useT()

  // Element expand state: which component nodes have their host elements expanded
  const [elementExpandedSet, setElementExpandedSet] = useState<Set<string>>(new Set())

  const handleElementExpandToggle = useCallback((nodeId: string) => {
    setElementExpandedSet(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  // Picker element expand: auto-expand component ancestors of picked host element
  useEffect(() => {
    if (!elementExpandedNodeIds) return
    setElementExpandedSet(prev => {
      const next = new Set(prev)
      let changed = false
      for (const id of elementExpandedNodeIds) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [elementExpandedNodeIds])

  // Collapse state: set of node IDs that are collapsed
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(() => {
    const s = new Set<string>()
    collectDefaultCollapsed(tree, s, elementExpandedSet, showAllElements)
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

  // Error filter: uncollapse ancestors of error nodes
  useEffect(() => {
    if (!errorAncestorIds) return
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of errorAncestorIds) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : prev
    })
  }, [errorAncestorIds])

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
      collectAllIds(tree, all, elementExpandedSet, showAllElements)
      return all
    })
  }, [tree, elementExpandedSet, showAllElements])

  const handleExpandAll = useCallback(() => {
    setCollapsedSet(new Set())
  }, [])

  // Flat list of visible nodes for keyboard navigation
  const flatVisible = useMemo(
    () => flattenVisible(tree, collapsedSet, elementExpandedSet, showAllElements),
    [tree, collapsedSet, elementExpandedSet, showAllElements],
  )

  // Parent map for Left-arrow "jump to parent"
  const parentMap = useMemo(() => {
    const m = new Map<string, string | null>()
    buildParentMap(tree, null, m, elementExpandedSet, showAllElements)
    return m
  }, [tree, elementExpandedSet, showAllElements])

  // Find node by ID in flat list
  const nodeById = useMemo(() => {
    const m = new Map<string, NormalizedNode>()
    for (const node of flatVisible) m.set(node.id, node)
    return m
  }, [flatVisible])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept if typing in an input or textarea
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

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
      const visChildren = getVisibleChildren(node, elementExpandedSet, showAllElements)
      // If expanded and has children → collapse
      if (visChildren.length > 0 && !collapsedSet.has(selectedId)) {
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
      const visChildren = getVisibleChildren(node, elementExpandedSet, showAllElements)
      // If collapsed and has children → expand
      if (visChildren.length > 0 && collapsedSet.has(selectedId)) {
        handleToggle(selectedId)
      } else if (visChildren.length > 0) {
        // Jump to first child
        onSelect(visChildren[0])
      }
    } else if (key === 'Enter') {
      // Enter just confirms selection — scrollIntoView handled by TreeNode
    }
  }, [selectedId, flatVisible, collapsedSet, parentMap, nodeById, onSelect, handleToggle, elementExpandedSet, showAllElements])

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
          placeholder={t('tree.searchPlaceholder')}
          value={searchQuery}
          onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
        />
        <Tooltip text={t('tree.expandAll')}>
          <button class="search-bar-btn" onClick={handleExpandAll}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip text={t('tree.collapseAll')}>
          <button class="search-bar-btn" onClick={handleCollapseAll}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </Tooltip>
        {errorCountMap && errorCountMap.size > 0 && (
          <Tooltip text={t('tree.filterErrors')}>
            <button
              class={`error-filter-btn${errorFilterActive ? ' active' : ''}`}
              onClick={onErrorFilterToggle}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4zm.75 7.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
              </svg>
            </button>
          </Tooltip>
        )}
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
            {searchQuery ? t('tree.noMatching') : t('tree.noComponents')}
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              collapsedSet={collapsedSet}
              elementExpandedSet={elementExpandedSet}
              showAllElements={showAllElements}
              matchingNodeIds={matchingNodeIds}
              editedProps={editedProps}
              expandedPropsSet={expandedPropsSet}
              aiSelectedNodeIds={aiSelectedNodeIds}
              showAiActions={showAiActions}
              commitComponentIds={commitComponentIds}
              errorCountMap={errorCountMap}
              directErrorMap={directErrorMap}
              nodeHasError={nodeHasError}
              onToggle={handleToggle}
              onElementExpandToggle={handleElementExpandToggle}
              onPropEdit={onPropEdit}
              onExpandProps={onExpandProps}
              onSelect={onSelect}
              onHover={onHover}
              onContextMenu={onContextMenu}
              onPropSourceClick={onPropSourceClick}
            />
          ))
        )}
      </div>
    </div>
  )
}
