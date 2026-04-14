import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import type { NormalizedNode, SourceLocation, InspectorItem, EditHint } from '../types'
import { openInEditor, persistEdit, persistPropValue, persistTextValue } from '../communication'
import { EVENTS } from '../../shared/constants'

function formatPath(source: SourceLocation): string {
  return `${source.fileName.replace(/^.*\/src\//, 'src/')}:${source.lineNumber}`
}

function copyPath(source: SourceLocation, e: Event) {
  e.stopPropagation()
  navigator.clipboard.writeText(formatPath(source))
}

interface DetailPanelProps {
  node: NormalizedNode | null
  editedProps?: Map<string, Set<string>>
  onPropEdit?: (nodeId: string, propKey: string) => void
  onPropPersisted?: (nodeId: string, propKey: string) => void
}

function formatPrimitive(value: unknown): { text: string; className: string } | null {
  if (value === null) return { text: 'null', className: 'detail-value' }
  if (value === undefined) return { text: 'undefined', className: 'detail-value' }
  switch (typeof value) {
    case 'string': return { text: `"${value}"`, className: 'detail-value string' }
    case 'number': return { text: String(value), className: 'detail-value number' }
    case 'boolean': return { text: String(value), className: 'detail-value boolean' }
    default: return null
  }
}

function isExpandableObject(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object'
}

function objectPreview(value: Record<string, unknown> | unknown[]): string {
  try {
    if (Array.isArray(value)) return `Array(${value.length})`
    const keys = Object.keys(value)
    const preview = keys.slice(0, 3).join(', ')
    return `{${preview}${keys.length > 3 ? ', \u2026' : ''}}`
  } catch {
    return '[Object]'
  }
}

function ExpandableValue({ value }: { value: Record<string, unknown> | unknown[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <span class="detail-value">
      <span class="detail-expand-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? '\u25BC' : '\u25B6'}
      </span>
      {!expanded ? (
        <span class="detail-object-preview" onClick={() => setExpanded(true)}>
          {objectPreview(value)}
        </span>
      ) : (
        <div class="detail-object-expanded">
          {(Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)).map(
            ([k, v]) => {
              const prim = formatPrimitive(v)
              return (
                <div class="detail-object-entry" key={k}>
                  <span class="detail-key">{k}:</span>
                  {prim ? (
                    <span class={prim.className}>{prim.text}</span>
                  ) : isExpandableObject(v) ? (
                    <ExpandableValue value={v} />
                  ) : (
                    <span class="detail-value">{String(v)}</span>
                  )}
                </div>
              )
            },
          )}
        </div>
      )}
    </span>
  )
}

function ValueDisplay({ value }: { value: unknown }) {
  const prim = formatPrimitive(value)
  if (prim) return <span class={prim.className}>{prim.text}</span>
  if (isExpandableObject(value)) return <ExpandableValue value={value} />
  return <span class="detail-value">{String(value)}</span>
}

function dispatchSectionEdit(nodeId: string, editHint: EditHint, newValue: unknown) {
  window.dispatchEvent(new CustomEvent(EVENTS.VALUE_EDIT, {
    detail: { nodeId, editHint, newValue },
  }))
}

