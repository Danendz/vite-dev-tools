import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import type { NormalizedNode, SourceLocation, InspectorItem, EditHint } from '../types'
import { openInEditor, persistEdit, persistPropValue, persistTextValue, persistHookValue, undoEdit } from '../communication'
import type { DiffData, PreviewResult } from '../communication'
import { EVENTS, STORAGE_KEYS } from '../../shared/constants'
import { PreviewModal } from './PreviewModal'
import { Tooltip } from './Tooltip'

function formatPath(source: SourceLocation): string {
  return `${source.fileName.replace(/^.*\/src\//, 'src/')}:${source.lineNumber}`
}

function causeLabel(kind: string): string {
  switch (kind) {
    case 'mount': return 'Mounted'
    case 'props': return 'Props changed'
    case 'state': return 'State changed'
    case 'context': return 'Context changed'
    case 'parent': return 'Parent re-rendered'
    case 'bailout': return 'Skipped (memoized)'
    default: return kind
  }
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
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewConfirmRef = useRef<(() => Promise<void>) | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current) }, [])

  const value = item.value
  const valueType = value === null ? 'null' : typeof value

  // Boolean: single click toggles immediately
  if (valueType === 'boolean' && item.editHint) {
    return (
      <Tooltip text="Click to toggle">
        <span
          class="editable-value-wrapper editable edit-boolean-toggle"
          onClick={() => dispatchSectionEdit(nodeId, item.editHint!, !value)}
        >
          <span class={`detail-value boolean`}>{String(value)}</span>
        </span>
      </Tooltip>
    )
  }

  const enterEditMode = () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    setEditError(null)
    setUndoFile(null)
    setPersistStatus('idle')
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

  const [previewDiff, setPreviewDiff] = useState<DiffData | null>(null)
  const [undoFile, setUndoFile] = useState<string | null>(null)

  const doActualPersist = async () => {
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
    if (result.ok) {
      setUndoFile(source.fileName)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        setShowPersist(false)
        setPersistStatus('idle')
        setUndoFile(null)
        resetTimerRef.current = null
      }, 30000)
    }
  }

  const handlePersist = async () => {
    if (!source?.fileName || item.lineNumber == null || !item.editHint) return

    const showPreview = localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
    if (showPreview) {
      setPersistStatus('saving')
      const result = await persistEdit({
        editHint: item.editHint,
        value: item.value,
        fileName: source.fileName,
        lineNumber: item.lineNumber,
        componentName: '',
      }, true) as PreviewResult
      setPersistStatus('idle')
      if (result.ok && 'diff' in result) {
        previewConfirmRef.current = doActualPersist
        setPreviewDiff(result.diff)
      }
      return
    }

    await doActualPersist()
  }

  const handlePreviewConfirm = async () => {
    setPreviewDiff(null)
    const action = previewConfirmRef.current
    previewConfirmRef.current = null
    if (action) await action()
  }

  const doActualUndo = async () => {
    if (!undoFile) return
    await undoEdit({ fileName: undoFile })
    setUndoFile(null)
    setPersistStatus('idle')
    setShowPersist(false)
  }

  const handleUndo = async () => {
    if (!undoFile) return
    const showPreview = localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
    if (showPreview) {
      const result = await undoEdit({ fileName: undoFile }, true) as PreviewResult
      if (result.ok && 'diff' in result) {
        previewConfirmRef.current = doActualUndo
        setPreviewDiff(result.diff)
        return
      }
    }
    await doActualUndo()
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
          <>
            {persistStatus === 'saved' ? (
              <span class="saved-text">{'\u2713'}</span>
            ) : (
              <button class="persist-btn" onClick={handlePersist} disabled={persistStatus === 'saving'}>
                {persistStatus === 'saving' ? '...' : persistStatus === 'error' ? '\u2715 failed' : 'Persist'}
              </button>
            )}
            {undoFile && persistStatus === 'saved' && (
              <button class="undo-btn" onClick={handleUndo}>Undo</button>
            )}
          </>
        )}
        {previewDiff && (
          <PreviewModal
            diff={previewDiff}
            onConfirm={handlePreviewConfirm}
            onCancel={() => setPreviewDiff(null)}
          />
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
        <Tooltip text="Confirm" shortcut="Enter"><button class="edit-btn confirm" onClick={confirmEdit}>✓</button></Tooltip>
        <Tooltip text="Cancel" shortcut="Esc"><button class="edit-btn" onClick={cancelEdit}>✕</button></Tooltip>
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
  const [previewDiff, setPreviewDiff] = useState<DiffData | null>(null)
  const [undoFile, setUndoFile] = useState<string | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewConfirmRef = useRef<(() => Promise<void>) | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  // Reset all local state when the selected node changes
  useEffect(() => {
    setEditing(false)
    setShowPersist(false)
    setPersistStatus('idle')
    setPreviewDiff(null)
    setUndoFile(null)
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [nodeId])

  // Reset persist state when a new external edit arrives (e.g. inline tree edit)
  useEffect(() => {
    if (isEdited && persistStatus === 'saved') {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
      setPersistStatus('idle')
      setUndoFile(null)
    }
  }, [isEdited])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current) }, [])

  const valueType = value === null ? 'null' : typeof value
  const isFunction = value === 'fn()'

  if (isFunction) {
    return <span class="detail-value">{String(value)}</span>
  }

  const doActualPersist = async () => {
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
      setShowPersist(true) // Keep persist row visible for undo (inline edits never set showPersist)
      onPropPersisted?.(nodeId, propKey)
      setUndoFile(usageSource.fileName)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        setShowPersist(false)
        setPersistStatus('idle')
        setUndoFile(null)
        resetTimerRef.current = null
      }, 30000)
    }
  }

  const handlePersist = async () => {
    if (!usageSource?.fileName || !usageSource?.lineNumber) return

    const showPreview = localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
    if (showPreview) {
      setPersistStatus('saving')
      const result = await persistPropValue({
        fileName: usageSource.fileName,
        lineNumber: usageSource.lineNumber,
        propKey,
        newValue: value as string | number | boolean | null,
      }, true) as PreviewResult
      setPersistStatus('idle')
      if (result.ok && 'diff' in result) {
        previewConfirmRef.current = doActualPersist
        setPreviewDiff(result.diff)
      }
      return
    }

    await doActualPersist()
  }

  const handlePreviewConfirm = async () => {
    setPreviewDiff(null)
    const action = previewConfirmRef.current
    previewConfirmRef.current = null
    if (action) await action()
  }

  const doActualUndo = async () => {
    if (!undoFile) return
    await undoEdit({ fileName: undoFile })
    setUndoFile(null)
    setPersistStatus('idle')
    setShowPersist(false)
  }

  const handleUndo = async () => {
    if (!undoFile) return
    const showPreview = localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
    if (showPreview) {
      const result = await undoEdit({ fileName: undoFile }, true) as PreviewResult
      if (result.ok && 'diff' in result) {
        previewConfirmRef.current = doActualUndo
        setPreviewDiff(result.diff)
        return
      }
    }
    await doActualUndo()
  }

  // Show persist when: local edit confirmed OR prop was edited externally (e.g. inline tree edit)
  // Dynamic bindings (:prop="expr") cannot be persisted to source
  const isDynamic = dynamicProps?.includes(propKey)
  const canPersist = !isDynamic && usageSource?.fileName && usageSource?.lineNumber &&
    (value === null || ['string', 'number', 'boolean'].includes(typeof value))
  const shouldShowPersist = showPersist || (isEdited && canPersist && persistStatus !== 'saved')

  const persistButton = shouldShowPersist && (
    <div class="persist-row">
      {persistStatus === 'saved' ? (
        <span class="saved-text">{'\u2713'} Saved</span>
      ) : (
        <button class="persist-btn-lg" onClick={handlePersist} disabled={persistStatus === 'saving'}>
          {persistStatus === 'saving' ? 'Saving...' : persistStatus === 'error' ? '\u2715 Failed' : 'Save to source'}
        </button>
      )}
      {undoFile && persistStatus === 'saved' && (
        <button class="undo-btn" onClick={handleUndo}>Undo</button>
      )}
    </div>
  )

  const previewModal = previewDiff && (
    <PreviewModal
      diff={previewDiff}
      onConfirm={handlePreviewConfirm}
      onCancel={() => setPreviewDiff(null)}
    />
  )

  // Boolean: single click toggles immediately
  if (valueType === 'boolean') {
    return (
      <>
        <Tooltip text="Click to toggle">
          <span
            class={`editable-value-wrapper editable edit-boolean-toggle${isEdited ? ' prop-edited' : ''}`}
            onClick={() => {
              dispatchPropEdit(nodeId, propKey, !value)
              onPropEdit?.(nodeId, propKey)
            }}
          >
            <span class="detail-value boolean">{String(value)}</span>
          </span>
        </Tooltip>
        {persistButton}
        {previewModal}
      </>
    )
  }

  const enterEditMode = () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    setEditError(null)
    setUndoFile(null)
    setPersistStatus('idle')
    previewConfirmRef.current = null
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
      // Clear any pending reset timer from a previous save
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
      setShowPersist(true)
      setPersistStatus('idle')
      setUndoFile(null)
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
        {previewModal}
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
        <Tooltip text="Confirm" shortcut="Enter"><button class="edit-btn confirm" onClick={confirmEdit}>✓</button></Tooltip>
        <Tooltip text="Cancel" shortcut="Esc"><button class="edit-btn" onClick={cancelEdit}>✕</button></Tooltip>
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
  const [previewDiff, setPreviewDiff] = useState<DiffData | null>(null)
  const [undoFile, setUndoFile] = useState<string | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewConfirmRef = useRef<(() => Promise<void>) | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current) }, [])

  const enterEditMode = () => {
    // Clear any pending reset timer from a previous save
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    setOriginalText(text)
    setEditValue(text)
    setEditing(true)
    setUndoFile(null)
    setPersistStatus('idle')
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

  const doActualPersist = async () => {
    if (!source?.fileName || !source?.lineNumber) return
    setPersistStatus('saving')
    const result = await persistTextValue({
      fileName: source.fileName,
      lineNumber: source.lineNumber,
      oldText: originalText,
      newText: editValue,
    })
    setPersistStatus(result.ok ? 'saved' : 'error')
    if (result.ok) {
      setUndoFile(source.fileName)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => {
        setShowPersist(false)
        setPersistStatus('idle')
        setUndoFile(null)
        resetTimerRef.current = null
      }, 30000)
    }
  }

  const handlePersist = async () => {
    if (!source?.fileName || !source?.lineNumber) return

    const showPreview = localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
    if (showPreview) {
      setPersistStatus('saving')
      const result = await persistTextValue({
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        oldText: originalText,
        newText: editValue,
      }, true) as PreviewResult
      setPersistStatus('idle')
      if (result.ok && 'diff' in result) {
        previewConfirmRef.current = doActualPersist
        setPreviewDiff(result.diff)
      }
      return
    }

    await doActualPersist()
  }

  const handlePreviewConfirm = async () => {
    setPreviewDiff(null)
    const action = previewConfirmRef.current
    previewConfirmRef.current = null
    if (action) await action()
  }

  const doActualUndo = async () => {
    if (!undoFile) return
    await undoEdit({ fileName: undoFile })
    setUndoFile(null)
    setPersistStatus('idle')
    setShowPersist(false)
  }

  const handleUndo = async () => {
    if (!undoFile) return
    const showPreview = localStorage.getItem(STORAGE_KEYS.SHOW_PREVIEW) !== 'false'
    if (showPreview) {
      const result = await undoEdit({ fileName: undoFile }, true) as PreviewResult
      if (result.ok && 'diff' in result) {
        previewConfirmRef.current = doActualUndo
        setPreviewDiff(result.diff)
        return
      }
    }
    await doActualUndo()
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
          <Tooltip text="Confirm" shortcut="Ctrl+Enter"><button class="edit-btn confirm" onMouseDown={(e) => { e.preventDefault(); confirmEdit() }}>&#10003;</button></Tooltip>
          <Tooltip text="Cancel" shortcut="Esc"><button class="edit-btn" onMouseDown={(e) => { e.preventDefault(); cancelEdit() }}>&#10005;</button></Tooltip>
        </span>
      </div>
    )
  }

  return (
    <div class="detail-row">
      <Tooltip text="Double-click to edit"><span class="detail-text-fragment editable" onDblClick={enterEditMode}>
        "{text}"
      </span></Tooltip>
      {showPersist && source?.fileName && (
        <div class="persist-row">
          {persistStatus === 'saved' ? (
            <span class="saved-text">{'\u2713'} Saved</span>
          ) : (
            <button class="persist-btn-lg" onClick={handlePersist} disabled={persistStatus === 'saving'}>
              {persistStatus === 'saving' ? 'Saving...' : persistStatus === 'error' ? '\u2715 Failed' : 'Save to source'}
            </button>
          )}
          {undoFile && persistStatus === 'saved' && (
            <button class="undo-btn" onClick={handleUndo}>Undo</button>
          )}
        </div>
      )}
      {previewDiff && (
        <PreviewModal
          diff={previewDiff}
          onConfirm={handlePreviewConfirm}
          onCancel={() => setPreviewDiff(null)}
        />
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
              <Tooltip text="Copy path">
                <button class="source-copy-btn" onClick={(e) => copyPath(effectiveSource, e)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </>
        )}
        {node.slotOwner && (
          <Tooltip text={`Open slot in ${formatPath(node.slotOwner!.source)}`}>
            <div
              class="slot-indicator"
              onClick={() => openInEditor(node.slotOwner!.source)}
            >
              slot in {node.slotOwner.componentName}
            </div>
          </Tooltip>
        )}
        {showUsageSource && (
          <>
            <div class="source-label">Used in</div>
            <div class="source-link-row">
              <div class="source-link" onClick={() => openInEditor(node.usageSource!)}>
                {formatPath(node.usageSource!)}
              </div>
              <Tooltip text="Copy path">
                <button class="source-copy-btn" onClick={(e) => copyPath(node.usageSource!, e)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>

      {node.renderCause && (
        <div class="detail-section">
          <div class="detail-section-title">Why did this render?</div>
          <div class="detail-why">
            <div class={`detail-why-primary cause-${node.renderCause.primary}`}>
              <span class={`tree-cause-pip cause-${node.renderCause.primary}`} />
              <span class="detail-why-primary-label">{causeLabel(node.renderCause.primary)}</span>
              <span class="detail-why-commit">commit #{node.renderCause.commitIndex}</span>
            </div>
            {node.renderCause.changedProps && node.renderCause.changedProps.length > 0 && (
              <div class="detail-why-row">
                <span class="detail-why-row-label">Props changed:</span>
                <span class="detail-why-row-keys">{node.renderCause.changedProps.join(', ')}</span>
              </div>
            )}
            {node.renderCause.changedHooks && node.renderCause.changedHooks.length > 0 && (
              <div class="detail-why-row">
                <span class="detail-why-row-label">State changed:</span>
                <span class="detail-why-row-keys">
                  {node.renderCause.changedHooks
                    .map((h) => h.varName ? `${h.varName} (${h.hookName})` : `${h.hookName} #${h.index}`)
                    .join(', ')}
                </span>
                {node.renderCause.changedHooks.some(h => h.changedDeps) && (
                  <div class="detail-why-deps">
                    {node.renderCause.changedHooks
                      .filter(h => h.changedDeps)
                      .map((h, i) => (
                        <div class="detail-why-dep-row" key={i}>
                          <span class="detail-why-dep-hook">{h.varName ?? h.hookName}:</span>
                          {h.changedDeps!.map((d, j) => (
                            <span class="detail-why-dep-change" key={j}>
                              {d.name} ({String(d.prev)} → {String(d.next)})
                            </span>
                          ))}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
            {node.renderCause.changedContexts && node.renderCause.changedContexts.length > 0 && (
              <div class="detail-why-row">
                <span class="detail-why-row-label">Context changed:</span>
                <span class="detail-why-row-keys">{node.renderCause.changedContexts.join(', ')}</span>
              </div>
            )}
            {node.renderCause.primary === 'parent' && (
              <div class="detail-why-hint">
                {node.renderCause.isMemo
                  ? <>Already wrapped in <code>React.memo</code>, but received new prop references. Check if the parent passes inline objects or functions.</>
                  : <>No local changes detected — this component re-rendered because its parent did. Consider wrapping it in <code>React.memo</code>.</>
                }
              </div>
            )}
            {node.renderCause.primary === 'bailout' && node.renderCause.lastRenderedCommit != null && (
              <div class="detail-why-hint">
                Last actually rendered on commit #{node.renderCause.lastRenderedCommit}.
              </div>
            )}
          </div>
        </div>
      )}

      {hasProps && (
        <div class="detail-section">
          <div class="detail-section-title">{node.isHostElement ? 'Attributes' : 'Props'}</div>
          {propEntries.map(([key, value]) => {
            const valueType = typeof value
            const isPrimitive = value === null || valueType === 'string' || valueType === 'number' || valueType === 'boolean'
            // Host elements: editable only when source exists and value is primitive
            if (node.isHostElement && (!node.source || !isPrimitive)) {
              return (
                <div class="detail-row" key={`${node.id}-${key}`}>
                  <span class="detail-key">{key}:</span>
                  <ValueDisplay value={value} />
                </div>
              )
            }
            const isEdited = editedProps?.get(node.id)?.has(key) ?? false
            const propOrigin = node.propOrigins?.[key]
            return (
              <div class="detail-row" key={`${node.id}-${key}`}>
                <span class="detail-key">{key}:</span>
                <EditablePropValue
                  propKey={key}
                  value={value}
                  nodeId={node.id}
                  usageSource={node.isHostElement ? (node.source ?? undefined) : (node.usageSource ?? node.source ?? undefined)}
                  dynamicProps={node.dynamicProps}
                  isEdited={isEdited}
                  onPropEdit={onPropEdit}
                  onPropPersisted={onPropPersisted}
                />
                {propOrigin && (
                  <span
                    class="detail-origin-tag detail-key-clickable"
                    title={`${propOrigin.source === 'import' ? `from ${propOrigin.file}` : 'local'}: ${propOrigin.varName} (line ${propOrigin.line})`}
                    onClick={() => {
                      const fileName = propOrigin.source === 'import' && propOrigin.file
                        ? propOrigin.file
                        : node.source?.fileName
                      if (fileName) {
                        openInEditor({ fileName, lineNumber: propOrigin.line, columnNumber: 1 })
                      }
                    }}
                  >
                    {propOrigin.source === 'import'
                      ? `from ${propOrigin.file?.split('/').pop() ?? '?'}`
                      : `var ${propOrigin.varName}`}
                  </span>
                )}
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
            {section.items.map((item, i) => renderInspectorItem(item, i, section.id, node))}
          </div>
        )
      })}

      {node.locals && node.locals.length > 0 && (
        <div class="detail-section">
          <div class="detail-section-title">Locals</div>
          {node.locals.map((local, i) => {
            const canNavigate = node.source != null
            return (
              <div class="detail-row detail-local-row" key={`local-${i}`}>
                <span
                  class={`detail-key${canNavigate ? ' detail-key-clickable' : ''}`}
                  onClick={canNavigate ? () => openInEditor({
                    fileName: node.source!.fileName,
                    lineNumber: local.line,
                    columnNumber: 1,
                  }) : undefined}
                >
                  {local.name}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function renderInspectorItem(
  item: import('../../core/types').InspectorItem,
  index: number,
  sectionId: string,
  node: import('../../core/types').NormalizedNode,
  depth: number = 0,
): any {
  const canNavigate = item.lineNumber != null && node.source != null
  const sourceFile = item.sourceFile ?? node.source?.fileName

  // Custom hook / composable group with inner hooks
  if (item.innerHooks && item.innerHooks.length > 0) {
    return (
      <div class="detail-hook-group" key={`${sectionId}-${index}`} style={{ marginLeft: `${depth * 12}px` }}>
        <div class="detail-hook-group-header">
          <span
            class={`detail-key${canNavigate ? ' detail-key-clickable' : ''}`}
            onClick={canNavigate ? () => openInEditor({
              fileName: sourceFile!,
              lineNumber: item.lineNumber!,
              columnNumber: 1,
            }) : undefined}
          >
            {item.key}
          </span>
          {item.badge && <span class="hook-type-tag">[{item.badge}]</span>}
          {item.sourceFile && (
            <span class="detail-origin-tag" title={item.sourceFile}>
              from {item.sourceFile.split('/').pop()}
            </span>
          )}
        </div>
        <div class="detail-hook-group-children">
          {item.innerHooks.map((inner, j) => renderInspectorItem(inner, j, sectionId, node, depth + 1))}
        </div>
      </div>
    )
  }

  // Leaf hook / state item
  return (
    <div class="detail-row" key={`${sectionId}-${index}`} style={depth > 0 ? { marginLeft: `${depth * 12}px` } : undefined}>
      <span
        class={`detail-key${canNavigate ? ' detail-key-clickable' : ''}`}
        onClick={canNavigate ? () => openInEditor({
          fileName: sourceFile!,
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
      {item.depNames && item.depNames.length > 0 && (
        <span class="detail-deps">
          deps: [{item.depNames.join(', ')}]
        </span>
      )}
    </div>
  )
}
