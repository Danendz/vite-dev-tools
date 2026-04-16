import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createMcpMiddleware } from '@/core/mcp/middleware'

// Mock MCP dependencies
vi.mock('@modelcontextprotocol/server', () => ({
  McpServer: vi.fn(),
  isInitializeRequest: vi.fn((parsed: any) => parsed?.method === 'initialize'),
}))

vi.mock('@modelcontextprotocol/node', () => ({
  NodeStreamableHTTPServerTransport: vi.fn().mockImplementation(({ sessionIdGenerator, onsessioninitialized }: any) => {
    const sid = sessionIdGenerator()
    return {
      sessionId: sid,
      handleRequest: vi.fn().mockResolvedValue(undefined),
      onclose: null,
      _init() { onsessioninitialized(sid) },
    }
  }),
}))

function createFakeReq(method: string, url: string, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as any
  req.method = method
  req.url = url
  req.headers = headers
  req.setEncoding = vi.fn()
  req.destroy = vi.fn()
  return req
}

function createFakeRes() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  }
}

describe('createMcpMiddleware', () => {
  let middleware: ReturnType<typeof createMcpMiddleware>
  let mcpServer: any

  beforeEach(() => {
    mcpServer = { connect: vi.fn().mockResolvedValue(undefined) }
    middleware = createMcpMiddleware(mcpServer)
  })

  it('calls next() for non-MCP URLs', () => {
    const req = createFakeReq('GET', '/api/other')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('does not call next() for MCP URL', () => {
    const req = createFakeReq('POST', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 for POST without session and non-initialize request', async () => {
    const req = createFakeReq('POST', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)

    // Simulate request body
    req.emit('data', JSON.stringify({ method: 'tools/list' }))
    req.emit('end')

    // Wait for async handler
    await vi.waitFor(() => {
      expect(res.statusCode).toBe(400)
    })
  })

  it('returns 413 for oversized POST body', () => {
    const req = createFakeReq('POST', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)

    // Send more than 10MB
    const bigChunk = 'x'.repeat(11 * 1024 * 1024)
    req.emit('data', bigChunk)

    expect(res.statusCode).toBe(413)
    expect(req.destroy).toHaveBeenCalled()
  })

  it('returns 400 for GET without session', () => {
    const req = createFakeReq('GET', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for DELETE without session', () => {
    const req = createFakeReq('DELETE', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res.statusCode).toBe(400)
  })

  it('returns 405 for unsupported HTTP method', () => {
    const req = createFakeReq('PUT', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res.statusCode).toBe(405)
  })

  it('returns 500 for JSON parse error', async () => {
    const req = createFakeReq('POST', '/__devtools/mcp')
    const res = createFakeRes()
    const next = vi.fn()

    middleware(req, res, next)

    req.emit('data', 'not valid json{{{')
    req.emit('end')

    await vi.waitFor(() => {
      expect(res.statusCode).toBe(500)
    })
  })
})
