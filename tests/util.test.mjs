import assert from 'node:assert/strict'
import test from 'node:test'
import { looksSecret, redactArgs, redactUrl } from '../lib/host/util.js'

test('marks credential-like keys as secret', () => {
  for (const key of ['API_TOKEN', 'Authorization', 'apiKey', 'api-key', 'client_secret', 'key', 'project-key', 'private_key']) {
    assert.equal(looksSecret(key), true, key)
  }
  for (const key of ['NODE_PATH', 'HOME', 'workspace', 'monkey']) {
    assert.equal(looksSecret(key), false, key)
  }
})

test('redacts URL credentials and query values', () => {
  const redacted = redactUrl('https://user:pass@example.com/mcp?key=secret&workspace=main')
  assert.doesNotMatch(redacted, /secret/u)
  assert.doesNotMatch(redacted, /user:pass/u)
  assert.match(redacted, /workspace=main/u)
})

test('redacts secret command-line arguments', () => {
  assert.deepEqual(
    redactArgs(['--token', 'abc', '--api-key=xyz', '--verbose']),
    ['--token', '••••••', '--api-key=••••••', '--verbose'],
  )
})
