import type { SourceLocation } from './types'
import { ENDPOINTS } from '../shared/constants'

export function openInEditor(source: SourceLocation) {
  const params = new URLSearchParams({
    file: source.fileName,
    line: String(source.lineNumber),
    column: String(source.columnNumber),
  })
  fetch(`${ENDPOINTS.OPEN_EDITOR}?${params}`).catch(() => {
    // Silently fail — editor might not be available
  })
}
