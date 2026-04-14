import type { SourceLocation, EditHint } from './types'
import { ENDPOINTS, EVENTS, STORAGE_KEYS } from '../shared/constants'

type PersistResult = { ok: true } | { ok: false; error: string }

function dispatchToast(message: string, type: 'error' | 'warning' = 'error') {
  window.dispatchEvent(new CustomEvent(EVENTS.TOAST, { detail: { type, message } }))
}

export function persistEdit(params: {
  editHint: EditHint
  value: unknown
  fileName: string
  lineNumber: number
  componentName: string
}): Promise<PersistResult> {
  return fetch(ENDPOINTS.PERSIST_EDIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        const error = body?.error ?? res.statusText
        dispatchToast(`Failed to persist edit: ${error}`)
        return { ok: false as const, error }
      }
      return { ok: true as const }
    })
    .catch(() => {
      dispatchToast('Failed to persist edit: network error')
      return { ok: false as const, error: 'Network error' }
    })
}

export function persistHookValue(params: {
  fileName: string
  lineNumber: number
  newValue: string | number | boolean | null
}): Promise<PersistResult> {
  return fetch(ENDPOINTS.PERSIST_HOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        const error = body?.error ?? res.statusText
        dispatchToast(`Failed to persist hook: ${error}`)
        return { ok: false as const, error }
      }
      return { ok: true as const }
    })
    .catch(() => {
      dispatchToast('Failed to persist hook: network error')
      return { ok: false as const, error: 'Network error' }
    })
}

export function persistPropValue(params: {
  fileName: string
  lineNumber: number
  propKey: string
  newValue: string | number | boolean | null
}): Promise<PersistResult> {
  return fetch(ENDPOINTS.PERSIST_PROP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        const error = body?.error ?? res.statusText
        dispatchToast(`Failed to persist prop "${params.propKey}": ${error}`)
        return { ok: false as const, error }
      }
      return { ok: true as const }
    })
    .catch(() => {
      dispatchToast(`Failed to persist prop "${params.propKey}": network error`)
      return { ok: false as const, error: 'Network error' }
    })
}

export function persistTextValue(params: {
  fileName: string
  lineNumber: number
  oldText: string
  newText: string
}): Promise<PersistResult> {
  return fetch(ENDPOINTS.PERSIST_TEXT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        const error = body?.error ?? res.statusText
        dispatchToast(`Failed to persist text: ${error}`)
        return { ok: false as const, error }
      }
      return { ok: true as const }
    })
    .catch(() => {
      dispatchToast('Failed to persist text: network error')
      return { ok: false as const, error: 'Network error' }
    })
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
        const error = body?.error ?? res.statusText
        dispatchToast(`Failed to open editor: ${error}`)
      }
    })
    .catch(() => {
      dispatchToast('Failed to open editor: network error')
    })
}
