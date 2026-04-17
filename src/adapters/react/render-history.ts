import type { CommitRecord } from '../../core/types'
import { RENDER_HISTORY_DEFAULTS } from '../../shared/constants'

export interface RenderHistoryOptions {
  maxCommits?: number
  maxComponentsPerCommit?: number
}

export interface RenderHistory {
  /** Allocate and return the next commit index (monotonic, does not reset on clear). */
  advanceCommitIndex(): number
  /** Next commit index that will be allocated — observation only. */
  nextCommitIndex(): number
  /** Record a commit into the ring buffer. No-op when recording is disabled. */
  record(commit: CommitRecord): void
  /** Read the buffered commits (oldest → newest). */
  getCommits(): CommitRecord[]
  /** Empty the buffer. Does not reset the monotonic counter. */
  clear(): void
  /** Toggle whether future `record()` calls persist commits. */
  setRecording(enabled: boolean): void
  /** Whether recording is currently enabled. */
  isRecording(): boolean
}

let singleton: RenderHistory | null = null

export function getRenderHistory(): RenderHistory {
  if (!singleton) singleton = createRenderHistory()
  return singleton
}

export function createRenderHistory(options: RenderHistoryOptions = {}): RenderHistory {
  const maxCommits = options.maxCommits ?? RENDER_HISTORY_DEFAULTS.MAX_COMMITS
  const maxComponentsPerCommit =
    options.maxComponentsPerCommit ?? RENDER_HISTORY_DEFAULTS.MAX_COMPONENTS_PER_COMMIT

  const ring: CommitRecord[] = []
  let counter = 0
  let recording = true

  return {
    advanceCommitIndex() {
      return counter++
    },
    nextCommitIndex() {
      return counter
    },
    record(commit) {
      if (!recording) return
      const bounded: CommitRecord =
        commit.components.length > maxComponentsPerCommit
          ? { ...commit, components: commit.components.slice(0, maxComponentsPerCommit) }
          : commit
      ring.push(bounded)
      if (ring.length > maxCommits) ring.shift()
    },
    getCommits() {
      return ring.slice()
    },
    clear() {
      ring.length = 0
    },
    setRecording(enabled) {
      recording = enabled
    },
    isRecording() {
      return recording
    },
  }
}