function EditableValue({ item, nodeId, source }: { item: InspectorItem; nodeId: string; source: SourceLocation | null }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [showPersist, setShowPersist] = useState(false)
  const [persistStatus, setPersistStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  const value = item.value
  const valueType = value === null ? 'null' : typeof value

  // Boolean: single click toggles immediately
  if (valueType === 'boolean' && item.editHint) {
    return (
      <span
        class="editable-value-wrapper editable edit-boolean-toggle"
        onClick={() => dispatchSectionEdit(nodeId, item.editHint!, !value)}
        title="Click to toggle"
      >
        <span class={`detail-value boolean`}>{String(value)}</span>
      </span>
    )
  }

  const enterEditMode = () => {
    setEditError(null)
    if (valueType === 'object' || Array.isArray(value)) {
      setEditValue(JSON.stringify(value, null, 2))
    } else if (valueType === 'null') {
      setEditValue('null')
    } else {
      setEditValue(String(value))
    }
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditError(null)
  }

  const confirmEdit = () => {
    let parsed: unknown
    try {
      if (valueType === 'string') {
        parsed = editValue
      } else if (valueType === 'number') {
        parsed = Number(editValue)
        if (Number.isNaN(parsed)) {
          setEditError('Invalid number')
          return
        }
      } else {
        parsed = JSON.parse(editValue)
      }
    } catch {
      setEditError('Invalid JSON')
      return
    }

    if (item.editHint) {
      dispatchSectionEdit(nodeId, item.editHint, parsed)
    }
    setEditing(false)
    setEditError(null)

    // Show persist button for persistable items with primitive values
    const isPrimitive = parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)
    if (item.persistable && isPrimitive && item.lineNumber != null && source?.fileName) {
      setShowPersist(true)
      setPersistStatus('idle')
    }
  }

  const handlePersist = async () => {
    if (!source?.fileName || item.lineNumber == null || !item.editHint) return
    setPersistStatus('saving')
    const result = await persistEdit({
      editHint: item.editHint,
      value: item.value,
      fileName: source.fileName,
      lineNumber: item.lineNumber,
      componentName: '',
    })
    setPersistStatus(result.ok ? 'saved' : 'error')
    if (result.ok) setTimeout(() => setShowPersist(false), 1500)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelEdit()
    } else if (e.key === 'Enter') {
      if (e.target instanceof HTMLTextAreaElement) {
        if (e.ctrlKey || e.metaKey) confirmEdit()
      } else {
        confirmEdit()
      }
    }
  }

  if (!editing) {
    return (
      <span class="editable-value-wrapper editable" onDblClick={enterEditMode}>
        <ValueDisplay value={value} />
        {showPersist && (
          <button class="persist-btn" onClick={handlePersist} disabled={persistStatus === 'saving'}>
            {persistStatus === 'saving' ? '...' : persistStatus === 'saved' ? '✓' : persistStatus === 'error' ? '✕ failed' : 'Persist'}
          </button>
        )}
      </span>
    )
  }

  const isComplex = valueType === 'object' || Array.isArray(value)

  return (
    <span class="edit-inline">
      {isComplex ? (
        <textarea
          ref={inputRef as any}
          class="edit-textarea"
          value={editValue}
          onInput={(e) => setEditValue((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <input
          ref={inputRef as any}
          class="edit-input"
          type={valueType === 'number' ? 'number' : 'text'}
          value={editValue}
          onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
        />
      )}
      <span class="edit-controls">
        <button class="edit-btn confirm" onClick={confirmEdit} title="Confirm (Enter)">✓</button>
        <button class="edit-btn" onClick={cancelEdit} title="Cancel (Esc)">✕</button>
      </span>
      {editError && <span class="edit-error">{editError}</span>}
    </span>
  )
}

function dispatchPropEdit(nodeId: string, propKey: string, newValue: unknown) {
  window.dispatchEvent(new CustomEvent(EVENTS.PROP_EDIT, {
    detail: { nodeId, propKey, newValue },
  }))
}

function EditablePropValue({
  propKey,
  value,
  nodeId,
  usageSource,
  dynamicProps,
  isEdited,
  onPropEdit,
  onPropPersisted,
}: {
  propKey: string
  value: unknown
  nodeId: string
  usageSource?: SourceLocation
  dynamicProps?: string[]
  isEdited: boolean
  onPropEdit?: (nodeId: string, propKey: string) => void
  onPropPersisted?: (nodeId: string, propKey: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [showPersist, setShowPersist] = useState(false)
  const [persistStatus, setPersistStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  const valueType = value === null ? 'null' : typeof value
  const isFunction = value === 'fn()'

  if (isFunction) {
    return <span class="detail-value">{String(value)}</span>
  }

  const handlePersist = async () => {
    if (!usageSource?.fileName || !usageSource?.lineNumber) return
    setPersistStatus('saving')
    const result = await persistPropValue({
      fileName: usageSource.fileName,
      lineNumber: usageSource.lineNumber,
      propKey,
      newValue: value as string | number | boolean | null,
    })
    setPersistStatus(result.ok ? 'saved' : 'error')
    if (result.ok) {
      onPropPersisted?.(nodeId, propKey)
      setTimeout(() => {
        setShowPersist(false)
        setPersistStatus('idle')
      }, 1500)
    }
  }

  // Show persist when: local edit confirmed OR prop was edited externally (e.g. inline tree edit)
  // Dynamic bindings (:prop="expr") cannot be persisted to source
  const isDynamic = dynamicProps?.includes(propKey)
  const canPersist = !isDynamic && usageSource?.fileName && usageSource?.lineNumber &&
    (value === null || ['string', 'number', 'boolean'].includes(typeof value))
  const shouldShowPersist = showPersist || (isEdited && canPersist && persistStatus !== 'saved')

  const persistButton = shouldShowPersist && (
    <div class="persist-row">
      <button class="persist-btn-lg" onClick={handlePersist} disabled={persistStatus === 'saving'}>
        {persistStatus === 'saving' ? 'Saving...' : persistStatus === 'saved' ? '\u2713 Saved' : persistStatus === 'error' ? '\u2715 Failed' : 'Save to source'}
      </button>
    </div>
  )

  // Boolean: single click toggles immediately
  if (valueType === 'boolean') {
    return (
      <>
        <span
          class={`editable-value-wrapper editable edit-boolean-toggle${isEdited ? ' prop-edited' : ''}`}
          onClick={() => {
            dispatchPropEdit(nodeId, propKey, !value)
            onPropEdit?.(nodeId, propKey)
          }}
          title="Click to toggle"
        >
          <span class="detail-value boolean">{String(value)}</span>
        </span>
        {persistButton}
      </>
    )
  }

  const enterEditMode = () => {
    setEditError(null)
    if (isExpandableObject(value)) {
      setEditValue(JSON.stringify(value, null, 2))
    } else if (valueType === 'null') {
      setEditValue('null')
    } else {
      setEditValue(String(value))
    }
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditError(null)
  }

  const confirmEdit = () => {
    let parsed: unknown
    try {
      if (valueType === 'string') {
        parsed = editValue
      } else if (valueType === 'number') {
        parsed = Number(editValue)
        if (Number.isNaN(parsed)) {
          setEditError('Invalid number')
          return
        }
      } else {
        parsed = JSON.parse(editValue)
      }
    } catch {
      setEditError('Invalid JSON')
      return
    }

    dispatchPropEdit(nodeId, propKey, parsed)
    onPropEdit?.(nodeId, propKey)
    setEditing(false)
    setEditError(null)

    // Show persist button for primitive values when usageSource is available (not for dynamic bindings)
    const isPrimitive = parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)
    if (isPrimitive && !isDynamic && usageSource?.fileName && usageSource?.lineNumber) {
      setShowPersist(true)
      setPersistStatus('idle')
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelEdit()
    } else if (e.key === 'Enter') {
      if (e.target instanceof HTMLTextAreaElement) {
        if (e.ctrlKey || e.metaKey) confirmEdit()
      } else {
        confirmEdit()
      }
    }
  }

  if (!editing) {
    return (
      <>
        <span class={`editable-value-wrapper editable${isEdited ? ' prop-edited' : ''}`} onDblClick={enterEditMode}>
          <ValueDisplay value={value} />
        </span>
        {persistButton}
      </>
    )
  }

  const isComplex = isExpandableObject(value)

  return (
    <span class="edit-inline">
      {isComplex ? (
        <textarea
          ref={inputRef as any}
          class={`edit-textarea${editError ? ' edit-error-input' : ''}`}
          value={editValue}
          onInput={(e) => setEditValue((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <input
          ref={inputRef as any}
          class={`edit-input${editError ? ' edit-error-input' : ''}`}
          type={valueType === 'number' ? 'number' : 'text'}
          value={editValue}
          onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
        />
      )}
      <span class="edit-controls">
        <button class="edit-btn confirm" onClick={confirmEdit} title="Confirm (Enter)">✓</button>
        <button class="edit-btn" onClick={cancelEdit} title="Cancel (Esc)">✕</button>
      </span>
      {editError && <span class="edit-error">{editError}</span>}
    </span>
  )
}

function TextFragmentRow({ text, nodeId, fragmentIndex, source }: {
  text: string
  nodeId: string
  fragmentIndex: number
  source: SourceLocation | null
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [showPersist, setShowPersist] = useState(false)
  const [persistStatus, setPersistStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const enterEditMode = () => {
    setOriginalText(text)
    setEditValue(text)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
  }

  const confirmEdit = () => {
    window.dispatchEvent(new CustomEvent(EVENTS.TEXT_EDIT, {
      detail: { nodeId, fragmentIndex, newValue: editValue },
    }))
    setEditing(false)
    setShowPersist(true)
    setPersistStatus('idle')
  }

  const handlePersist = async () => {
    if (!source?.fileName || !source?.lineNumber) return
    setPersistStatus('saving')
    const result = await persistTextValue({
      fileName: source.fileName,
      lineNumber: source.lineNumber,
      oldText: originalText,
      newText: editValue,
    })
    setPersistStatus(result.ok ? 'saved' : 'error')
    if (result.ok) setTimeout(() => setShowPersist(false), 1500)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') cancelEdit()
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmEdit()
  }

  if (editing) {
    return (
      <div class="detail-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <textarea
          ref={inputRef}
          class="edit-textarea"
          value={editValue}
          onInput={(e) => setEditValue((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
        <span class="edit-controls">
          <button class="edit-btn confirm" onMouseDown={(e) => { e.preventDefault(); confirmEdit() }} title="Confirm (Ctrl+Enter)">&#10003;</button>
          <button class="edit-btn" onMouseDown={(e) => { e.preventDefault(); cancelEdit() }} title="Cancel (Esc)">&#10005;</button>
        </span>
      </div>
    )
  }

  return (
    <div class="detail-row">
      <span class="detail-text-fragment editable" onDblClick={enterEditMode} title="Double-click to edit">
        "{text}"
      </span>
      {showPersist && source?.fileName && (
        <div class="persist-row">
          <button class="persist-btn-lg" onClick={handlePersist} disabled={persistStatus === 'saving'}>
            {persistStatus === 'saving' ? 'Saving...' : persistStatus === 'saved' ? '\u2713 Saved' : persistStatus === 'error' ? '\u2715 Failed' : 'Save to source'}
          </button>
        </div>
      )}
    </div>
  )
}

export function DetailPanel({ node, editedProps, onPropEdit, onPropPersisted }: DetailPanelProps) {
  if (!node) {
    return <div class="detail-pane-empty">Select a component to inspect</div>
  }

  const propEntries = Object.entries(node.props)
  const hasProps = propEntries.length > 0

  const effectiveSource = node.source ?? node._parentSource ?? null
  const showUsageSource = !node.isHostElement && node.usageSource && node.source &&
    node.usageSource.fileName !== node.source.fileName

  return (
    <div>
      <div class="detail-section">
        <div class="detail-component-name">{node.isHostElement ? `<${node.name}>` : node.name}</div>
        {effectiveSource && (
          <>
            {showUsageSource && <div class="source-label">Source</div>}
            <div class="source-link-row">
              <div class="source-link" onClick={() => openInEditor(effectiveSource)}>
                {formatPath(effectiveSource)}
              </div>
              <button class="source-copy-btn" onClick={(e) => copyPath(effectiveSource, e)} title="Copy path">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </>
        )}
        {showUsageSource && (
          <>
            <div class="source-label">Used in</div>
            <div class="source-link-row">
              <div class="source-link" onClick={() => openInEditor(node.usageSource!)}>
                {formatPath(node.usageSource!)}
              </div>
              <button class="source-copy-btn" onClick={(e) => copyPath(node.usageSource!, e)} title="Copy path">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {hasProps && (
        <div class="detail-section">
          <div class="detail-section-title">{node.isHostElement ? 'Attributes' : 'Props'}</div>
          {propEntries.map(([key, value]) => {
            if (node.isHostElement) {
              return (
                <div class="detail-row" key={key}>
                  <span class="detail-key">{key}:</span>
                  <ValueDisplay value={value} />
                </div>
              )
            }
            const isEdited = editedProps?.get(node.id)?.has(key) ?? false
            return (
              <div class="detail-row" key={key}>
                <span class="detail-key">{key}:</span>
                <EditablePropValue
                  propKey={key}
                  value={value}
                  nodeId={node.id}
                  usageSource={node.usageSource ?? node.source ?? undefined}
                  dynamicProps={node.dynamicProps}
                  isEdited={isEdited}
                  onPropEdit={onPropEdit}
                  onPropPersisted={onPropPersisted}
                />
              </div>
            )
          })}
        </div>
      )}

      {node.textFragments && node.textFragments.length > 0 && (
        <div class="detail-section">
          <div class="detail-section-title">Text</div>
          {node.textFragments.map((text, i) => (
            <TextFragmentRow
              key={i}
              text={text}
              nodeId={node.id}
              fragmentIndex={i}
              source={node.isHostElement ? (node.source ?? node._parentSource ?? null) : (node.usageSource ?? node.source)}
            />
          ))}
        </div>
      )}

      {node.sections.map((section) => {
        if (section.items.length === 0) return null
        return (
          <div class="detail-section" key={section.id}>
            <div class="detail-section-title">{section.label}</div>
            {section.items.map((item, i) => {
              const canNavigate = item.lineNumber != null && node.source != null

              return (
                <div class="detail-row" key={`${section.id}-${i}`}>
                  <span
                    class={`detail-key${canNavigate ? ' detail-key-clickable' : ''}`}
                    onClick={canNavigate ? () => openInEditor({
                      fileName: node.source!.fileName,
                      lineNumber: item.lineNumber!,
                      columnNumber: 1,
                    }) : undefined}
                  >
                    {item.key}:
                  </span>
                  {item.editable
                    ? <EditableValue item={item} nodeId={node.id} source={node.source} />
                    : <ValueDisplay value={item.value} />}
                  {item.badge && <span class="hook-type-tag">[{item.badge}]</span>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
