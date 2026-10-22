import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  appendMcpRow,
  insertedRows,
  patchIds,
  readProfilePatch,
  removeMcpRow,
  saveProfilePatch,
} from '../lib/host/patch.js'

test('appends and removes an MCP row while preserving comments and !!js expressions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-setting-patch-'))
  const file = join(dir, 'cordis.patch.yml')
  try {
    await writeFile(file, `# keep this comment
- id: existing
  name: existing-plugin
  config:
    value: !!js process.env.EXAMPLE
`)
    const patch = await readProfilePatch(file)
    assert.deepEqual([...patchIds(patch)].sort(), ['existing'])
    assert.equal(insertedRows(patch).length, 0)

    appendMcpRow(patch, {
      id: 'mcp-link-files',
      serverName: 'files',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-filesystem', '/tmp'],
      env: { TOKEN: 'secret' },
    })
    await saveProfilePatch(patch)

    const text = await readFile(file, 'utf8')
    assert.match(text, /keep this comment/u)
    assert.match(text, /!!js process\.env\.EXAMPLE/u)
    assert.match(text, /mcp-link-files/u)
    assert.match(text, /serverName: files/u)

    const saved = await readProfilePatch(file)
    const rows = insertedRows(saved)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, 'mcp-link-files')
    assert.deepEqual([...patchIds(saved)].sort(), ['existing', 'mcp-link-files'])

    assert.equal(removeMcpRow(saved, 'mcp-link-files'), true)
    await saveProfilePatch(saved)
    const after = await readFile(file, 'utf8')
    assert.doesNotMatch(after, /mcp-link-files/u)
    assert.match(after, /!!js process\.env\.EXAMPLE/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('appends into an existing insert sequence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-setting-patch-'))
  const file = join(dir, 'cordis.patch.yml')
  try {
    await writeFile(file, `- insert:
    - id: mcp-one
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: one
        transport: stdio
        command: one
`)
    const patch = await readProfilePatch(file)
    appendMcpRow(patch, {
      id: 'mcp-link-two',
      serverName: 'two',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    })
    await saveProfilePatch(patch)
    const saved = await readProfilePatch(file)
    assert.deepEqual(insertedRows(saved).map(row => row.id), ['mcp-one', 'mcp-link-two'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
