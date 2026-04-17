import type { CommitRecord, CommitComponentEntry } from '../types'
import { devtoolsState } from '../overlay/state-store'
import { RENDER_HISTORY_DEFAULTS } from '../../shared/constants'

export function stripValues(commit: CommitRecord): CommitRecord {
  return {
    ...commit,
    components: commit.components.map((c) => {
      const { previousValues: _p, nextValues: _n, ...rest } = c
      return rest
    }),
  }
}

export async function getRenderHistoryHandler(
  params: Record<string, unknown>,
): Promise<{ commits: CommitRecord[]; recording: boolean }> {
  const limit = typeof params.limit === 'number' ? params.limit : undefined
  const includeValues = params.includeValues !== false // default true
  let commits = devtoolsState.renderHistory.slice()
  if (limit && commits.length > limit) {
    commits = commits.slice(-limit)
  }
  if (!includeValues) commits = commits.map(stripValues)
  return { commits, recording: devtoolsState.renderHistoryRecording }
}

export async function getRenderCausesHandler(
  params: Record<string, unknown>,
): Promise<{ commits: CommitRecord[] }> {
  const componentName = String(params.componentName ?? '')
  const limit = typeof params.limit === 'number' ? params.limit : undefined
  const includeValues = params.includeValues !== false

  let commits: CommitRecord[] = []
  for (const commit of devtoolsState.renderHistory) {
    const matching = commit.components.filter((c) => c.name === componentName)
    if (matching.length > 0) {
      commits.push({ ...commit, components: matching })
    }
  }
  if (limit && commits.length > limit) commits = commits.slice(-limit)
  if (!includeValues) commits = commits.map(stripValues)
  return { commits }
}

export async function getHotComponentsHandler(
  params: Record<string, unknown>,
): Promise<{ components: HotComponent[] }> {
  const windowMs = typeof params.windowMs === 'number' ? params.windowMs : 5000
  const limit = typeof params.limit === 'number' ? params.limit : 10
  const cutoff = Date.now() - windowMs

  interface Accumulator {
    persistentId: number
    name: string
    source: CommitComponentEntry['source']
    renderCount: number
    lastCause: string
    lastCommit: number
  }
  const agg = new Map<number, Accumulator>()

  for (const commit of devtoolsState.renderHistory) {
    if (commit.timestampMs < cutoff) continue
    for (const entry of commit.components) {
      const existing = agg.get(entry.persistentId)
      if (existing) {
        existing.renderCount++
        if (commit.commitIndex >= existing.lastCommit) {
          existing.lastCause = entry.cause
          existing.lastCommit = commit.commitIndex
        }
      } else {
        agg.set(entry.persistentId, {
          persistentId: entry.persistentId,
          name: entry.name,
          source: entry.source,
          renderCount: 1,
          lastCause: entry.cause,
          lastCommit: commit.commitIndex,
        })
      }
    }
  }

  const sorted = Array.from(agg.values()).sort((a, b) => b.renderCount - a.renderCount)
  return { components: sorted.slice(0, limit) }
}

interface HotComponent {
  persistentId: number
  name: string
  source: CommitComponentEntry['source']
  renderCount: number
  lastCause: string
  lastCommit: number
}

export async function clearRenderHistoryHandler(
  _params: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  devtoolsState.onClearRenderHistory?.()
  return { ok: true }
}

export async function setRenderHistoryRecordingHandler(
  params: Record<string, unknown>,
): Promise<{ ok: boolean; recording: boolean }> {
  const enabled = !!params.enabled
  devtoolsState.onSetRenderHistoryRecording?.(enabled)
  return { ok: true, recording: enabled }
}

