import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { NormalizedNode, SourceLocation } from '../types'
import { openInEditor } from '../communication'

function formatPath(source: SourceLocation): string {
  return `${source.fileName.replace(/^.*\/src\//, 'src/')}:${source.lineNumber}`
}

function copyPath(source: SourceLocation, e: Event) {
  e.stopPropagation()
  navigator.clipboard.writeText(formatPath(source))
}

interface DetailPanelProps {
  node: NormalizedNode | null
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

export function DetailPanel({ node }: DetailPanelProps) {
  if (!node) {
    return <div class="detail-pane-empty">Select a component to inspect</div>
  }

  const propEntries = Object.entries(node.props)
  const hasProps = propEntries.length > 0
  const hasHooks = node.hooks.length > 0
  const hasState = node.state !== null && node.state !== undefined

  const showUsageSource = node.usageSource && node.source &&
    node.usageSource.fileName !== node.source.fileName

  return (
    <div>
      <div class="detail-section">
        <div class="detail-component-name">{node.name}</div>
        {node.source && (
          <>
            {showUsageSource && <div class="source-label">Source</div>}
            <div class="source-link-row">
              <div class="source-link" onClick={() => openInEditor(node.source!)}>
                {formatPath(node.source)}
              </div>
              <button class="source-copy-btn" onClick={(e) => copyPath(node.source!, e)} title="Copy path">
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
          <div class="detail-section-title">Props</div>
          {propEntries.map(([key, value]) => (
            <div class="detail-row" key={key}>
              <span class="detail-key">{key}:</span>
              <ValueDisplay value={value} />
            </div>
          ))}
        </div>
      )}

      {hasState && (
        <div class="detail-section">
          <div class="detail-section-title">State</div>
          {typeof node.state === 'object' && node.state !== null ? (
            Object.entries(node.state as Record<string, unknown>).map(([key, value]) => (
              <div class="detail-row" key={key}>
                <span class="detail-key">{key}:</span>
                <ValueDisplay value={value} />
              </div>
            ))
          ) : (
            <div class="detail-row">
              <ValueDisplay value={node.state} />
            </div>
          )}
        </div>
      )}

      {hasHooks && (
        <div class="detail-section">
          <div class="detail-section-title">Hooks</div>
          {node.hooks.map((hook, i) => {
            const label = hook.varName ?? hook.name
            const canNavigate = hook.lineNumber != null && node.source != null

            return (
              <div class="detail-row" key={i}>
                <span
                  class={`detail-key${canNavigate ? ' detail-key-clickable' : ''}`}
                  onClick={canNavigate ? () => openInEditor({
                    fileName: node.source!.fileName,
                    lineNumber: hook.lineNumber!,
                    columnNumber: 1,
                  }) : undefined}
                >
                  {label}:
                </span>
                <ValueDisplay value={hook.value} />
                {hook.varName && <span class="hook-type-tag">[{hook.name}]</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
