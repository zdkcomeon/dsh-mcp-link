import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ActionError, linkServer, unlinkServer } from '../lib/host/actions.js'
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
