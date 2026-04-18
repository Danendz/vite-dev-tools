import type { CommitRecord, CommitComponentEntry } from '../types'
import { devtoolsState } from '../overlay/state-store'
import { RENDER_HISTORY_DEFAULTS } from '../../shared/constants'

export function stripValues(commit: CommitRecord): CommitRecord {
  return {
    ...commit,
    components: commit.components.map((c) => {
      const { previousValues: _p, nextValues: _n, previousHookValues: _ph, nextHookValues: _nh, ...rest } = c
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
  const fuzzy = params.fuzzy === true
  const limit = typeof params.limit === 'number' ? params.limit : undefined
  const includeValues = params.includeValues !== false

  const needle = fuzzy ? componentName.toLowerCase() : componentName
  let commits: CommitRecord[] = []
  for (const commit of devtoolsState.renderHistory) {
    const matching = commit.components.filter((c) =>
      fuzzy ? c.name.toLowerCase().includes(needle) : c.name === componentName,
    )
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
    wastedRenders: number
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
        if (entry.wastedRender) existing.wastedRenders++
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
          wastedRenders: entry.wastedRender ? 1 : 0,
          lastCause: entry.cause,
          lastCommit: commit.commitIndex,
        })
      }
    }
  }

  const MIN_RENDERS = 5
  const MEMO_THRESHOLD = 0.8

  const sorted = Array.from(agg.values())
    .sort((a, b) => b.renderCount - a.renderCount)
    .slice(0, limit)

  const components: HotComponent[] = sorted.map(a => {
    const wastedPercentage = a.renderCount > 0 ? a.wastedRenders / a.renderCount : 0
    return {
      persistentId: a.persistentId,
      name: a.name,
      source: a.source,
      renderCount: a.renderCount,
      wastedRenders: a.wastedRenders,
      wastedPercentage: Math.round(wastedPercentage * 100) / 100,
      memoSuggested: a.renderCount >= MIN_RENDERS && wastedPercentage >= MEMO_THRESHOLD,
      lastCause: a.lastCause,
      lastCommit: a.lastCommit,
    }
  })

  return { components }
}

interface HotComponent {
  persistentId: number
  name: string
  source: CommitComponentEntry['source']
  renderCount: number
  wastedRenders: number
  wastedPercentage: number
  memoSuggested: boolean
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

