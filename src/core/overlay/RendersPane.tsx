import { h } from 'preact'
import { useMemo, useState, useCallback, useRef, useEffect } from 'preact/hooks'
import { useT } from './i18n'
import type {
  NormalizedNode,
  CommitRecord,
  RenderCauseKind,
} from '../types'
import { safeStringify, prettyStringify } from '../../shared/preview-value'
import { ValueDiffModal } from './ValueDiffModal'

const CAUSE_KINDS: RenderCauseKind[] = ['mount', 'state', 'context', 'props', 'parent']

const INLINE_THRESHOLD = 200

function DiffValue({ value, fullValue, className, onInspect }: {
  value: string
  fullValue?: string
  className: string
  onInspect?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isComplex = value.length > 40 || value.includes('{') || value.includes('[')
  const hasFull = fullValue != null && fullValue.length > INLINE_THRESHOLD
  return (
    <span
      class={`${className}${expanded ? ' is-expanded' : ''}${isComplex ? ' is-expandable' : ''}`}
      onClick={isComplex ? (e) => {
        e.stopPropagation()
        if (hasFull && onInspect) {
          onInspect()
        } else {
          setExpanded(!expanded)
        }
      } : undefined}
      title={isComplex && !expanded ? value : undefined}
    >
      {expanded && fullValue && !hasFull ? fullValue : value}
    </span>
  )
}

interface RendersPaneProps {
  tree: NormalizedNode[]
  history: CommitRecord[]
  recording: boolean
  pinnedPersistentId: number | null
  focusCommitIndex?: number | null
  onToggleRecording: () => void
  onClear: () => void
  onJumpToComponent: (node: NormalizedNode) => void
  onPin: (persistentId: number | null) => void
  onFocusCommitConsumed?: () => void
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
  focusCommitIndex,
  onToggleRecording,
  onClear,
  onJumpToComponent,
  onPin,
  onFocusCommitConsumed,
}: RendersPaneProps) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const [enabledCauses, setEnabledCauses] = useState<Set<RenderCauseKind>>(
    () => new Set(CAUSE_KINDS),
  )
  const [search, setSearch] = useState('')
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null)
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set())
  const [inspectModal, setInspectModal] = useState<{ label: string; prev: string; next: string } | null>(null)
  const { t, plural: pluralFn } = useT()

  useEffect(() => {
    if (focusCommitIndex != null) {
      setSelectedCommitIndex(focusCommitIndex)
      onFocusCommitConsumed?.()
      requestAnimationFrame(() => {
        const el = timelineRef.current?.querySelector(`[data-commit="${focusCommitIndex}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      })
    }
  }, [focusCommitIndex])

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
          title={recording ? t('renders.pauseRecording') : t('renders.resumeRecording')}
        >
          <span class="renders-btn-dot" />
          {recording ? t('renders.recording') : t('renders.paused')}
        </button>
        <button class="renders-btn" onClick={onClear} title={t('renders.clearHistory')}>
          {t('renders.clear')}
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
          placeholder={t('renders.searchPlaceholder')}
          value={search}
          onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
        />
        {pinnedName && (
          <button class="renders-pin" onClick={() => onPin(null)}>
            {t('renders.pinned', { name: pinnedName! })} ×
          </button>
        )}
      </div>

      {filteredHistory.length === 0 ? (
        <div class="renders-empty">
          {history.length === 0
            ? recording
              ? t('renders.emptyWaiting')
              : t('renders.emptyPaused')
            : t('renders.emptyNoMatch')}
        </div>
      ) : (
        <>
          <div class="renders-timeline" ref={timelineRef}>
            {filteredHistory.slice(-120).map((commit) => {
              const height = Math.max(4, (commit.components.length / timelineMax) * 40)
              const primary = commit.components[0]?.cause ?? 'parent'
              const isSelected = selectedCommit?.commitIndex === commit.commitIndex
              return (
                <div
                  key={commit.commitIndex}
                  data-commit={commit.commitIndex}
                  class={`renders-bar cause-${primary}${isSelected ? ' is-selected' : ''}`}
                  style={{ height: `${height}px` }}
                  title={t('renders.commitTooltip', { index: commit.commitIndex, count: commit.components.length })}
                  onClick={() => setSelectedCommitIndex(commit.commitIndex)}
                />
              )
            })}
          </div>
          <div class="renders-detail">
            {selectedCommit ? (
              <>
                <div class="renders-detail-header">
                  {t('renders.commitHeader', { index: selectedCommit.commitIndex })} · {selectedCommit.components.length}{' '}
                  {pluralFn(selectedCommit.components.length, [t('renders.rerender'), t('renders.rerenders')])}
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
                          {entry.wastedRender && (
                            <span class="renders-entry-wasted">{t('renders.wasted')}</span>
                          )}
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
                            title={t('renders.pinComponent')}
                          >
                            📌
                          </button>
                          {(entry.previousValues || entry.previousHookValues || entry.effectChanges) && (
                            <button class="renders-entry-expand" onClick={() => toggleExpand(key)}>
                              {expanded ? '▼' : '▶'}
                            </button>
                          )}
                        </div>
                        {expanded && (entry.previousValues || entry.previousHookValues || entry.effectChanges) && (
                          <div class="renders-entry-diff">
                            {entry.previousValues && entry.nextValues && Object.keys(entry.previousValues).map((k) => {
                              const fullPrev = entry.fullPreviousValues?.[k]
                              const fullNext = entry.fullNextValues?.[k]
                              return (
                                <div key={k} class="renders-entry-diff-row">
                                  <span class="renders-entry-diff-key">{k}</span>
                                  <DiffValue className="renders-entry-diff-prev" value={entry.previousValues![k]} fullValue={fullPrev} onInspect={() => setInspectModal({ label: k, prev: fullPrev ?? entry.previousValues![k], next: fullNext ?? entry.nextValues![k] })} />
                                  <span class="renders-entry-diff-arrow">→</span>
                                  <DiffValue className="renders-entry-diff-next" value={entry.nextValues![k]} fullValue={fullNext} onInspect={() => setInspectModal({ label: k, prev: fullPrev ?? entry.previousValues![k], next: fullNext ?? entry.nextValues![k] })} />
                                </div>
                              )
                            })}
                            {entry.previousHookValues && entry.nextHookValues && Object.keys(entry.previousHookValues).map((k) => {
                              const fullPrev = entry.fullPreviousHookValues?.[k]
                              const fullNext = entry.fullNextHookValues?.[k]
                              return (
                                <div key={k} class="renders-entry-diff-row">
                                  <span class="renders-entry-diff-key">{k}</span>
                                  <DiffValue className="renders-entry-diff-prev" value={entry.previousHookValues![k]} fullValue={fullPrev} onInspect={() => setInspectModal({ label: k, prev: fullPrev ?? entry.previousHookValues![k], next: fullNext ?? entry.nextHookValues![k] })} />
                                  <span class="renders-entry-diff-arrow">→</span>
                                  <DiffValue className="renders-entry-diff-next" value={entry.nextHookValues![k]} fullValue={fullNext} onInspect={() => setInspectModal({ label: k, prev: fullPrev ?? entry.previousHookValues![k], next: fullNext ?? entry.nextHookValues![k] })} />
                                </div>
                              )
                            })}
                            {entry.effectChanges && entry.effectChanges.length > 0 && (
                              <div class="renders-entry-effects">
                                <div class="renders-entry-effects-title">{t('renders.effectDepsChanged')}</div>
                                {entry.effectChanges.map((ec, ecIdx) => (
                                  <div key={ecIdx} class="renders-entry-effect">
                                    <span class="renders-entry-effect-name">
                                      {ec.varName ?? ec.hookName}
                                    </span>
                                    {ec.changedDeps.map((dep, depIdx) => {
                                      const prevStr = safeStringify(dep.prev)
                                      const nextStr = safeStringify(dep.next)
                                      const fullPrev = prettyStringify(dep.prev)
                                      const fullNext = prettyStringify(dep.next)
                                      return (
                                        <div key={depIdx} class="renders-entry-diff-row">
                                          <span class="renders-entry-diff-key">{dep.name}</span>
                                          <DiffValue className="renders-entry-diff-prev" value={prevStr} fullValue={fullPrev} onInspect={() => setInspectModal({ label: dep.name, prev: fullPrev, next: fullNext })} />
                                          <span class="renders-entry-diff-arrow">→</span>
                                          <DiffValue className="renders-entry-diff-next" value={nextStr} fullValue={fullNext} onInspect={() => setInspectModal({ label: dep.name, prev: fullPrev, next: fullNext })} />
                                        </div>
                                      )
                                    })}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <div class="renders-empty">{t('renders.selectCommit')}</div>
            )}
          </div>
        </>
      )}
      {inspectModal && (
        <ValueDiffModal
          label={inspectModal.label}
          prev={inspectModal.prev}
          next={inspectModal.next}
          onClose={() => setInspectModal(null)}
        />
      )}
    </div>
  )
}
