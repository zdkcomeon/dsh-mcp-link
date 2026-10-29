import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { probeMcp } from '../lib/host/probe.js'

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp-stdio.mjs', import.meta.url))
const env = { ...process.env, FAKE_MCP_CONFIG_TOKEN: 'configured-token' }

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  try {
    return await run(`http://127.0.0.1:${String(address.port)}/mcp`, server)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => { server.close(resolve) })
    server.closeAllConnections()
  }
}

test('stdio probe completes the MCP handshake and lists tools', async () => {
  const result = await probeMcp({
    name: 'fake',
    transport: 'stdio',
    command: process.execPath,
    args: [fixture],
    env,
  })
  assert.equal(result.connected, true)
  assert.equal(result.protocolVersion, '2026-07-28')
  assert.equal(result.serverName, 'fake-server')
  assert.equal(result.serverVersion, 'configured-token')
  assert.equal(result.toolCount, 2)
  assert.deepEqual(result.toolNames, ['alpha', 'beta'])
  assert.equal(result.error, undefined)
  assert.ok(result.durationMs >= 0)
})

test('stdio probe scrubs ambient secrets and keeps configured env', async () => {
  process.env.FAKE_MCP_AMBIENT_TOKEN = 'ambient-secret'
  try {
    const result = await probeMcp({
      name: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture],
      env: { FAKE_MCP_CONFIG_TOKEN: 'configured-token' },
    })
    assert.equal(result.serverVersion, 'configured-token')
  } finally {
    delete process.env.FAKE_MCP_AMBIENT_TOKEN
  }
})

test('stdio probe reports a command that cannot start', async () => {
  const result = await probeMcp({
    name: 'missing',
    transport: 'stdio',
    command: '/nonexistent/dsh-mcp-link-probe-command',
  })
  assert.equal(result.connected, false)
  assert.equal(result.error?.code, 'spawn-failed')
  assert.match(result.error?.message ?? '', /nonexistent/u)
})

test('stdio probe reports a process that exits before the handshake', async () => {
  const result = await probeMcp({
    name: 'crashed',
    transport: 'stdio',
    command: process.execPath,
    args: ['-e', 'process.exit(3)'],
  })
  assert.equal(result.connected, false)
  assert.equal(result.error?.code, 'exited')
})

test('stdio probe times out when the server never answers', async () => {
  const result = await probeMcp({
    name: 'silent',
    transport: 'stdio',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
  }, 300)
  assert.equal(result.connected, false)
  assert.equal(result.error?.code, 'timeout')
})

test('http probe sends the session id and lists tools over JSON', async () => {
  const requests = []
  const result = await withServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const message = body === '' ? undefined : JSON.parse(body)
    requests.push({ method: request.method, headers: request.headers, message })
    if (request.method === 'DELETE') {
      response.writeHead(200)
      response.end()
      return
    }
    if (message?.method === 'initialize') {
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2026-07-28',
          capabilities: { tools: {} },
          serverInfo: { name: 'http-fake', version: '2.0.0' },
        },
      }))
      return
    }
    if (message?.method === 'notifications/initialized') {
      response.writeHead(202)
      response.end()
      return
    }
    if (message?.method === 'tools/list') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: [{ name: 'one' }, { name: 'two' }, { name: 'three' }] },
      }))
      return
    }
    response.writeHead(404)
    response.end()
  }, async url => probeMcp({ name: 'http-fake', transport: 'streamable-http', url }))

  assert.equal(result.connected, true)
  assert.equal(result.serverName, 'http-fake')
  assert.equal(result.toolCount, 3)
  const initialize = requests.find(request => request.message?.method === 'initialize')
  assert.equal(initialize?.headers.accept, 'application/json, text/event-stream')
  const notification = requests.find(request => request.message?.method === 'notifications/initialized')
  assert.equal(notification?.headers['mcp-session-id'], 'session-1')
  const listed = requests.find(request => request.message?.method === 'tools/list')
  assert.equal(listed?.headers['mcp-session-id'], 'session-1')
  assert.equal(listed?.headers['mcp-protocol-version'], '2026-07-28')
  assert.ok(requests.some(request => request.method === 'DELETE'))
})

test('http probe follows tools/list pagination', async () => {
  const cursors = []
  const result = await withServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      if (request.method === 'DELETE' || body === '') {
        response.writeHead(200)
        response.end()
        return
      }
      const message = JSON.parse(body)
      if (message.method === 'initialize') {
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'paged-1' })
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: '2026-07-28', capabilities: { tools: {} }, serverInfo: { name: 'paged' } },
        }))
        return
      }
      if (message.method === 'notifications/initialized') {
        response.writeHead(202)
        response.end()
        return
      }
      if (message.method === 'tools/list') {
        cursors.push(message.params?.cursor)
        const first = message.params?.cursor === undefined
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: first
            ? { tools: [{ name: 'one' }], nextCursor: 'page-2' }
            : { tools: [{ name: 'two' }, { name: 'three' }] },
        }))
        return
      }
      response.writeHead(404)
      response.end()
    })
  }, async url => probeMcp({ name: 'paged', transport: 'streamable-http', url }))

  assert.equal(result.connected, true)
  assert.equal(result.toolCount, 3)
  assert.deepEqual(result.toolNames, ['one', 'two', 'three'])
  assert.deepEqual(cursors, [undefined, 'page-2'])
})

test('http probe parses a streamable SSE response', async () => {
  const result = await withServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      if (request.method === 'DELETE' || body === '') {
        response.writeHead(200)
        response.end()
        return
      }
      const message = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sse-1' })
      if (message.method === 'initialize') {
        const payload = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'sse-fake' },
          },
        }
        response.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
        response.end()
        return
      }
      response.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n')
      response.end()
    })
  }, async url => probeMcp({ name: 'sse-fake', transport: 'streamable-http', url }))

  assert.equal(result.connected, true)
  assert.equal(result.protocolVersion, '2025-06-18')
  assert.equal(result.serverName, 'sse-fake')
  assert.equal(result.toolCount, undefined)
})

test('http probe reports an error status', async () => {
  const result = await withServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'text/plain' })
    response.end('temporarily unavailable')
  }, async url => probeMcp({ name: 'bad', transport: 'streamable-http', url }))
  assert.equal(result.connected, false)
  assert.equal(result.error?.code, 'http-status')
  assert.match(result.error?.detail ?? '', /temporarily unavailable/u)
})

test('http probe reports a JSON-RPC error with its message', async () => {
  const result = await withServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const message = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32602, message: 'bad initialize params' },
      }))
    })
  }, async url => probeMcp({ name: 'bad-rpc', transport: 'streamable-http', url }))
  assert.equal(result.connected, false)
  assert.equal(result.error?.code, 'rpc-error')
  assert.match(result.error?.detail ?? '', /bad initialize params/u)
  assert.match(result.error?.detail ?? '', /-32602/u)
})

test('http probe reports a refused connection', async () => {
  const server = createServer()
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const url = `http://127.0.0.1:${String(address.port)}/mcp`
  await new Promise(resolve => { server.close(resolve) })
  const result = await probeMcp({ name: 'refused', transport: 'streamable-http', url })
  assert.equal(result.connected, false)
  assert.ok(result.error?.code === 'network' || result.error?.code === 'timeout')
})

test('http probe times out when the server does not answer', async () => {
  const result = await withServer(() => {}, async url => probeMcp({
    name: 'slow',
    transport: 'streamable-http',
    url,
  }, 300))
  assert.equal(result.connected, false)
  assert.equal(result.error?.code, 'timeout')
})
