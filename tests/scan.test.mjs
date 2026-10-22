import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { scanAll, validateProjectPath } from '../lib/host/scan.js'

test('scans a project config, redacts secrets, and matches a loaded DSH MCP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-scan-'))
  const home = join(dir, 'home')
  const project = join(dir, 'project')
  const profile = join(home, 'profiles', 'test')
  try {
    await mkdir(project, { recursive: true })
    await mkdir(profile, { recursive: true })
    await writeFile(join(project, '.mcp.json'), JSON.stringify({
      mcpServers: {
        files: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: { API_TOKEN: 'super-secret' },
        },
      },
    }))
    const patchPath = join(profile, 'cordis.patch.yml')
    await writeFile(patchPath, '[]\n')

    const loader = {
      entries: () => [{
        options: {
          id: 'mcp-files',
          name: '@deepseek-ai/dsh-mcp-client',
          config: {
            serverName: 'files',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: { API_TOKEN: 'super-secret' },
          },
        },
        disabled: false,
      }],
    }
    const result = await scanAll({
      loader,
      profile: { name: 'test', patchPath, home, cwd: project },
      savedProjects: [project],
      configProjects: [],
      liveReload: true,
    })
    assert.equal(result.response.profile.name, 'test')
    assert.equal(result.response.profile.reload, 'live')
    assert.equal(result.response.dsh.length, 1)
    assert.equal(result.response.dsh[0]?.serverName, 'files')

    const projectScan = result.response.projects.find(item => item.path === project)
    assert.ok(projectScan)
    const projectSource = projectScan.sources.find(source => source.sourceId === 'claude-project')
    assert.ok(projectSource)
    const files = projectSource.servers.find(server => server.name === 'files')
    assert.ok(files)
    assert.equal(files.linkedEntryId, 'mcp-files')
    assert.deepEqual(files.secretEnvKeys, ['API_TOKEN'])
    assert.equal(JSON.stringify(result.response).includes('super-secret'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('marks a same-name different-connection DSH entry as a name conflict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-scan-'))
  const home = join(dir, 'home')
  const project = join(dir, 'project')
  const profile = join(home, 'profiles', 'test')
  try {
    await mkdir(project, { recursive: true })
    await mkdir(profile, { recursive: true })
    await writeFile(join(project, '.mcp.json'), JSON.stringify({
      mcpServers: { files: { command: 'npx', args: ['other-server'] } },
    }))
    const patchPath = join(profile, 'cordis.patch.yml')
    await writeFile(patchPath, '[]\n')
    const result = await scanAll({
      loader: {
        entries: () => [{
          options: {
            id: 'mcp-old',
            name: '@deepseek-ai/dsh-mcp-client',
            config: {
              serverName: 'files',
              transport: 'stdio',
              command: 'npx',
              args: ['old-server'],
            },
          },
        }],
      },
      profile: { name: 'test', patchPath, home, cwd: project },
      savedProjects: [project],
      configProjects: [],
      liveReload: false,
    })
    const files = result.response.projects[0]?.sources
      .flatMap(source => source.servers)
      .find(server => server.name === 'files')
    assert.ok(files)
    assert.equal(files.linkedEntryId, undefined)
    assert.equal(files.nameConflictEntryId, 'mcp-old')
    assert.equal(files.suggestedName, 'files-2')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects a missing project path', async () => {
  const result = await validateProjectPath('/definitely/not/a/real/path')
  assert.ok('error' in result)
})

test('resolves project workspace placeholders and keeps unresolved input variables blocked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-scan-'))
  const home = join(dir, 'home')
  const project = join(dir, 'project')
  const profile = join(home, 'profiles', 'test')
  try {
    await mkdir(project, { recursive: true })
    await mkdir(profile, { recursive: true })
    await writeFile(join(project, '.mcp.json'), JSON.stringify({
      mcpServers: {
        local: { command: 'node', args: ['${workspaceFolder}/server.js'] },
        needsInput: { command: 'node', args: ['${input:token}'] },
      },
    }))
    const patchPath = join(profile, 'cordis.patch.yml')
    await writeFile(patchPath, '[]\n')
    const result = await scanAll({
      loader: { entries: () => [] },
      profile: { name: 'test', patchPath, home, cwd: project },
      savedProjects: [project],
      configProjects: [],
      liveReload: false,
    })
    const servers = result.response.projects[0]?.sources.flatMap(source => source.servers) ?? []
    const local = servers.find(server => server.name === 'local')
    assert.deepEqual(local?.args, [`${project}/server.js`])
    assert.equal(local?.unsupported, undefined)
    const needsInput = servers.find(server => server.name === 'needsInput')
    assert.match(String(needsInput?.unsupported), /input/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
