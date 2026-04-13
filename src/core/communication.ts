import type { SourceLocation } from './types'
import { ENDPOINTS, STORAGE_KEYS } from '../shared/constants'

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
