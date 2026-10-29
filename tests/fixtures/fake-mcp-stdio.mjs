/**
 * 测试用的最小 stdio MCP 服务。
 *
 * 只实现 initialize 和 tools/list；用环境变量回显配置是否传进了子进程。
 */
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line !== '') handle(line)
    index = buffer.indexOf('\n')
  }
})

function handle(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2026-07-28',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-server', version: process.env.FAKE_MCP_CONFIG_TOKEN ?? 'missing' },
      instructions: 'fake instructions',
    })
    return
  }
  if (message.method === 'tools/list') {
    respond(message.id, {
      tools: [
        { name: 'alpha', description: 'first tool', inputSchema: { type: 'object' } },
        { name: 'beta', description: 'second tool', inputSchema: { type: 'object' } },
      ],
    })
    return
  }
  if (message.id !== undefined) respondError(message.id, -32601, 'Method not found')
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}
