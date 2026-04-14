import type { SourceLocation, EditHint } from './types'
import { ENDPOINTS, EVENTS, STORAGE_KEYS } from '../shared/constants'

type PersistResult = { ok: true } | { ok: false; error: string }

export interface DiffData {
  fileName: string
  lineNumber: number
  contextBefore: string[]
  removedLines: string[]
  addedLines: string[]
  contextAfter: string[]
}

export type PreviewResult =
  | { ok: true; preview: true; diff: DiffData }
  | { ok: false; error: string }

function dispatchToast(message: string, type: 'error' | 'warning' = 'error') {
  window.dispatchEvent(new CustomEvent(EVENTS.TOAST, { detail: { type, message } }))
}

/** Send a persist request, optionally in preview mode */
function sendPersist(
  endpoint: string,
  params: Record<string, unknown>,
  label: string,
  preview?: boolean,
): Promise<PersistResult | PreviewResult> {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preview ? { ...params, preview: true } : params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        const error = body?.error ?? res.statusText
        if (!preview) dispatchToast(`Failed to persist ${label}: ${error}`)
        return { ok: false as const, error }
      }
      if (body?.preview) {
        return { ok: true as const, preview: true as const, diff: body.diff as DiffData }
      }
      return { ok: true as const }
    })
    .catch(() => {
      if (!preview) dispatchToast(`Failed to persist ${label}: network error`)
      return { ok: false as const, error: 'Network error' }
    })
}

export function persistEdit(params: {
  editHint: EditHint
  value: unknown
  fileName: string
  lineNumber: number
  componentName: string
}, preview?: boolean): Promise<PersistResult | PreviewResult> {
  return sendPersist(ENDPOINTS.PERSIST_EDIT, params, 'edit', preview)
}

export function persistHookValue(params: {
  fileName: string
  lineNumber: number
  newValue: string | number | boolean | null
}, preview?: boolean): Promise<PersistResult | PreviewResult> {
  return sendPersist(ENDPOINTS.PERSIST_HOOK, params, 'hook', preview)
}

export function persistPropValue(params: {
  fileName: string
  lineNumber: number
  propKey: string
  newValue: string | number | boolean | null
}, preview?: boolean): Promise<PersistResult | PreviewResult> {
  return sendPersist(ENDPOINTS.PERSIST_PROP, params, `prop "${params.propKey}"`, preview)
}

export function persistTextValue(params: {
  fileName: string
  lineNumber: number
  oldText: string
  newText: string
}, preview?: boolean): Promise<PersistResult | PreviewResult> {
  return sendPersist(ENDPOINTS.PERSIST_TEXT, params, 'text', preview)
}

export function undoEdit(params: { fileName: string }): Promise<PersistResult> {
  return fetch(ENDPOINTS.UNDO_EDIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null)
      if (!res.ok || (body && !body.ok)) {
        const error = body?.error ?? res.statusText
        dispatchToast(`Failed to undo: ${error}`)
        return { ok: false as const, error }
      }
      dispatchToast('Reverted to previous version', 'warning')
      return { ok: true as const }
    })
    .catch(() => {
      dispatchToast('Failed to undo: network error')
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
