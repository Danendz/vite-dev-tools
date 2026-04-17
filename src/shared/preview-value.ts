import { RENDER_HISTORY_DEFAULTS } from './constants'

const REACT_ELEMENT = Symbol.for('react.element')

export interface StringifyOptions {
  maxDepth?: number
  maxLength?: number
}

/**
 * Circular-safe, depth-capped, length-capped stringify used for preview values
 * in the render-cause DetailPanel and MCP history payloads. Not round-trippable —
 * formatted for human + LLM readability.
 */
export function safeStringify(value: unknown, options: StringifyOptions = {}): string {
  const maxDepth = options.maxDepth ?? 3
  const maxLength = options.maxLength ?? RENDER_HISTORY_DEFAULTS.VALUE_PREVIEW_LENGTH
  const seen = new WeakSet<object>()
  const out = format(value, 0, maxDepth, seen)
  return truncate(out, maxLength)
}

function format(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const type = typeof value
  if (type === 'string') return `"${value as string}"`
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value)
  if (type === 'symbol') return (value as symbol).toString()
  if (type === 'function') {
    const name = (value as Function).name
    return name ? `ƒ ${name}()` : 'ƒ()'
  }
  if (type !== 'object') return String(value)

  const obj = value as object
  if (seen.has(obj)) return '[Circular]'
  seen.add(obj)

  if (depth >= maxDepth) {
    return Array.isArray(obj) ? '[Array]' : '[Object]'
  }

  // React element
  if ((obj as any).$$typeof === REACT_ELEMENT) {
    const t = (obj as any).type
    const name = typeof t === 'string' ? t : t?.displayName || t?.name || 'Component'
    return `<${name} />`
  }

  if (Array.isArray(obj)) {
    const parts = obj.slice(0, 10).map((item) => format(item, depth + 1, maxDepth, seen))
    if (obj.length > 10) parts.push('…')
    return `[${parts.join(', ')}]`
  }

  const entries = Object.entries(obj).slice(0, 10)
  const parts = entries.map(([k, v]) => `${k}: ${format(v, depth + 1, maxDepth, seen)}`)
  if (Object.keys(obj).length > 10) parts.push('…')
  return `{${parts.join(', ')}}`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
