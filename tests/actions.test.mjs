import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ActionError, entryDetail, linkServer, unlinkServer, updateEntry } from '../lib/host/actions.js'
import { scanAll } from '../lib/host/scan.js'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-setting-actions-'))
  const home = join(dir, 'home')
  const project = join(dir, 'project')
  const profile = join(home, 'profiles', 'test')
  await mkdir(project, { recursive: true })
  await mkdir(profile, { recursive: true })
  await mkdir(join(home, 'mcp-setting'), { recursive: true })
  await writeFile(join(project, '.mcp.json'), JSON.stringify({
    mcpServers: {
      files: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { TOKEN: 'secret' },
      },
    },
  }))
  await writeFile(join(home, 'mcp-setting', 'state.json'), JSON.stringify({
    version: 1,
    projects: [project],
  }))
  const patchPath = join(profile, 'cordis.patch.yml')
  await writeFile(patchPath, '[]\n')
  return { dir, home, project, patchPath }
}

test('links a scanned project MCP into the profile patch and unlinks it again', async () => {
  const f = await fixture()
  try {
    const loaderState = { entries: [] }
    const loader = { entries: () => loaderState.entries }
    const profile = { name: 'test', patchPath: f.patchPath, home: f.home, cwd: f.project }
    const scan = await scanAll({
      loader,
      profile,
      savedProjects: [f.project],
      configProjects: [],
      liveReload: false,
    })
    const server = scan.response.projects[0]?.sources
      .flatMap(source => source.servers)
      .find(item => item.name === 'files')
    assert.ok(server)
    const result = await linkServer({
      loader,
      profile,
      liveReload: false,
      configProjects: [],
    }, { key: server.key, serverName: 'project-files' })
    assert.equal(result.serverName, 'project-files')
    assert.equal(result.restartRequired, true)
    const text = await readFile(f.patchPath, 'utf8')
    assert.match(text, /project-files/u)
    assert.match(text, /server-filesystem/u)
    assert.match(text, /TOKEN/u)
    assert.doesNotMatch(text, /specialName/u)

    const unlink = await unlinkServer({
      loader,
      profile,
      liveReload: false,
      configProjects: [],
    }, result.entryId)
    assert.equal(unlink.restartRequired, true)
    const after = await readFile(f.patchPath, 'utf8')
    assert.doesNotMatch(after, /project-files/u)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('refuses a duplicate DSH server name', async () => {
  const f = await fixture()
  try {
    const loader = {
      entries: () => [{
        options: {
          id: 'existing',
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 'taken', transport: 'stdio', command: 'npx', args: ['x'] },
        },
      }],
    }
    const profile = { name: 'test', patchPath: f.patchPath, home: f.home, cwd: f.project }
    const scan = await scanAll({
      loader,
      profile,
      savedProjects: [f.project],
      configProjects: [],
      liveReload: false,
    })
    const server = scan.response.projects[0]?.sources
      .flatMap(source => source.servers)
      .find(item => item.name === 'files')
    assert.ok(server)
    await assert.rejects(
      () => linkServer({ loader, profile, liveReload: false, configProjects: [] }, {
        key: server.key,
        serverName: 'taken',
      }),
      error => error instanceof ActionError && error.code === 'name-conflict',
    )
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('refuses to unlink an entry that is not inserted by the profile patch', async () => {
  const f = await fixture()
  try {
    const profile = { name: 'test', patchPath: f.patchPath, home: f.home, cwd: f.project }
    const loader = { entries: () => [] }
    await assert.rejects(
      () => unlinkServer({ loader, profile, liveReload: false, configProjects: [] }, 'mcp-missing'),
      error => error instanceof ActionError && error.code === 'not-editable',
    )
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('reads and updates an editable MCP without exposing secret values', async () => {
  const f = await fixture()
  try {
    await writeFile(f.patchPath, `- insert:
    - id: mcp-edit
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: edit
        transport: stdio
        command: old-command
        env:
          TOKEN: !!js process.env.TOKEN
          PLAIN: keep
        toolCallTimeoutMs: 120000
`)
    const loader = { entries: () => [] }
    const context = { loader, profile: { name: 'test', patchPath: f.patchPath, home: f.home, cwd: f.project }, liveReload: false, configProjects: [] }
    const detail = await entryDetail(context, 'mcp-edit')
    assert.equal(detail.entry.serverName, 'edit')
    assert.equal(detail.entry.transport, 'stdio')
    assert.equal(detail.entry.toolCallTimeoutMs, 120000)
    const token = detail.entry.env.find(pair => pair.key === 'TOKEN')
    assert.equal(token?.secret, true)
    assert.equal(token?.value, undefined)
    assert.equal(token?.expression, true)
    assert.equal(detail.entry.env.find(pair => pair.key === 'PLAIN')?.value, 'keep')

    const updated = await updateEntry(context, {
      entryId: 'mcp-edit',
      serverName: 'edited',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      cwd: '/tmp/project',
      env: [
        { key: 'TOKEN' },
        { key: 'PLAIN', value: 'changed' },
        { key: 'NEW', value: 'value' },
      ],
      headers: [],
      toolCallTimeoutMs: 60000,
    })
    assert.equal(updated.restartRequired, true)
    const text = await readFile(f.patchPath, 'utf8')
    assert.match(text, /!!js process\.env\.TOKEN/u)
    assert.match(text, /serverName: edited/u)
    assert.match(text, /command: node/u)
    assert.match(text, /PLAIN: changed/u)
    assert.match(text, /NEW: value/u)
    assert.match(text, /cwd: \/tmp\/project/u)
    assert.match(text, /toolCallTimeoutMs: 60000/u)

    await updateEntry(context, {
      entryId: 'mcp-edit',
      serverName: 'edited',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      env: [],
      headers: [{ key: 'Authorization', value: 'Bearer secret' }],
    })
    const httpText = await readFile(f.patchPath, 'utf8')
    assert.match(httpText, /transport: streamable-http/u)
    assert.match(httpText, /url: https:\/\/example\.com\/mcp/u)
    assert.match(httpText, /Authorization: Bearer secret/u)
    assert.doesNotMatch(httpText, /command: node/u)
    assert.doesNotMatch(httpText, /cwd:/u)
    assert.doesNotMatch(httpText, /env:/u)
    const httpDetail = await entryDetail(context, 'mcp-edit')
    assert.equal(httpDetail.entry.transport, 'streamable-http')
    assert.equal(httpDetail.entry.headers.find(pair => pair.key === 'Authorization')?.secret, true)
    assert.equal(httpDetail.entry.headers.find(pair => pair.key === 'Authorization')?.value, undefined)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('refuses to rename an MCP onto another DSH server name', async () => {
  const f = await fixture()
  try {
    await writeFile(f.patchPath, `- insert:
    - id: mcp-one
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: one
        transport: stdio
        command: one
    - id: mcp-two
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: two
        transport: stdio
        command: two
`)
    const context = {
      loader: { entries: () => [] },
      profile: { name: 'test', patchPath: f.patchPath, home: f.home, cwd: f.project },
      liveReload: false,
      configProjects: [],
    }
    await assert.rejects(
      () => updateEntry(context, {
        entryId: 'mcp-one',
        serverName: 'two',
        transport: 'stdio',
        command: 'one',
        env: [],
        headers: [],
      }),
      error => error instanceof ActionError && error.code === 'name-conflict',
    )
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})
