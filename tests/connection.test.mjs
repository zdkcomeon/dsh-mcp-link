import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ActionError } from '../lib/host/actions.js'
import { scanAll } from '../lib/host/scan.js'
import { writeProjects } from '../lib/host/state.js'
import { testConnection } from '../lib/host/test.js'

const fixture = fileURLToPath(new URL('./fixtures/fake-mcp-stdio.mjs', import.meta.url))

async function fixtureProfile() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-connection-'))
  const home = join(dir, 'home')
  const project = join(dir, 'project')
  const patchPath = join(dir, 'profile', 'cordis.patch.yml')
  await mkdir(home, { recursive: true })
  await mkdir(project, { recursive: true })
  await mkdir(join(dir, 'profile'), { recursive: true })
  await writeFile(patchPath, '[]\n')
  return { dir, home, project, patchPath }
}

function runtimeConfig(overrides = {}) {
  return {
    serverName: 'fake',
    transport: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: { FAKE_MCP_CONFIG_TOKEN: 'configured-token' },
    ...overrides,
  }
}

function contextFor(loader, profile) {
  return { loader, profile, liveReload: false, configProjects: [] }
}

function profileOf(fixture) {
  return { name: 'test', patchPath: fixture.patchPath, home: fixture.home, cwd: fixture.project }
}

test('tests a DSH entry with the runtime config resolved by the loader', async () => {
  const fixtureFiles = await fixtureProfile()
  try {
    const config = runtimeConfig()
    const loader = {
      entries: () => [{
        options: { id: 'mcp-fake', name: '@deepseek-ai/dsh-mcp-client', config: { ...config } },
        fiber: { state: 2, config },
      }],
    }
    const result = await testConnection(contextFor(loader, profileOf(fixtureFiles)), { entryId: 'mcp-fake' })
    assert.equal(result.ok, true)
    assert.equal(result.target, 'dsh')
    assert.equal(result.entryId, 'mcp-fake')
    assert.equal(result.connected, true)
    assert.equal(result.serverName, 'fake')
    assert.equal(result.transport, 'stdio')
    assert.equal(result.toolCount, 2)
    assert.equal(result.serverInfo?.name, 'fake-server')
    assert.equal(result.serverInfo?.version, 'configured-token')
  } finally {
    await rm(fixtureFiles.dir, { recursive: true, force: true })
  }
})

test('refuses to test a patch entry whose command is a !!js expression', async () => {
  const fixtureFiles = await fixtureProfile()
  try {
    await writeFile(fixtureFiles.patchPath, [
      '- insert:',
      '    - id: mcp-js',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: js',
      '        transport: stdio',
      '        command: !!js process.env.MCP_COMMAND',
      '',
    ].join('\n'))
    const result = await testConnection(contextFor({ entries: () => [] }, profileOf(fixtureFiles)), { entryId: 'mcp-js' })
    assert.equal(result.connected, false)
    assert.equal(result.error?.code, 'unresolved')
  } finally {
    await rm(fixtureFiles.dir, { recursive: true, force: true })
  }
})

test('tests a scanned project MCP by its source key', async () => {
  const fixtureFiles = await fixtureProfile()
  try {
    await writeFile(join(fixtureFiles.project, '.mcp.json'), JSON.stringify({
      mcpServers: {
        fake: {
          command: process.execPath,
          args: [fixture],
          env: { FAKE_MCP_CONFIG_TOKEN: 'configured-token' },
        },
      },
    }))
    await writeProjects(fixtureFiles.home, [fixtureFiles.project])
    const loader = { entries: () => [] }
    const context = contextFor(loader, profileOf(fixtureFiles))
    const scan = await scanAll({
      loader,
      profile: profileOf(fixtureFiles),
      savedProjects: [fixtureFiles.project],
      configProjects: [],
      liveReload: false,
    })
    const server = scan.response.projects[0]?.sources.flatMap(group => group.servers)
      .find(item => item.name === 'fake')
    assert.ok(server)
    const result = await testConnection(context, { key: server.key })
    assert.equal(result.target, 'source')
    assert.equal(result.key, server.key)
    assert.equal(result.connected, true)
    assert.equal(result.toolCount, 2)
  } finally {
    await rm(fixtureFiles.dir, { recursive: true, force: true })
  }
})

test('rejects a request that names no target or two targets', async () => {
  const fixtureFiles = await fixtureProfile()
  try {
    const context = contextFor({ entries: () => [] }, profileOf(fixtureFiles))
    await assert.rejects(testConnection(context, {}), (error) => {
      assert.ok(error instanceof ActionError)
      assert.equal(error.status, 400)
      return true
    })
    await assert.rejects(testConnection(context, { entryId: 'mcp-fake', key: 'abc' }), (error) => {
      assert.ok(error instanceof ActionError)
      assert.equal(error.status, 400)
      return true
    })
  } finally {
    await rm(fixtureFiles.dir, { recursive: true, force: true })
  }
})

test('refuses to test a loader entry that is not an MCP client', async () => {
  const fixtureFiles = await fixtureProfile()
  try {
    const loader = {
      entries: () => [{
        options: { id: 'other-plugin', name: '@deepseek-ai/dsh-other-plugin', config: { command: process.execPath } },
        fiber: { state: 2, config: { command: process.execPath } },
      }],
    }
    await assert.rejects(
      testConnection(contextFor(loader, profileOf(fixtureFiles)), { entryId: 'other-plugin' }),
      (error) => {
        assert.ok(error instanceof ActionError)
        assert.equal(error.status, 404)
        return true
      },
    )
  } finally {
    await rm(fixtureFiles.dir, { recursive: true, force: true })
  }
})
