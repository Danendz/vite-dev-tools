import type { ViteDevServer } from 'vite'
import { SourceMapConsumer } from 'source-map-js'
import type { RawFrame, ResolvedFrame } from './types'

/** Server-side cache: "file:line:col" -> resolved original position */
const cache = new Map<string, { file: string; line: number; col: number } | null>()

function cacheKey(file: string, line: number, col: number): string {
  return `${file}:${line}:${col}`
}

function isLibraryPath(file: string): boolean {
  return file.includes('node_modules/') ||
    file.includes('.vite/deps/') ||
    file.includes('dist/overlay') ||
    file.includes('/@fs/')
}

async function getSourceMap(server: ViteDevServer, file: string): Promise<any | null> {
  const moduleGraph = server.environments?.client?.moduleGraph ?? (server as any).moduleGraph
  if (!moduleGraph) return null

  // Try cached module first
  const mod = await moduleGraph.getModuleByUrl(file)
  if (mod?.transformResult?.map) {
    const map = mod.transformResult.map
    // Skip empty mappings
    if (typeof map === 'object' && 'mappings' in map && map.mappings === '') return null
    return map
  }

  // Fallback: trigger transform (re-caches the module)
  try {
    const transformRequest = server.environments?.client?.transformRequest
      ?? (server as any).transformRequest?.bind(server)
    if (!transformRequest) return null

    const result = await transformRequest(file)
    if (result?.map && typeof result.map === 'object' && 'mappings' in result.map && result.map.mappings !== '') {
      return result.map
    }
  } catch {
    // Module may not exist or failed to transform
  }

  return null
}

export async function resolveFrames(server: ViteDevServer, frames: RawFrame[]): Promise<ResolvedFrame[]> {
  const results: ResolvedFrame[] = []

  // Group frames by file to avoid fetching the same source map multiple times
  const byFile = new Map<string, { frame: RawFrame; index: number }[]>()
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const key = cacheKey(frame.file, frame.line, frame.col)

    // Check cache first
    if (cache.has(key)) {
      results[i] = { ...frame, original: cache.get(key)! }
      continue
    }

    // Skip library frames
    if (isLibraryPath(frame.file)) {
      results[i] = { ...frame, original: null }
      cache.set(key, null)
      continue
    }

    const group = byFile.get(frame.file) ?? []
    group.push({ frame, index: i })
    byFile.set(frame.file, group)
  }

  // Resolve each file's source map
  for (const [file, entries] of byFile) {
    const map = await getSourceMap(server, file)

    if (!map) {
      // No source map — cache as null and return original positions
      for (const { frame, index } of entries) {
        cache.set(cacheKey(frame.file, frame.line, frame.col), null)
        results[index] = { ...frame, original: null }
      }
      continue
    }

    let consumer: SourceMapConsumer
    try {
      consumer = new SourceMapConsumer(map as any)
    } catch {
      for (const { frame, index } of entries) {
        cache.set(cacheKey(frame.file, frame.line, frame.col), null)
        results[index] = { ...frame, original: null }
      }
      continue
    }

    for (const { frame, index } of entries) {
      const key = cacheKey(frame.file, frame.line, frame.col)
      try {
        const pos = consumer.originalPositionFor({ line: frame.line, column: frame.col - 1 })
        if (pos.source && pos.line != null) {
          const resolved = { file: pos.source, line: pos.line, col: (pos.column ?? 0) + 1 }
          cache.set(key, resolved)
          results[index] = { ...frame, original: resolved }
        } else {
          cache.set(key, null)
          results[index] = { ...frame, original: null }
        }
      } catch {
        cache.set(key, null)
        results[index] = { ...frame, original: null }
      }
    }
  }

  return results
}
