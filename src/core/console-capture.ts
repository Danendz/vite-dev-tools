import type { ConsoleEntry, ConsoleEntryType } from './types'

let idCounter = 0

type EntryCallback = (entry: ConsoleEntry) => void

function stringifyArg(a: unknown): string {
  if (a instanceof Error) return a.message
  if (typeof a === 'object' && a !== null) {
    try {
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  }
  return String(a)
}

function formatArgs(args: unknown[]): string {
  // Handle printf-style format strings (e.g. console.warn('%s\n\n%s', msg1, msg2))
  if (typeof args[0] === 'string' && args.length > 1 && /%[sdoOif%]/.test(args[0])) {
    let i = 1
    const formatted = args[0].replace(/%[sdoOif]/g, () => {
      if (i >= args.length) return ''
      return stringifyArg(args[i++])
    })
    // Append any remaining args
    const rest = args.slice(i).map(stringifyArg)
    return rest.length > 0 ? formatted + ' ' + rest.join(' ') : formatted
  }

  return args.map(stringifyArg).join(' ')
}

/**
 * Clean stack trace: strip framework/Vite internals, remove origin URLs, strip query strings.
 */
function cleanStack(stack: string): string {
  return stack
    .split('\n')
    .filter((line) => {
      if (line.includes('.vite/deps/')) return false
      if (line.includes('node_modules/')) return false
      return true
    })
    .map((line) => line.replace(/https?:\/\/[^/]+/g, '').replace(/\?[^:)]*:/g, ':'))
    .join('\n')
}

function createEntry(type: ConsoleEntryType, args: unknown[], stack?: string | null): ConsoleEntry {
  const rawStack = stack ?? (args[0] instanceof Error ? args[0].stack ?? null : null)
  return {
    id: `console_${idCounter++}`,
    type,
    timestamp: performance.now(),
    message: formatArgs(args),
    stack: rawStack ? cleanStack(rawStack) : null,
  }
}

export function startCapture(onEntry: EntryCallback): () => void {
  const origError = console.error
  const origWarn = console.warn

  console.error = (...args: unknown[]) => {
    onEntry(createEntry('error', args))
    origError.apply(console, args)
  }

  console.warn = (...args: unknown[]) => {
    onEntry(createEntry('warning', args))
    origWarn.apply(console, args)
  }

  function handleError(e: ErrorEvent) {
    onEntry(
      createEntry(
        'error',
        [e.error ?? e.message],
        e.error?.stack ?? `at ${e.filename}:${e.lineno}:${e.colno}`,
      ),
    )
  }

  function handleRejection(e: PromiseRejectionEvent) {
    const reason = e.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack ?? null : null
    onEntry(createEntry('error', [message], stack))
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)

  return () => {
    console.error = origError
    console.warn = origWarn
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}
