/// <reference types="vite/client" />
import type { ConsoleEntry, StackFrame } from './types'
import { EVENTS } from '../shared/constants'

interface ResolvedPosition {
  file: string
  line: number
  col: number
}

type ResolvedCallback = (entries: ConsoleEntry[]) => void

/** Client-side cache: "file:line:col" -> resolved position (or null if unresolvable) */
const cache = new Map<string, ResolvedPosition | null>()

function cacheKey(file: string, line: number, col: number): string {
  return `${file}:${line}:${col}`
}

function isLibraryFrame(f: StackFrame): boolean {
  return f.isLibrary
}

function patchFrames(frames: StackFrame[]): StackFrame[] {
  return frames.map((f) => {
    if (f.isLibrary) return f
    const key = cacheKey(f.file, f.line, f.col)
    const resolved = cache.get(key)
    if (resolved) {
      return { ...f, line: resolved.line, col: resolved.col }
    }
    return f
  })
}

function patchEntry(entry: ConsoleEntry): ConsoleEntry {
  if (!entry.frames?.length) return entry
  return { ...entry, frames: patchFrames(entry.frames) }
}

export function createFrameResolver() {
  let pending: ConsoleEntry[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let callback: ResolvedCallback | null = null
  let hmrCleanup: (() => void) | null = null

  function collectUncachedFrames(entries: ConsoleEntry[]): { file: string; line: number; col: number }[] {
    const seen = new Set<string>()
    const uncached: { file: string; line: number; col: number }[] = []
    for (const entry of entries) {
      if (!entry.frames) continue
      for (const f of entry.frames) {
        if (isLibraryFrame(f)) continue
        const key = cacheKey(f.file, f.line, f.col)
        if (cache.has(key) || seen.has(key)) continue
        seen.add(key)
        uncached.push({ file: f.file, line: f.line, col: f.col })
      }
    }
    return uncached
  }

  function emitResolved(entries: ConsoleEntry[]) {
    if (callback) callback(entries.map(patchEntry))
  }

  function flush() {
    debounceTimer = null
    const entries = pending
    pending = []

    const uncached = collectUncachedFrames(entries)
    if (uncached.length === 0) {
      emitResolved(entries)
      return
    }

    // Send to server via HMR
    if (import.meta.hot) {
      // Store entries to resolve when response arrives
      pendingBatches.push(entries)
      import.meta.hot.send(EVENTS.RESOLVE_FRAMES, { frames: uncached })
    } else {
      // No HMR — emit with unresolved frames
      emitResolved(entries)
    }
  }

  const pendingBatches: ConsoleEntry[][] = []

  function handleResolved(data: { resolved: Array<{ file: string; line: number; col: number; original: { file: string; line: number; col: number } | null }> }) {
    // Merge resolved positions into cache
    for (const r of data.resolved) {
      const key = cacheKey(r.file, r.line, r.col)
      cache.set(key, r.original)
    }

    // Emit all pending batches
    const batches = pendingBatches.splice(0)
    for (const entries of batches) {
      emitResolved(entries)
    }
  }

  function init() {
    if (import.meta.hot) {
      import.meta.hot.on(EVENTS.FRAMES_RESOLVED, handleResolved)
      hmrCleanup = () => {
        // Vite HMR doesn't have an off() — cleanup handled by module disposal
      }
    }
  }

  init()

  return {
    resolve(entries: ConsoleEntry[]) {
      // Check if all frames are already cached
      const uncached = collectUncachedFrames(entries)
      if (uncached.length === 0) {
        emitResolved(entries)
        return
      }

      pending.push(...entries)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, 100)
    },

    onResolved(cb: ResolvedCallback) {
      callback = cb
    },

    destroy() {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (hmrCleanup) hmrCleanup()
      pending = []
      pendingBatches.length = 0
    },
  }
}
