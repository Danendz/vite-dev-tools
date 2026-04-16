import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { McpServer, isInitializeRequest } from '@modelcontextprotocol/server'
import { ENDPOINTS } from '../../shared/constants'

export function createMcpMiddleware(mcpServer: McpServer) {
  const transports = new Map<string, NodeStreamableHTTPServerTransport>()

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(ENDPOINTS.MCP)) return next()

    if (req.method === 'POST') {
      req.setEncoding('utf8')
      let body = ''
      let aborted = false
      req.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 10 * 1024 * 1024) {
          aborted = true
          res.statusCode = 413
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Payload too large' }))
          req.destroy()
        }
      })
      req.on('end', async () => {
        if (aborted) return
        try {
          const parsed = JSON.parse(body)
          const sessionId = req.headers['mcp-session-id'] as string | undefined

          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res, parsed)
          } else if (!sessionId && isInitializeRequest(parsed)) {
            const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid: string): void => { transports.set(sid, transport) },
            })
            transport.onclose = () => {
              if (transport.sessionId) transports.delete(transport.sessionId)
            }
            await mcpServer.connect(transport)
            await transport.handleRequest(req, res, parsed)
          } else {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid request: no session or not an initialize request' }))
          }
        } catch (e: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (sessionId && transports.has(sessionId)) {
        transports.get(sessionId)!.handleRequest(req, res)
        return
      }
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'No active session' }))
      return
    }

    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (sessionId && transports.has(sessionId)) {
        transports.get(sessionId)!.handleRequest(req, res)
        return
      }
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'No active session' }))
      return
    }

    res.statusCode = 405
    res.end()
  }
}
