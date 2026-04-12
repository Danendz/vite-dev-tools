import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import launchEditor from 'launch-editor'

export function createEditorMiddleware(projectRoot: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__devtools/open-editor')) {
      return next()
    }

    const url = new URL(req.url, 'http://localhost')
    const file = url.searchParams.get('file')
    const line = url.searchParams.get('line') || '1'
    const column = url.searchParams.get('column') || '1'

    if (!file) {
      res.statusCode = 400
      res.end('Missing file parameter')
      return
    }

    // Paths from _debugStack are Vite dev server URLs like /src/App.tsx
    // Always resolve relative to project root
    const absolutePath = path.resolve(projectRoot, file.replace(/^\//, ''))

    launchEditor(`${absolutePath}:${line}:${column}`)
    res.statusCode = 200
    res.end('OK')
  }
}
