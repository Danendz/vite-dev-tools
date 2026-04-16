import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import type { NormalizedNode } from '../types'
import { EVENTS } from '../../shared/constants'
import { Tooltip } from './Tooltip'

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

interface TreeNodeProps {
  node: NormalizedNode
  depth: number
  selectedId: string | null
  collapsedSet: Set<string>
  elementExpandedSet: Set<string>
  showAllElements: boolean
  matchingNodeIds?: Set<string> | null
  editedProps: Map<string, Set<string>>
  expandedPropsSet: Set<string>
  aiSelectedNodeIds?: Set<string>
  showAiActions?: boolean
  onToggle: (nodeId: string) => void
  onElementExpandToggle: (nodeId: string) => void
  onPropEdit: (nodeId: string, propKey: string) => void
  onExpandProps: (nodeId: string) => void
  onSelect: (node: NormalizedNode) => void
  onHover: (node: NormalizedNode | null) => void
  onContextMenu: (e: MouseEvent, node: NormalizedNode) => void
}

function InlinePropEdit({
  nodeId,
  propKey,
  initialValue,
  onDone,
  onPropEdit,
}: {
  nodeId: string
  propKey: string
  initialValue: string | number | null
  onDone: () => void
  onPropEdit: (nodeId: string, propKey: string) => void
}) {
  const valueType = initialValue === null ? 'null' : typeof initialValue
  const [editValue, setEditValue] = useState(
    initialValue === null ? 'null' : String(initialValue),
  )
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const confirm = () => {
    let parsed: unknown
    if (valueType === 'string') {
      parsed = editValue
    } else if (valueType === 'number') {
      parsed = Number(editValue)
      if (Number.isNaN(parsed)) return
    } else {
      try { parsed = JSON.parse(editValue) } catch { return }
    }

    window.dispatchEvent(new CustomEvent(EVENTS.PROP_EDIT, {
      detail: { nodeId, propKey, newValue: parsed },
    }))
    onPropEdit(nodeId, propKey)
    onDone()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') onDone()
    else if (e.key === 'Enter') confirm()
  }

  return (
    <input
      ref={inputRef}
      class="tree-node-prop-edit-input"
      type={valueType === 'number' ? 'number' : 'text'}
      value={editValue}
      onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
      onKeyDown={handleKeyDown}
      onBlur={onDone}
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
    />
  )
}

