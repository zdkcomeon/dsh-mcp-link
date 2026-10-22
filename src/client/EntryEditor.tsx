/** 编辑一条已接入 DSH 的 MCP 连接配置。 */
import { useState } from 'react'
import { Button, Input, Modal, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EditableEntry, EditablePair, EditablePairInput, EntrySettings } from '../protocol.js'
import type { McpSettingsSectionProps } from './Section.js'

/** 编辑弹窗的 props。 */
export interface EntryEditorProps {
  readonly entry: EditableEntry
  readonly busy: boolean
  readonly t: McpSettingsSectionProps['t']
  /** create 使用空条目；edit 使用当前条目。 */
  readonly mode?: 'create' | 'edit'
  readonly onClose: () => void
  readonly onSave: (settings: EntrySettings) => Promise<boolean>
}

interface PairDraft {
  readonly id: string
  key: string
  /** 原始键；新增行为 null。 */
  originalKey: string | null
  value: string
  secret: boolean
  expression: boolean
  existing: boolean
}

let pairSeq = 0

function draftOf(pair: EditablePair): PairDraft {
  pairSeq += 1
  return {
    id: `pair-${String(pairSeq)}`,
    key: pair.key,
    originalKey: pair.key,
    value: pair.value ?? '',
    secret: pair.secret,
    expression: pair.expression === true,
    existing: true,
  }
}

function emptyDraft(): PairDraft {
  pairSeq += 1
  return {
    id: `pair-${String(pairSeq)}`,
    key: '',
    originalKey: null,
    value: '',
    secret: false,
    expression: false,
    existing: false,
  }
}

function looksSecret(key: string): boolean {
  return /(?:token|secret|password|passwd|api[-_]?key|authorization|auth[-_]?key|credential|cookie|session[-_]?id|private[-_]?key|(?:^|[-_])key(?:$|[-_]))/iu.test(key)
}

/**
 * 编辑 MCP 的连接参数；未知字段由 Host 原样保留。
 * @param props - 当前条目、保存状态与动作。
 * @returns 编辑弹窗。
 */
