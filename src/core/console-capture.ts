import type { ConsoleEntry, ConsoleEntryType, StackFrame } from './types'

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
    .map((line) => line.replace(/https?:\/\/[^/]+/g, '').replace(/\?[^:)]*:/g, ':'))
    .join('\n')
}

/**
 * Parse a stack trace string into structured StackFrame objects.
 * Handles named frames, anonymous frames, and eval frames.
 * Skips non-matching lines (e.g. "Error: message").
 */
export function parseStack(stack: string): StackFrame[] {
  if (!stack) return []

  const frames: StackFrame[] = []

  // Regex for: at funcName (file:line:col)
  const namedRe = /^\s+at\s+(\S+)\s+\((.+):(\d+):(\d+)\)\s*$/
  // Regex for: at file:line:col (anonymous, no parens around location)
  const anonRe = /^\s+at\s+((?!eval\b)[^()\s]+):(\d+):(\d+)\s*$/
  // Regex for eval: at eval (eval at fn (file:line:col), ...)
  // Use a non-greedy match for the file path, stopping before :digits:digits
  const evalRe = /^\s+at\s+eval\s+\(eval at\s+\S+\s+\((.+?):(\d+):(\d+)\)/

  for (const line of stack.split('\n')) {
    // Try eval frame first (more specific)
    const evalMatch = evalRe.exec(line)
    if (evalMatch) {
      const file = evalMatch[1]
      frames.push({
        fn: null,
        file,
        line: parseInt(evalMatch[2], 10),
        col: parseInt(evalMatch[3], 10),
        isLibrary: file.includes('node_modules/') || file.includes('.vite/deps/'),
      })
      continue
    }

    // Try named frame: at funcName (file:line:col)
    const namedMatch = namedRe.exec(line)
    if (namedMatch) {
      const file = namedMatch[2]
      frames.push({
        fn: namedMatch[1],
        file,
        line: parseInt(namedMatch[3], 10),
        col: parseInt(namedMatch[4], 10),
        isLibrary: file.includes('node_modules/') || file.includes('.vite/deps/'),
      })
      continue
    }

    // Try anonymous frame: at file:line:col
    const anonMatch = anonRe.exec(line)
    if (anonMatch) {
      const file = anonMatch[1]
      frames.push({
        fn: null,
        file,
        line: parseInt(anonMatch[2], 10),
        col: parseInt(anonMatch[3], 10),
        isLibrary: file.includes('node_modules/') || file.includes('.vite/deps/'),
      })
      continue
    }
  }

  return frames
}

function createEntry(type: ConsoleEntryType, args: unknown[], stack?: string | null): ConsoleEntry {
  const isSynthetic = stack !== undefined
  let rawStack = stack ?? (args[0] instanceof Error ? args[0].stack ?? null : null)

  // Strip internal capture frames from synthetic stacks
  if (isSynthetic && rawStack) {
    rawStack = rawStack
      .split('\n')
      .filter((line) => !line.includes('console-capture'))
      .join('\n')
  }

  const cleaned = rawStack ? cleanStack(rawStack) : null
  return {
    id: `console_${idCounter++}`,
    type,
    timestamp: performance.now(),
    message: formatArgs(args),
    stack: cleaned,
    frames: cleaned ? parseStack(cleaned) : null,
  }
}

export function startCapture(onEntry: EntryCallback): () => void {
  const origError = console.error
  const origWarn = console.warn
  const origLog = console.log

  console.error = (...args: unknown[]) => {
    onEntry(createEntry('error', args))
    origError.apply(console, args)
  }

  console.warn = (...args: unknown[]) => {
    const syntheticStack = new Error().stack ?? null
    onEntry(createEntry('warning', args, syntheticStack))
    origWarn.apply(console, args)
  }

  console.log = (...args: unknown[]) => {
    const syntheticStack = new Error().stack ?? null
    onEntry(createEntry('log', args, syntheticStack))
    origLog.apply(console, args)
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
    console.log = origLog
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}
