import type { NormalizedNode, ConsoleEntry } from '../../types'
import { findNodeById } from '../tree-utils'
import { devtoolsState } from '../../overlay/state-store'

export interface ActionResponse {
  success: boolean
  settled: boolean
  matchCount: number
  consoleErrors: ConsoleEntry[]
  componentState?: {
    id: string
    name: string
    props: Record<string, unknown>
    sections: NormalizedNode['sections']
  }
}

/**
 * Start capturing console errors/warnings and unhandled errors.
 * Returns a stop function that restores originals and returns captured entries.
 */
export function startErrorCapture(): () => ConsoleEntry[] {
  const captured: ConsoleEntry[] = []
  const origError = console.error
  const origWarn = console.warn

  let nextId = 0
  const capture = (level: 'error' | 'warning', args: unknown[]) => {
    captured.push({
      id: `action-${Date.now()}-${nextId++}`,
      type: level,
      message: args.map(a => (typeof a === 'string' ? a : String(a))).join(' '),
      stack: args[0] instanceof Error ? (args[0].stack ?? null) : null,
      timestamp: Date.now(),
      frames: null,
      count: 1,
      groupKey: null,
    })
  }

  console.error = (...args: unknown[]) => {
    capture('error', args)
    origError.apply(console, args)
  }
  console.warn = (...args: unknown[]) => {
    capture('warning', args)
    origWarn.apply(console, args)
  }

  const onError = (e: ErrorEvent) => {
    captured.push({
      id: `action-${Date.now()}-${nextId++}`,
      type: 'error',
      message: e.message,
      stack: e.error?.stack ?? null,
      timestamp: Date.now(),
      frames: null,
      count: 1,
      groupKey: null,
    })
  }

  const onRejection = (e: PromiseRejectionEvent) => {
    captured.push({
      id: `action-${Date.now()}-${nextId++}`,
      type: 'error',
      message: String(e.reason),
      stack: e.reason?.stack ?? null,
      timestamp: Date.now(),
      frames: null,
      count: 1,
      groupKey: null,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    console.error = origError
    console.warn = origWarn
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    return captured
  }
}

/**
 * Build a standardized action response, optionally including component state.
 */
export function buildActionResponse(opts: {
  success: boolean
  settled: boolean
  matchCount: number
  errors: ConsoleEntry[]
  nodeId?: string
}): ActionResponse {
  const response: ActionResponse = {
    success: opts.success,
    settled: opts.settled,
    matchCount: opts.matchCount,
    consoleErrors: opts.errors,
  }

  if (opts.nodeId) {
    const node = findNodeById(devtoolsState.tree, opts.nodeId)
    if (node) {
      response.componentState = {
        id: node.id,
        name: node.name,
        props: node.props,
        sections: node.sections,
      }
    }
  }

  return response
}
