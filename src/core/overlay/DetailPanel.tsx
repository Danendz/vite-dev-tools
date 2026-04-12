import { h } from 'preact'
import type { NormalizedNode } from '../types'
import { openInEditor } from '../communication'

interface DetailPanelProps {
  node: NormalizedNode | null
}

function formatValue(value: unknown): { text: string; className: string } {
  if (value === null) return { text: 'null', className: 'detail-value' }
  if (value === undefined) return { text: 'undefined', className: 'detail-value' }

  switch (typeof value) {
    case 'string':
      return { text: `"${value}"`, className: 'detail-value string' }
    case 'number':
      return { text: String(value), className: 'detail-value number' }
    case 'boolean':
      return { text: String(value), className: 'detail-value boolean' }
    case 'object':
      try {
        const str = JSON.stringify(value, null, 2)
        return { text: str.length > 100 ? str.slice(0, 100) + '...' : str, className: 'detail-value' }
      } catch {
        return { text: '[Object]', className: 'detail-value' }
      }
    default:
      return { text: String(value), className: 'detail-value' }
  }
}

export function DetailPanel({ node }: DetailPanelProps) {
  if (!node) {
    return <div class="detail-pane-empty">Select a component to inspect</div>
  }

  const propEntries = Object.entries(node.props)
  const hasProps = propEntries.length > 0
  const hasHooks = node.hooks.length > 0
  const hasState = node.state !== null && node.state !== undefined

  return (
    <div>
      <div class="detail-section">
        <div class="detail-component-name">{node.name}</div>
        {node.source && (
          <div class="source-info">
            {node.source.fileName.replace(/^.*\/src\//, 'src/')}:{node.source.lineNumber}
          </div>
        )}
        {node.source && (
          <button class="open-editor-btn" onClick={() => openInEditor(node.source!)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15,3 21,3 21,9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open in Editor
          </button>
        )}
      </div>

      {hasProps && (
        <div class="detail-section">
          <div class="detail-section-title">Props</div>
          {propEntries.map(([key, value]) => {
            const formatted = formatValue(value)
            return (
              <div class="detail-row" key={key}>
                <span class="detail-key">{key}:</span>
                <span class={formatted.className}>{formatted.text}</span>
              </div>
            )
          })}
        </div>
      )}

      {hasState && (
        <div class="detail-section">
          <div class="detail-section-title">State</div>
          {typeof node.state === 'object' && node.state !== null ? (
            Object.entries(node.state as Record<string, unknown>).map(([key, value]) => {
              const formatted = formatValue(value)
              return (
                <div class="detail-row" key={key}>
                  <span class="detail-key">{key}:</span>
                  <span class={formatted.className}>{formatted.text}</span>
                </div>
              )
            })
          ) : (
            <div class="detail-row">
              <span class={formatValue(node.state).className}>{formatValue(node.state).text}</span>
            </div>
          )}
        </div>
      )}

      {hasHooks && (
        <div class="detail-section">
          <div class="detail-section-title">Hooks</div>
          {node.hooks.map((hook, i) => {
            const formatted = formatValue(hook.value)
            return (
              <div class="detail-row" key={i}>
                <span class="detail-key">{hook.name}:</span>
                <span class={formatted.className}>{formatted.text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
