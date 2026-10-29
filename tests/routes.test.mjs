import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { registerRoutes } from '../lib/host/routes.js'

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp-stdio.mjs', import.meta.url))

async function fixtureFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-routes-'))
  const home = join(dir, 'home')
  const profileDir = join(dir, 'profile')
  await mkdir(home, { recursive: true })
  await mkdir(profileDir, { recursive: true })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  await writeFile(patchPath, '[]\n')
  const profile = { name: 'test', patchPath, home, cwd: dir }
  return { dir, profile }
}

function routeOf(loader, profile) {
  const routes = new Map()
  const logs = []
  registerRoutes({
    getConnection: () => ({
      fetch: {
        register: route => {
          routes.set(route.path, route)
          return async () => undefined
        },
      },
    }),
    getLoader: () => loader,
    getProfile: () => profile,
    getLiveReload: () => false,
    projects: [],
    log: {
      info: message => { logs.push(message) },
      warn: message => { logs.push(message) },
    },
    effect: register => { void register() },
  })
  return { routes, logs }
}

function request(body, path = '/api/mcp-setting/test') {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('routes a connection test through the authenticated /api handler', async () => {
  const files = await fixtureFiles()
  try {
    const config = {
      serverName: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture],
      env: { FAKE_MCP_CONFIG_TOKEN: 'configured-token' },
    }
    const loader = {
      entries: () => [{
        options: { id: 'mcp-fake', name: '@deepseek-ai/dsh-mcp-client', config },
        fiber: { state: 2, config },
      }],
    }
    const { routes, logs } = routeOf(loader, files.profile)
    const route = routes.get('/api/mcp-setting/test')
    assert.ok(route)
    assert.deepEqual(route.methods, ['POST'])
    const response = await route.fetch(request({ entryId: 'mcp-fake' }))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.target, 'dsh')
    assert.equal(payload.connected, true)
    assert.equal(payload.toolCount, 2)
    assert.ok(logs.some(line => line.startsWith('mcp_setting.connection_tested:')))
    assert.ok(logs.every(line => !line.includes('configured-token')))
  } finally {
    await rm(files.dir, { recursive: true, force: true })
  }
})

test('routes a reconnect through the authenticated /api handler', async () => {
  const files = await fixtureFiles()
  try {
    const config = {
      serverName: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture],
      env: { FAKE_MCP_CONFIG_TOKEN: 'configured-token' },
    }
    const calls = []
    const loader = {
      entries: () => [{
        options: { id: 'mcp-reconnect-route', name: '@deepseek-ai/dsh-mcp-client', config },
        fiber: {
          uid: 1,
          state: 2,
          config,
          update(next, noSave) {
            calls.push({ next, noSave })
          },
          async await() {},
        },
      }],
    }
    const { routes, logs } = routeOf(loader, files.profile)
    const route = routes.get('/api/mcp-setting/reconnect')
    assert.ok(route)
    assert.deepEqual(route.methods, ['POST'])
    const response = await route.fetch(request(
      { entryId: 'mcp-reconnect-route' },
      '/api/mcp-setting/reconnect',
    ))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.reloaded, true)
    assert.equal(payload.test.connected, true)
    assert.equal(payload.test.toolCount, 2)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].noSave, true)
    assert.ok(logs.some(line => line.startsWith('mcp_setting.reconnect_completed:')))
    assert.ok(logs.every(line => !line.includes('configured-token')))
  } finally {
    await rm(files.dir, { recursive: true, force: true })
  }
})

test('returns 400 for a test request without a target', async () => {
  const files = await fixtureFiles()
  try {
    const { routes } = routeOf({ entries: () => [] }, files.profile)
    const route = routes.get('/api/mcp-setting/test')
    assert.ok(route)
    const response = await route.fetch(request({}))
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'invalid-request')
  } finally {
    await rm(files.dir, { recursive: true, force: true })
  }
})

test('returns 404 for an unknown entry id', async () => {
  const files = await fixtureFiles()
  try {
    const { routes } = routeOf({ entries: () => [] }, files.profile)
    const route = routes.get('/api/mcp-setting/test')
    assert.ok(route)
    const response = await route.fetch(request({ entryId: 'mcp-missing' }))
    assert.equal(response.status, 404)
    const payload = await response.json()
    assert.equal(payload.error.code, 'not-found')
  } finally {
    await rm(files.dir, { recursive: true, force: true })
  }
})