export function TreeNode({
  node,
  depth,
  selectedId,
  collapsedSet,
  elementExpandedSet,
  showAllElements,
  matchingNodeIds,
  editedProps,
  expandedPropsSet,
  aiSelectedNodeIds,
  showAiActions,
  onToggle,
  onElementExpandToggle,
  onPropEdit,
  onExpandProps,
  onSelect,
  onHover,
  onContextMenu,
}: TreeNodeProps) {
  const visibleChildren = getVisibleChildren(node, elementExpandedSet, showAllElements)
  const hasChildren = visibleChildren.length > 0
  const isSelected = selectedId === node.id
  const isSearchMatch = matchingNodeIds?.has(node.id) ?? false
  const collapsed = collapsedSet.has(node.id)
  const isPropsExpanded = expandedPropsSet.has(node.id)
  const editedKeysForNode = editedProps.get(node.id)
  const isElementExpanded = showAllElements || elementExpandedSet.has(node.id)
  const hasHostElementChildren = !node.isHostElement && node.children.some(c => c.isHostElement)
  const isAiSelected = showAiActions && aiSelectedNodeIds?.has(node.id)

  const [editingProp, setEditingProp] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  function countCollapsedChildren(n: NormalizedNode): number {
    const children = getVisibleChildren(n, elementExpandedSet, showAllElements)
    let count = children.length
    for (const child of children) {
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
    onToggle(node.id)
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node)
  }

  const handlePropDblClick = (e: MouseEvent, key: string, value: unknown) => {
    e.stopPropagation()
    e.preventDefault()

    if (typeof value === 'object' && value !== null) {
      // Show tooltip for objects
      if (tooltip) clearTimeout(tooltip.timer)
      const timer = setTimeout(() => setTooltip(null), 2000)
      setTooltip({ key, timer })
      return
    }

    if (value === 'fn()') return

    // Primitive: enter inline edit mode
    setEditingProp(key)
  }

  const handleBooleanClick = (e: MouseEvent, key: string, value: boolean) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(EVENTS.PROP_EDIT, {
      detail: { nodeId: node.id, propKey: key, newValue: !value },
    }))
    onPropEdit(node.id, key)
  }

  // Build prop display list
  const primitives: Array<{ key: string; value: unknown; display: string }> = []
  const objects: Array<{ key: string; value: unknown; display: string }> = []
  for (const [key, value] of Object.entries(node.props)) {
    if (value === 'fn()') continue
    let display: string
    if (value === null) { display = '{null}'; primitives.push({ key, value, display }); continue }
    if (typeof value === 'string') { display = `"${value.length > 20 ? value.slice(0, 20) + '\u2026' : value}"`; primitives.push({ key, value, display }); continue }
    if (typeof value === 'boolean' || typeof value === 'number') { display = `{${value}}`; primitives.push({ key, value, display }); continue }
    if (typeof value === 'object') {
      const json = JSON.stringify(value)
      display = `{${json.length > 30 ? json.slice(0, 30) + '\u2026' : json}}`
      objects.push({ key, value, display }); continue
    }
  }
  const displayable = [...primitives, ...objects]

  let shown: typeof displayable
  let remaining: number

  if (isPropsExpanded) {
    shown = displayable
    remaining = 0
  } else {
    let charBudget = 120
    shown = []
    for (const prop of displayable) {
      const len = prop.key.length + 1 + prop.display.length
      if (shown.length > 0 && charBudget - len < 0) break
      shown.push(prop)
      charBudget -= len
    }
    remaining = displayable.length - shown.length
  }

  return (
    <div class="tree-node">
      <div
        data-node-id={node.id}
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
        {hasHostElementChildren && (
          <Tooltip text={isElementExpanded ? 'Hide HTML elements' : 'Show HTML elements'}>
            <span
              class={`tree-node-element-toggle${isElementExpanded ? ' active' : ''}`}
              onClick={(e: MouseEvent) => { e.stopPropagation(); onElementExpandToggle(node.id) }}
            >
              {'</>'}
            </span>
          </Tooltip>
        )}
        <span class={`tree-node-name${node.isFromNodeModules ? ' from-node-modules' : ''}${node.isHostElement ? ' host-element' : ''}${isSearchMatch ? ' search-match' : ''}`}>
          {'<'}{node.name}
          {shown.map(({ key, value, display }) => {
            const isEdited = editedKeysForNode?.has(key) ?? false

            if (editingProp === key) {
              return (
                <span key={key}>
                  {' '}<span class="tree-node-prop-name">{key}</span>
                  <span class="tree-node-prop-eq">=</span>
                  <InlinePropEdit
                    nodeId={node.id}
                    propKey={key}
                    initialValue={value as string | number | null}
                    onDone={() => setEditingProp(null)}
                    onPropEdit={onPropEdit}
                  />
                </span>
              )
            }

            if (typeof value === 'boolean') {
              return (
                <span key={key}>
                  {' '}<span class="tree-node-prop-name">{key}</span>
                  <span class="tree-node-prop-eq">=</span>
                  <Tooltip text="Click to toggle">
                    <span
                      class={`tree-node-prop-value tree-node-prop-clickable${isEdited ? ' tree-node-prop-value-edited' : ''}`}
                      onClick={(e) => handleBooleanClick(e, key, value)}
                    >
                      {display}
                    </span>
                  </Tooltip>
                </span>
              )
            }

            return (
              <span key={key} style={{ position: 'relative' }}>
                {' '}<span class="tree-node-prop-name">{key}</span>
                <span class="tree-node-prop-eq">=</span>
                <span
                  class={`tree-node-prop-value${isEdited ? ' tree-node-prop-value-edited' : ''}${typeof value !== 'object' || value === null ? ' tree-node-prop-clickable' : ''}`}
                  onDblClick={(e) => handlePropDblClick(e, key, value)}
                >
                  {display}
                </span>
                {tooltip?.key === key && (
                  <span class="tree-node-prop-tooltip">Edit objects in the detail panel</span>
                )}
              </span>
            )
          })}
          {remaining > 0 && (
            <Tooltip text="Show all props">
              <span
                class="tree-node-prop-overflow clickable"
                onClick={(e) => { e.stopPropagation(); onExpandProps(node.id) }}
              >
                {' '}...+{remaining}
              </span>
            </Tooltip>
          )}
          {isPropsExpanded && displayable.length > 3 && (
            <Tooltip text="Collapse props">
              <span
                class="tree-node-prop-overflow clickable"
                onClick={(e) => { e.stopPropagation(); onExpandProps(node.id) }}
              >
                {' '}\u2212
              </span>
            </Tooltip>
          )}
          {'>'}
        </span>
        {isAiSelected && <span class="tree-node-ai-badge">AI</span>}
        {node.textContent && !(isElementExpanded && hasHostElementChildren) && (
          <span class="tree-node-text">
            {' "'}
            {node.textContent.length > 40
              ? node.textContent.slice(0, 40) + '\u2026'
              : node.textContent}
            {'"'}
          </span>
        )}
        {collapsed && hasChildren && (
          <span class="tree-node-collapsed-count">
            ({countCollapsedChildren(node)})
          </span>
        )}
      </div>
      {!collapsed && hasChildren && (
        <div class="tree-node-children">
          {visibleChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              collapsedSet={collapsedSet}
              elementExpandedSet={elementExpandedSet}
              showAllElements={showAllElements}
              matchingNodeIds={matchingNodeIds}
              editedProps={editedProps}
              expandedPropsSet={expandedPropsSet}
              aiSelectedNodeIds={aiSelectedNodeIds}
              showAiActions={showAiActions}
              onToggle={onToggle}
              onElementExpandToggle={onElementExpandToggle}
              onPropEdit={onPropEdit}
              onExpandProps={onExpandProps}
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
