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

  // Vue component proxy — enumerating keys triggers "Avoid enumerating keys" warning
  if ((obj as any).__v_skip === true) return '[ComponentInstance]'

  // Unwrap Vue reactive/readonly proxies to avoid triggering proxy traps
  const target = (obj as any).__v_raw ?? obj

  if (Array.isArray(target)) {
    const parts = target.slice(0, 10).map((item) => format(item, depth + 1, maxDepth, seen))
    if (target.length > 10) parts.push('…')
    return `[${parts.join(', ')}]`
  }

  const entries = Object.entries(target).slice(0, 10)
  const parts = entries.map(([k, v]) => `${k}: ${format(v, depth + 1, maxDepth, seen)}`)
  if (Object.keys(target).length > 10) parts.push('…')
  return `{${parts.join(', ')}}`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/**
 * Pretty-print a value using JSON.stringify with 2-space indent and a custom
 * replacer that handles non-JSON types. Used for modal value inspection.
 */
export function prettyStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, function (_key: string, val: unknown) {
      if (val === undefined) return '[undefined]'
      if (typeof val === 'function') {
        const name = (val as Function).name
        return name ? `ƒ ${name}()` : 'ƒ()'
      }
      if (typeof val === 'symbol') return val.toString()
      if (typeof val === 'bigint') return `${val}n`
      if (val !== null && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]'
        // Vue component proxy — enumerating keys triggers warning
        if ((val as any).__v_skip === true) return '[ComponentInstance]'
        // Unwrap Vue reactive/readonly proxies
        const raw = (val as any).__v_raw
        if (raw) {
          seen.add(val)
          return raw
        }
        seen.add(val)
        if ((val as any).$$typeof === REACT_ELEMENT) {
          const t = (val as any).type
          const name = typeof t === 'string' ? t : t?.displayName || t?.name || 'Component'
          return `<${name} />`
        }
      }
      return val
    }, 2) ?? 'undefined'
  } catch {
    return safeStringify(value, { maxDepth: 6, maxLength: 5000 })
  }
}
