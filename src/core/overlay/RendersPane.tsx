import { h } from 'preact'
import { useMemo, useState, useCallback } from 'preact/hooks'
import type {
  NormalizedNode,
  CommitRecord,
  RenderCauseKind,
} from '../types'

const CAUSE_KINDS: RenderCauseKind[] = ['mount', 'state', 'context', 'props', 'parent']

interface RendersPaneProps {
  tree: NormalizedNode[]
  history: CommitRecord[]
  recording: boolean
  pinnedPersistentId: number | null
  onToggleRecording: () => void
  onClear: () => void
  onJumpToComponent: (node: NormalizedNode) => void
  onPin: (persistentId: number | null) => void
}

function findNodeByPersistentId(nodes: NormalizedNode[], pid: number): NormalizedNode | null {
  for (const node of nodes) {
    if (node.persistentId === pid) return node
    const found = findNodeByPersistentId(node.children, pid)
    if (found) return found
  }
  return null
}

export function RendersPane({
  tree,
  history,
  recording,
  pinnedPersistentId,
  onToggleRecording,
  onClear,
  onJumpToComponent,
  onPin,
}: RendersPaneProps) {
  const [enabledCauses, setEnabledCauses] = useState<Set<RenderCauseKind>>(
    () => new Set(CAUSE_KINDS),
  )
  const [search, setSearch] = useState('')
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null)
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set())

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase()
    return history
      .map((commit) => {
        const components = commit.components.filter((c) => {
          if (!enabledCauses.has(c.cause as RenderCauseKind)) return false
          if (pinnedPersistentId !== null && c.persistentId !== pinnedPersistentId) return false
          if (q) {
            const hay = [
              c.name,
              ...(c.changedProps ?? []),
              ...(c.changedContexts ?? []),
              ...(c.changedHooks?.map((h) => h.varName ?? '') ?? []),
            ].join(' ').toLowerCase()
            if (!hay.includes(q)) return false
          }
          return true
        })
        return { ...commit, components }
      })
      .filter((c) => c.components.length > 0)
  }, [history, enabledCauses, search, pinnedPersistentId])

  const selectedCommit = useMemo(() => {
    if (selectedCommitIndex === null) return filteredHistory[filteredHistory.length - 1] ?? null
    return filteredHistory.find((c) => c.commitIndex === selectedCommitIndex) ?? null
  }, [filteredHistory, selectedCommitIndex])

  const timelineMax = useMemo(() => {
    return Math.max(1, ...filteredHistory.map((c) => c.components.length))
  }, [filteredHistory])

  const toggleCause = useCallback((cause: RenderCauseKind) => {
    setEnabledCauses((prev) => {
      const next = new Set(prev)
      if (next.has(cause)) next.delete(cause)
      else next.add(cause)
      return next
    })
  }, [])

  const toggleExpand = useCallback((key: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const pinnedName = useMemo(() => {
    if (pinnedPersistentId === null) return null
    const node = findNodeByPersistentId(tree, pinnedPersistentId)
    return node?.name ?? `#${pinnedPersistentId}`
  }, [tree, pinnedPersistentId])

  return (
    <div class="renders-pane">
      <div class="renders-toolbar">
        <button
          class={`renders-btn${recording ? ' is-recording' : ''}`}
          onClick={onToggleRecording}
          title={recording ? 'Pause recording' : 'Resume recording'}
        >
          <span class="renders-btn-dot" />
          {recording ? 'Recording' : 'Paused'}
        </button>
        <button class="renders-btn" onClick={onClear} title="Clear render history">
          Clear
        </button>
        <div class="renders-filters">
          {CAUSE_KINDS.map((cause) => (
            <button
              key={cause}
              class={`renders-chip cause-${cause}${enabledCauses.has(cause) ? ' is-on' : ''}`}
              onClick={() => toggleCause(cause)}
            >
              {cause}
            </button>
          ))}
        </div>
        <input
          class="renders-search"
          placeholder="Search component, prop, hook, context…"
          value={search}
          onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
        />
        {pinnedName && (
          <button class="renders-pin" onClick={() => onPin(null)}>
            Pinned: {pinnedName} ×
          </button>
        )}
      </div>

      {filteredHistory.length === 0 ? (
        <div class="renders-empty">
          {history.length === 0
            ? recording
              ? 'Waiting for commits…'
              : 'Recording paused.'
            : 'No commits match the current filters.'}
        </div>
      ) : (
        <>
          <div class="renders-timeline">
            {filteredHistory.slice(-120).map((commit) => {
              const height = Math.max(4, (commit.components.length / timelineMax) * 40)
              const primary = commit.components[0]?.cause ?? 'parent'
              const isSelected = selectedCommit?.commitIndex === commit.commitIndex
              return (
                <div
                  key={commit.commitIndex}
                  class={`renders-bar cause-${primary}${isSelected ? ' is-selected' : ''}`}
                  style={{ height: `${height}px` }}
                  title={`Commit ${commit.commitIndex}: ${commit.components.length} rerenders`}
                  onClick={() => setSelectedCommitIndex(commit.commitIndex)}
                />
              )
            })}
          </div>
          <div class="renders-detail">
            {selectedCommit ? (
              <>
                <div class="renders-detail-header">
                  Commit #{selectedCommit.commitIndex} · {selectedCommit.components.length}{' '}
                  rerender{selectedCommit.components.length === 1 ? '' : 's'}
                  <span class="renders-detail-time">
                    {new Date(selectedCommit.timestampMs).toLocaleTimeString()}
                  </span>
                </div>
                <ul class="renders-entry-list">
                  {selectedCommit.components.map((entry) => {
                    const key = `${selectedCommit.commitIndex}_${entry.persistentId}`
                    const expanded = expandedEntries.has(key)
                    return (
                      <li key={key} class="renders-entry">
                        <div class="renders-entry-row">
                          <span class={`renders-pip cause-${entry.cause}`} />
                          <button
                            class="renders-entry-name"
                            onClick={() => {
                              const node = findNodeByPersistentId(tree, entry.persistentId)
                              if (node) onJumpToComponent(node)
                            }}
                          >
                            {entry.name}
                          </button>
                          <span class="renders-entry-cause">{entry.cause}</span>
                          {entry.changedProps && entry.changedProps.length > 0 && (
                            <span class="renders-entry-keys">
                              props: {entry.changedProps.join(', ')}
                            </span>
                          )}
                          {entry.changedHooks && entry.changedHooks.length > 0 && (
                            <span class="renders-entry-keys">
                              state: {entry.changedHooks.map((h) => h.varName ? `${h.varName} (${h.hookName})` : `${h.hookName} #${h.index}`).join(', ')}
                            </span>
                          )}
                          {entry.changedContexts && entry.changedContexts.length > 0 && (
                            <span class="renders-entry-keys">
                              ctx: {entry.changedContexts.join(', ')}
                            </span>
                          )}
                          <button
                            class="renders-entry-pin"
                            onClick={() => onPin(entry.persistentId)}
                            title="Pin to this component"
                          >
                            📌
                          </button>
                          {(entry.previousValues || entry.previousHookValues) && (
                            <button class="renders-entry-expand" onClick={() => toggleExpand(key)}>
                              {expanded ? '▼' : '▶'}
                            </button>
                          )}
                        </div>
                        {expanded && (entry.previousValues || entry.previousHookValues) && (
                          <div class="renders-entry-diff">
                            {entry.previousValues && entry.nextValues && Object.keys(entry.previousValues).map((k) => (
                              <div key={k} class="renders-entry-diff-row">
                                <span class="renders-entry-diff-key">{k}</span>
                                <span class="renders-entry-diff-prev">{entry.previousValues![k]}</span>
                                <span class="renders-entry-diff-arrow">→</span>
                                <span class="renders-entry-diff-next">{entry.nextValues![k]}</span>
                              </div>
                            ))}
                            {entry.previousHookValues && entry.nextHookValues && Object.keys(entry.previousHookValues).map((k) => (
                              <div key={k} class="renders-entry-diff-row">
                                <span class="renders-entry-diff-key">{k}</span>
                                <span class="renders-entry-diff-prev">{entry.previousHookValues![k]}</span>
                                <span class="renders-entry-diff-arrow">→</span>
                                <span class="renders-entry-diff-next">{entry.nextHookValues![k]}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <div class="renders-empty">Select a commit in the timeline.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
