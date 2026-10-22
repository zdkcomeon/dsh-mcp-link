import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseClaudeCodeConfig,
  parseClaudeCodeProject,
  parseSourceText,
} from '../lib/host/parsers.js'

test('parses Claude-style mcpServers with stdio and http transports', () => {
  const result = parseSourceText('claude', JSON.stringify({
    mcpServers: {
      files: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { API_TOKEN: 'secret' },
      },
      remote: {
        type: 'http',
        url: 'https://example.com/mcp?token=secret',
        headers: { Authorization: 'Bearer secret' },
      },
    },
  }))
  assert.equal(result.servers.length, 2)
  const files = result.servers.find(server => server.name === 'files')
  assert.equal(files?.transport, 'stdio')
  assert.deepEqual(files?.args, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
  assert.equal(files?.env?.API_TOKEN, 'secret')
  const remote = result.servers.find(server => server.name === 'remote')
  assert.equal(remote?.transport, 'streamable-http')
  assert.equal(remote?.headers?.Authorization, 'Bearer secret')
})

test('parses VS Code servers and marks unresolved input variables unsupported', () => {
  const result = parseSourceText('vscode', JSON.stringify({
    inputs: [{ id: 'token', type: 'promptString', password: true }],
    servers: {
      ok: { type: 'stdio', command: 'node', args: ['server.js'] },
      needsInput: { type: 'stdio', command: 'node', args: ['${input:token}'] },
    },
  }))
  assert.equal(result.servers.length, 2)
  assert.equal(result.servers.find(server => server.name === 'ok')?.unsupported, undefined)
  assert.match(String(result.servers.find(server => server.name === 'needsInput')?.unsupported), /input/)
})

test('parses Codex TOML mcp_servers', () => {
  const result = parseSourceText('codex', `
[mcp_servers.codegraph]
command = "codegraph"
args = ["serve", "--mcp"]

[mcp_servers.remote]
url = "https://example.com/mcp"
http_headers = { Authorization = "Bearer secret" }
`)
  assert.equal(result.servers.length, 2)
  assert.equal(result.servers.find(server => server.name === 'codegraph')?.transport, 'stdio')
  assert.equal(result.servers.find(server => server.name === 'remote')?.transport, 'streamable-http')
  assert.equal(result.servers.find(server => server.name === 'remote')?.headers?.Authorization, 'Bearer secret')
})

test('parses Continue YAML array and object forms', () => {
  const arrayForm = parseSourceText('continue', `
mcpServers:
  - name: files
    command: npx
    args: ["-y", "server-filesystem"]
  - name: remote
    type: streamable-http
    url: https://example.com/mcp
`)
  assert.equal(arrayForm.servers.length, 2)
  assert.equal(arrayForm.servers[0]?.name, 'files')
  assert.equal(arrayForm.servers[1]?.transport, 'streamable-http')

  const objectForm = parseSourceText('continue', `
mcpServers:
  files:
    command: npx
    args: ["-y", "server-filesystem"]
`)
  assert.equal(objectForm.servers.length, 1)
  assert.equal(objectForm.servers[0]?.name, 'files')
})

test('reads project-scoped Claude Code servers without duplicating global ones', () => {
  const config = {
    mcpServers: { global: { command: 'global-mcp' } },
    projects: {
      '/tmp/project': { mcpServers: { local: { command: 'local-mcp' } } },
    },
  }
  assert.deepEqual(parseClaudeCodeConfig(config).map(server => server.name), ['global'])
  assert.deepEqual(parseClaudeCodeProject(config, '/tmp/project').map(server => server.name), ['local'])
})

test('parses OpenCode local command arrays', () => {
  const result = parseSourceText('opencode', JSON.stringify({
    mcp: {
      local: { type: 'local', command: ['npx', '-y', 'server'], environment: { TOKEN: 'x' } },
      remote: { type: 'remote', url: 'https://example.com/mcp', headers: { 'X-Key': 'x' } },
    },
  }))
  assert.equal(result.servers.length, 2)
  assert.equal(result.servers.find(server => server.name === 'local')?.command, 'npx')
  assert.deepEqual(result.servers.find(server => server.name === 'local')?.args, ['-y', 'server'])
  assert.equal(result.servers.find(server => server.name === 'remote')?.transport, 'streamable-http')
})
