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

const PRETTY_MAX_DEPTH = 6
const PRETTY_MAX_LENGTH = 20_000

/**
 * Pretty-print a value with JSON-like 2-space indent. Used for modal value
 * inspection. Bounded in depth, length, and cycles — host React/Vue prop
 * values can reference huge or self-referential graphs (Redux state, DOM
 * nodes with Shadow-Root back-pointers), so an unbounded JSON.stringify
 * would crash the renderer.
 */
export function prettyStringify(value: unknown, options: StringifyOptions = {}): string {
  const maxDepth = options.maxDepth ?? PRETTY_MAX_DEPTH
  const maxLength = options.maxLength ?? PRETTY_MAX_LENGTH
  const seen = new WeakSet<object>()
  const out: string[] = []
  let len = 0
  let truncated = false

  function write(s: string): boolean {
    if (truncated) return false
    if (len + s.length > maxLength) {
      out.push(s.slice(0, Math.max(0, maxLength - len)))
      out.push('…')
      len = maxLength
      truncated = true
      return false
    }
    out.push(s)
    len += s.length
    return true
  }

  function indent(depth: number): string {
    return '\n' + '  '.repeat(depth)
  }

  function format(val: unknown, depth: number): void {
    if (truncated) return
    if (val === undefined) return void write('"[undefined]"')
    if (val === null) return void write('null')
    const type = typeof val
    if (type === 'string') return void write(JSON.stringify(val))
    if (type === 'number') return void write(Number.isFinite(val as number) ? String(val) : `"${String(val)}"`)
    if (type === 'boolean') return void write(String(val))
    if (type === 'bigint') return void write(`"${val}n"`)
    if (type === 'symbol') return void write(JSON.stringify((val as symbol).toString()))
    if (type === 'function') {
      const name = (val as Function).name
      return void write(name ? `"ƒ ${name}()"` : '"ƒ()"')
    }
    if (type !== 'object') return void write(JSON.stringify(String(val)))

    const obj = val as object
    if (seen.has(obj)) return void write('"[Circular]"')
    if ((obj as any).__v_skip === true) return void write('"[ComponentInstance]"')
    if ((obj as any).$$typeof === REACT_ELEMENT) {
      const t = (obj as any).type
      const name = typeof t === 'string' ? t : t?.displayName || t?.name || 'Component'
      return void write(`"<${name} />"`)
    }

    const raw = (obj as any).__v_raw
    const target = (raw && typeof raw === 'object') ? raw : obj
    seen.add(obj)
    if (target !== obj) seen.add(target)

    if (depth >= maxDepth) {
      return void write(Array.isArray(target) ? '"[Array]"' : '"[Object]"')
    }

    if (Array.isArray(target)) {
      if (target.length === 0) return void write('[]')
      if (!write('[')) return
      for (let i = 0; i < target.length; i++) {
        if (!write(indent(depth + 1))) return
        format(target[i], depth + 1)
        if (truncated) return
        if (i < target.length - 1 && !write(',')) return
      }
      if (!write(indent(depth))) return
      write(']')
      return
    }

    const keys = Object.keys(target as object)
    if (keys.length === 0) return void write('{}')
    if (!write('{')) return
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (!write(indent(depth + 1))) return
      if (!write(JSON.stringify(k) + ': ')) return
      format((target as any)[k], depth + 1)
      if (truncated) return
      if (i < keys.length - 1 && !write(',')) return
    }
    if (!write(indent(depth))) return
    write('}')
  }

  try {
    format(value, 0)
  } catch {
    return safeStringify(value, { maxDepth: 6, maxLength: 5000 })
  }
  return out.join('')
}
