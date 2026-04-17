import { h } from 'preact'
import { useMemo, useRef, useEffect } from 'preact/hooks'
import type { ConsoleEntry } from '../types'
import { formatEntryForCopy, formatAllEntriesForCopy } from '../console-format'
import { Tooltip } from './Tooltip'

interface ConsolePaneProps {
  entries: ConsoleEntry[]
  filters: { errors: boolean; warnings: boolean; logs: boolean }
  onFilterChange: (filters: { errors: boolean; warnings: boolean; logs: boolean }) => void
  onClear: () => void
}

function formatTimestamp(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)}ms`
  return `+${(ms / 1000).toFixed(1)}s`
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}

export function ConsolePane({ entries, filters, onFilterChange, onClear }: ConsolePaneProps) {
  const entriesRef = useRef<HTMLDivElement>(null)

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (e.type === 'error' && !filters.errors) return false
      if (e.type === 'warning' && !filters.warnings) return false
      if (e.type === 'log' && !filters.logs) return false
      return true
    })
  }, [entries, filters])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    const el = entriesRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (isAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [filteredEntries.length])

  return (
    <div class="console-pane">
      <div class="console-toolbar">
        <button
          class={`console-filter-btn${filters.errors ? ' filter-active' : ''}`}
          onClick={() => onFilterChange({ ...filters, errors: !filters.errors })}
        >
          Errors
        </button>
        <button
          class={`console-filter-btn${filters.warnings ? ' filter-active' : ''}`}
          onClick={() => onFilterChange({ ...filters, warnings: !filters.warnings })}
        >
          Warnings
        </button>
        <button
          class={`console-filter-btn${filters.logs ? ' filter-active' : ''}`}
          onClick={() => onFilterChange({ ...filters, logs: !filters.logs })}
        >
          Logs
        </button>
        <div class="console-toolbar-spacer" />
        <button class="console-action-btn" onClick={onClear}>
          Clear
        </button>
        <button
          class="console-action-btn"
          onClick={() => copyToClipboard(formatAllEntriesForCopy(filteredEntries))}
        >
          Copy All
        </button>
      </div>

      <div class="console-entries" ref={entriesRef}>
        {filteredEntries.length === 0 ? (
          <div class="console-empty">No console entries captured</div>
        ) : (
          filteredEntries.map((entry) => (
            <div class={`console-entry ${entry.type}`} key={entry.id}>
              {entry.type === 'error' ? (
                <svg class="console-entry-icon error" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4zm.75 7.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
                </svg>
              ) : entry.type === 'warning' ? (
                <svg class="console-entry-icon warning" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8.22 1.754a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754zm-.75 3.746a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3zm.75 6.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
                </svg>
              ) : (
                <svg class="console-entry-icon log" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 4a.75.75 0 0 1 1.5 0v.5a.75.75 0 0 1-1.5 0V5zm.75 7.25a.75.75 0 0 1-.75-.75V7.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-.75.75z" />
                </svg>
              )}
              <span class="console-entry-time">{formatTimestamp(entry.timestamp)}</span>
              <div class="console-entry-content">
                <div class="console-entry-message">{entry.message}</div>
                {entry.stack && <div class="console-entry-stack">{entry.stack}</div>}
              </div>
              <Tooltip text="Copy for AI">
              <button
                class="console-entry-copy"
                onClick={() => copyToClipboard(formatEntryForCopy(entry))}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              </Tooltip>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
