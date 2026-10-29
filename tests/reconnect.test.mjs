import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ActionError } from '../lib/host/actions.js'
import { reconnectMcp } from '../lib/host/reconnect.js'
import { createReconnectTool } from '../lib/host/tool.js'

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp-stdio.mjs', import.meta.url))

function config() {
  return {
    serverName: 'fake',
    transport: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: { FAKE_MCP_CONFIG_TOKEN: 'configured-token' },
  }
}

function contextFor(entry, id) {
  return {
    loader: { entries: () => [entry] },
    profile: { name: 'test', patchPath: '/tmp/unused', home: '/tmp', cwd: '/tmp' },
    liveReload: false,
    configProjects: [],
  }
}

function entryOf(id, options = {}) {
  const value = options.config ?? config()
  const calls = []
  const fiber = {
    uid: 1,
    state: 2,
    config: value,
    update(next, noSave) {
      calls.push({ next, noSave })
    },
    async await() {},
    ...options.fiber,
  }
  return {
    calls,
    entry: {
      options: { id, name: '@deepseek-ai/dsh-mcp-client', config: value, ...options.options },
      disabled: options.disabled,
      fiber,
    },
  }
}

test('reloads the mcp-client fiber without asking the loader to save', async () => {
  const { entry, calls } = entryOf('mcp-reconnect-one')
  const result = await reconnectMcp(contextFor(entry), { entryId: 'mcp-reconnect-one' })
  assert.equal(result.reloaded, true)
  assert.equal(result.entryId, 'mcp-reconnect-one')
  assert.equal(result.serverName, 'fake')
  assert.equal(result.transport, 'stdio')
  assert.equal(result.test?.connected, true)
  assert.equal(result.test?.toolCount, 2)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].noSave, true)
  assert.equal(calls[0].next, entry.options.config)
})

test('finds an entry by serverName and skips update while it is already reloading', async () => {
  const { entry, calls } = entryOf('mcp-reconnect-two', { fiber: { state: 1 } })
  const result = await reconnectMcp(contextFor(entry), { serverName: 'fake' })
  assert.equal(result.reloaded, true)
  assert.equal(result.entryId, 'mcp-reconnect-two')
  assert.equal(calls.length, 0)
})

test('reports a fiber reload error without treating it as connected', async () => {
  const { entry } = entryOf('mcp-reconnect-three', {
    fiber: {
      async await() {
        throw new Error('startup exploded')
      },
    },
  })
  const result = await reconnectMcp(contextFor(entry), { entryId: 'mcp-reconnect-three' })
  assert.equal(result.reloaded, false)
  assert.equal(result.error?.code, 'reload-failed')
  assert.match(result.error?.message ?? '', /startup exploded/u)
  assert.equal(result.test, undefined)
})

test('rejects a target that is not an MCP client entry', async () => {
  const loader = {
    entries: () => [{
      options: { id: 'other', name: '@deepseek-ai/dsh-other-plugin', config: {} },
      fiber: { uid: 1, state: 2, update() {}, async await() {} },
    }],
  }
  const context = {
    loader,
    profile: { name: 'test', patchPath: '/tmp/unused', home: '/tmp', cwd: '/tmp' },
    liveReload: false,
    configProjects: [],
  }
  await assert.rejects(reconnectMcp(context, { entryId: 'other' }), (error) => {
    assert.ok(error instanceof ActionError)
    assert.equal(error.status, 404)
    return true
  })
})

test('rejects a disabled entry', async () => {
  const { entry } = entryOf('mcp-reconnect-four', { disabled: true })
  await assert.rejects(reconnectMcp(contextFor(entry), { entryId: 'mcp-reconnect-four' }), (error) => {
    assert.ok(error instanceof ActionError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'entry-disabled')
    return true
  })
})

test('provides one tool that shares the reconnect operation', async () => {
  const { entry } = entryOf('mcp-reconnect-five')
  const tool = createReconnectTool(() => contextFor(entry))
  assert.equal(tool.name, 'mcp_link_reconnect')
  const value = await tool.execute({ serverName: 'fake' }, { signal: new AbortController().signal })
  assert.equal(value.reloaded, true)
  assert.equal(value.connected, true)
  assert.equal(value.entryId, 'mcp-reconnect-five')
  assert.match(value.message, /Reconnected fake/u)
  const rendered = tool.output.render({ serverName: 'fake' }, value)
  assert.deepEqual(rendered, [{ type: 'text', text: value.message }])
  await assert.rejects(tool.execute({}, { signal: new AbortController().signal }), /exactly one/u)
  await assert.rejects(
    tool.execute({ entryId: 'a', serverName: 'b' }, { signal: new AbortController().signal }),
    /exactly one/u,
  )
})