export function EntryEditor(props: EntryEditorProps) {
  const { entry, busy, t, mode = 'edit', onClose, onSave } = props
  const creating = mode === 'create'
  const [serverName, setServerName] = useState(entry.serverName)
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>(entry.transport)
  const [command, setCommand] = useState(entry.command ?? '')
  const [argsText, setArgsText] = useState((entry.args ?? []).join('\n'))
  const [cwd, setCwd] = useState(entry.cwd ?? '')
  const [url, setUrl] = useState(entry.url ?? '')
  const [timeoutText, setTimeoutText] = useState(entry.toolCallTimeoutMs === undefined ? '' : String(entry.toolCallTimeoutMs))
  const [env, setEnv] = useState<PairDraft[]>(() => entry.env.map(draftOf))
  const [headers, setHeaders] = useState<PairDraft[]>(() => entry.headers.map(draftOf))
  const [error, setError] = useState('')

  const validatePairs = (pairs: readonly PairDraft[], label: string): string | undefined => {
    const keys = new Set<string>()
    for (const pair of pairs) {
      const key = pair.key.trim()
      if (key === '') return `${label}: ${t('key')} ${t('empty')}`
      if (keys.has(key)) return `${label}: ${key} ${t('duplicate')}`
      keys.add(key)
    }
    return undefined
  }

  const submit = async () => {
    setError('')
    if (!/^[A-Za-z0-9_-]{1,32}$/u.test(serverName.trim())) {
      setError(t('serverNameHint'))
      return
    }
    if (transport === 'stdio' && command.trim() === '') {
      setError(t('invalidCommand'))
      return
    }
    if (transport === 'streamable-http') {
      try {
        const parsed = new URL(url.trim())
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
      } catch {
        setError(t('invalidUrl'))
        return
      }
    }
    const timeout = timeoutText.trim() === '' ? undefined : Number(timeoutText)
    if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0)) {
      setError(t('invalidTimeout'))
      return
    }
    const pairError = validatePairs(env, t('env')) ?? validatePairs(headers, t('headers'))
    if (pairError !== undefined) {
      setError(pairError)
      return
    }
    const pairInput = (pairs: readonly PairDraft[]): EditablePairInput[] => pairs.map(pair => {
      const key = pair.key.trim()
      const keep = pair.existing && pair.key.trim() === pair.originalKey
        && (pair.secret || looksSecret(key)) && pair.value === ''
      return keep ? { key } : { key, value: pair.value }
    })
    const settings: EntrySettings = {
      serverName: serverName.trim(),
      transport,
      env: pairInput(env),
      headers: pairInput(headers),
      ...(transport === 'stdio'
        ? {
          command: command.trim(),
          args: argsText.split('\n').map(line => line.trim()).filter(line => line !== ''),
          ...(cwd.trim() === '' ? {} : { cwd: cwd.trim() }),
        }
        : { url: url.trim() }),
      ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
    }
    const ok = await onSave(settings)
    if (!ok) setError(t('error'))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={creating ? t('addMcpTitle') : t('editTitle')}
      closeLabel={t('close')}
      description={creating ? t('addMcpDescription') : t('editDescription')}
      contentClassName="dsh-mcp-editor-content"
      footer={(
        <div className="dsh-mcp-dialog-actions">
          <Button size="md" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button size="md" variant="primary" disabled={busy} onClick={() => { void submit() }}>
            {busy ? t('saving') : creating ? t('create') : t('save')}
          </Button>
        </div>
      )}
    >
      <div className="dsh-mcp-editor">
        <label className="dsh-mcp-field">
          <span className="dsh-mcp-field-label">{t('serverName')}</span>
          <Input value={serverName} onChange={event => { setServerName(event.currentTarget.value) }} />
          <span className="dsh-mcp-field-hint">{t('serverNameHint')}</span>
        </label>
        <div className="dsh-mcp-field">
          <span className="dsh-mcp-field-label">{t('transport')}</span>
          <SegmentedControl
            id="dsh-mcp-entry-transport"
            value={transport}
            options={[
              { value: 'stdio', label: 'stdio' },
              { value: 'streamable-http', label: 'streamable-http' },
            ]}
            onChange={value => { setTransport(value) }}
            label={t('transport')}
          />
        </div>
        {transport === 'stdio' ? (
          <>
            <label className="dsh-mcp-field">
              <span className="dsh-mcp-field-label">{t('command')}</span>
              <Input value={command} onChange={event => { setCommand(event.currentTarget.value) }} />
            </label>
            <label className="dsh-mcp-field">
              <span className="dsh-mcp-field-label">{t('args')}</span>
              <textarea
                className="dsh-mcp-textarea"
                rows={4}
                value={argsText}
                onChange={event => { setArgsText(event.currentTarget.value) }}
              />
              <span className="dsh-mcp-field-hint">{t('argsHint')}</span>
            </label>
            <label className="dsh-mcp-field">
              <span className="dsh-mcp-field-label">{t('cwd')}</span>
              <Input value={cwd} onChange={event => { setCwd(event.currentTarget.value) }} />
            </label>
            <PairEditor
              title={t('env')}
              hint={t('pairHint')}
              addLabel={t('addEnv')}
              pairs={env}
              setPairs={setEnv}
              t={t}
            />
          </>
        ) : (
          <>
            <label className="dsh-mcp-field">
              <span className="dsh-mcp-field-label">{t('url')}</span>
              <Input value={url} placeholder="https://example.com/mcp" onChange={event => { setUrl(event.currentTarget.value) }} />
            </label>
            <PairEditor
              title={t('headers')}
              hint={t('pairHint')}
              addLabel={t('addHeader')}
              pairs={headers}
              setPairs={setHeaders}
              t={t}
            />
          </>
        )}
        <label className="dsh-mcp-field">
          <span className="dsh-mcp-field-label">{t('timeout')}</span>
          <Input
            value={timeoutText}
            inputMode="numeric"
            placeholder={t('timeoutHint')}
            onChange={event => { setTimeoutText(event.currentTarget.value) }}
          />
          <span className="dsh-mcp-field-hint">{t('timeoutHint')}</span>
        </label>
        {error !== '' && <div className="dsh-mcp-dialog-error">{error}</div>}
      </div>
    </Modal>
  )
}

function PairEditor(props: {
  readonly title: string
  readonly hint: string
  readonly addLabel: string
  readonly pairs: readonly PairDraft[]
  readonly setPairs: (pairs: PairDraft[]) => void
  readonly t: McpSettingsSectionProps['t']
}) {
  const { title, hint, addLabel, pairs, setPairs, t } = props
  const update = (id: string, change: Partial<PairDraft>) => {
    setPairs(pairs.map(pair => pair.id === id ? { ...pair, ...change } : pair))
  }
  return (
    <div className="dsh-mcp-field">
      <div className="dsh-mcp-field-head">
        <span className="dsh-mcp-field-label">{title}</span>
        <Button size="sm" variant="ghost" onClick={() => { setPairs([...pairs, emptyDraft()]) }}>
          {addLabel}
        </Button>
      </div>
      <span className="dsh-mcp-field-hint">{hint}</span>
      <div className="dsh-mcp-pair-list">
        {pairs.map(pair => {
          const secret = pair.secret || looksSecret(pair.key)
          return (
            <div className="dsh-mcp-pair-row" key={pair.id}>
              <Input
                value={pair.key}
                placeholder={t('key')}
                aria-label={`${title} ${t('key')}`}
                onChange={event => { update(pair.id, { key: event.currentTarget.value }) }}
              />
              <Input
                value={pair.value}
                type={secret ? 'password' : 'text'}
                placeholder={pair.existing && secret ? t('secretKeep') : t('value')}
                aria-label={`${title} ${t('value')}`}
                onChange={event => { update(pair.id, { value: event.currentTarget.value }) }}
              />
              {pair.expression ? <Tag tone="quiet">{t('expression')}</Tag> : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setPairs(pairs.filter(item => item.id !== pair.id)) }}
              >
                {t('removePair')}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
