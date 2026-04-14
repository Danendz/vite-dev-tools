import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import launchEditor from 'launch-editor'

function json(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

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
      json(res, 400, { ok: false, error: 'Missing file parameter' })
      return
    }

    // Resolve the file path:
    // - __devtools_source paths are relative to project root (e.g. /src/App.tsx)
    // - _debugSource paths (React 18) are already absolute (e.g. /Users/dev/.../App.tsx)
    let absolutePath = path.resolve(projectRoot, file.replace(/^\//, ''))
    if (!fs.existsSync(absolutePath) && fs.existsSync(file)) {
      absolutePath = file
    }

    if (!fs.existsSync(absolutePath)) {
      console.error(`[devtools] File not found: ${absolutePath}`)
      json(res, 404, { ok: false, error: 'File not found', path: absolutePath })
      return
    }

    const editor = url.searchParams.get('editor') || undefined

    launchEditor(
      `${absolutePath}:${line}:${column}`,
      editor,
      (_fileName: string, errorMessage: string | null) => {
        console.error(`[devtools] Failed to open editor: ${errorMessage}`)
      },
    )

    json(res, 200, { ok: true, path: absolutePath })
  }
}
