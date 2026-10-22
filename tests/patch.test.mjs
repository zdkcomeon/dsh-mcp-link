import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  appendMcpRow,
  insertedRows,
  isExpressionValue,
  patchIds,
  readProfilePatch,
  removeMcpRow,
  rowConfig,
  saveProfilePatch,
  updateRowConfig,
} from '../lib/host/patch.js'

test('appends and removes an MCP row while preserving comments and !!js expressions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-patch-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-patch-'))
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

test('updates an MCP config while preserving unchanged !!js values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-link-patch-'))
  const file = join(dir, 'cordis.patch.yml')
  try {
    await writeFile(file, `- insert:
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
        reconnect:
          enabled: false
`)
    const patch = await readProfilePatch(file)
    const row = insertedRows(patch).find(item => item.id === 'mcp-edit')
    assert.ok(row)
    const before = rowConfig(row)
    assert.equal(before.serverName, 'edit')
    assert.deepEqual(before.env, { TOKEN: 'process.env.TOKEN', PLAIN: 'keep' })
    assert.equal(isExpressionValue(row, 'env', 'TOKEN'), true)
    assert.equal(isExpressionValue(row, 'env', 'PLAIN'), false)

    const next = {
      ...before,
      serverName: 'edited',
      command: 'new-command',
      env: { TOKEN: 'process.env.TOKEN', PLAIN: 'changed', NEW: 'value' },
      toolCallTimeoutMs: 60000,
    }
    updateRowConfig(patch, row, next)
    await saveProfilePatch(patch)
    const text = await readFile(file, 'utf8')
    assert.match(text, /!!js process\.env\.TOKEN/u)
    assert.match(text, /serverName: edited/u)
    assert.match(text, /NEW: value/u)
    assert.match(text, /reconnect:/u)
    assert.match(text, /enabled: false/u)

    const saved = await readProfilePatch(file)
    const savedRow = insertedRows(saved).find(item => item.id === 'mcp-edit')
    assert.ok(savedRow)
    const after = rowConfig(savedRow)
    assert.deepEqual(after.env, { TOKEN: 'process.env.TOKEN', PLAIN: 'changed', NEW: 'value' })
    assert.equal(isExpressionValue(savedRow, 'env', 'TOKEN'), true)

    const replaced = {
      ...after,
      env: { TOKEN: 'literal-token', PLAIN: 'changed', NEW: 'value' },
    }
    updateRowConfig(saved, savedRow, replaced)
    await saveProfilePatch(saved)
    const literal = await readFile(file, 'utf8')
    assert.doesNotMatch(literal, /!!js process\.env\.TOKEN/u)
    assert.match(literal, /TOKEN: literal-token/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
