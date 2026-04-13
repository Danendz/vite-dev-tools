import type { SourceLocation } from './types'
import { ENDPOINTS, STORAGE_KEYS } from '../shared/constants'

export function persistHookValue(params: {
  fileName: string
  lineNumber: number
  newValue: string | number | boolean | null
}) {
  return fetch(ENDPOINTS.PERSIST_HOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        console.error('[devtools] Failed to persist hook value:', body?.error ?? res.statusText)
        return false
      }
      return true
    })
    .catch(() => false)
}

export function persistPropValue(params: {
  fileName: string
  lineNumber: number
  propKey: string
  newValue: string | number | boolean | null
}) {
  return fetch(ENDPOINTS.PERSIST_PROP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        console.error('[devtools] Failed to persist prop value:', body?.error ?? res.statusText)
        return false
      }
      return true
    })
    .catch(() => false)
}

export function openInEditor(source: SourceLocation) {
  const params = new URLSearchParams({
    file: source.fileName,
    line: String(source.lineNumber),
    column: String(source.columnNumber),
  })
  const editor = localStorage.getItem(STORAGE_KEYS.EDITOR)
  if (editor) params.set('editor', editor)
  fetch(`${ENDPOINTS.OPEN_EDITOR}?${params}`)
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        console.error(
          `[devtools] Failed to open editor:`,
          body?.error ?? res.statusText,
          body?.path ? `\nPath: ${body.path}` : '',
          `\nTip: set LAUNCH_EDITOR env var (e.g. LAUNCH_EDITOR=phpstorm pnpm dev)`,
        )
      }
    })
    .catch(() => {})
}
