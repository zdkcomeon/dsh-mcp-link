/** 从 JSON 导入一条 MCP。 */
import { useEffect, useState } from 'react'
import { Button, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CreateEntryRequest } from '../protocol.js'
import { parseMcpJson } from './import-json.js'
import type { McpSettingsSectionProps } from './Section.js'

/** JSON 导入弹窗的 props。 */
export interface JsonImportDialogProps {
  readonly busy: boolean
  readonly t: McpSettingsSectionProps['t']
  readonly onClose: () => void
  readonly onImport: (request: CreateEntryRequest) => Promise<boolean>
}

/**
 * 渲染 JSON 导入弹窗。
 * @param props - 保存状态、文案与导入动作。
 * @returns 弹窗。
 */
export function JsonImportDialog(props: JsonImportDialogProps) {
  const { busy, t, onClose, onImport } = props
  const [jsonText, setJsonText] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [parsed, setParsed] = useState<CreateEntryRequest | undefined>(undefined)
  const [parseError, setParseError] = useState('')
  const [importError, setImportError] = useState('')

  useEffect(() => {
    if (jsonText.trim() === '') {
      setParsed(undefined)
      setParseError('')
      return
    }
    try {
      const result = parseMcpJson(jsonText)
      setParsed(result)
      setParseError('')
      if (!nameEdited) setName(result.serverName)
    } catch (error) {
      setParsed(undefined)
      setParseError(error instanceof Error ? error.message : String(error))
    }
  }, [jsonText, nameEdited])

  const submit = async () => {
    setImportError('')
    if (parsed === undefined) {
      setImportError(parseError === '' ? t('jsonParseFailed') : parseError)
      return
    }
    const serverName = name.trim() === '' ? parsed.serverName : name.trim()
    if (serverName === '') {
      setImportError(t('jsonNameRequired'))
      return
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/u.test(serverName)) {
      setImportError(t('serverNameHint'))
      return
    }
    const ok = await onImport({ ...parsed, serverName })
    if (!ok) setImportError(t('error'))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('importJson')}
      closeLabel={t('close')}
      description={t('jsonHint')}
      contentClassName="dsh-mcp-editor-content"
      footer={(
        <div className="dsh-mcp-dialog-actions">
          <Button size="md" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button size="md" variant="primary" disabled={busy || parsed === undefined} onClick={() => { void submit() }}>
            {busy ? t('saving') : t('import')}
          </Button>
        </div>
      )}
    >
      <div className="dsh-mcp-editor">
        <label className="dsh-mcp-field">
          <span className="dsh-mcp-field-label">{t('serverName')}</span>
          <Input
            value={name}
            onChange={event => {
              setName(event.currentTarget.value)
              setNameEdited(true)
            }}
          />
          <span className="dsh-mcp-field-hint">{t('serverNameHint')}</span>
        </label>
        <label className="dsh-mcp-field">
          <span className="dsh-mcp-field-label">{t('jsonConfig')}</span>
          <textarea
            className="dsh-mcp-textarea dsh-mcp-json-input"
            rows={8}
            value={jsonText}
            placeholder={`{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "some-mcp-server"]\n    }\n  }\n}`}
            onChange={event => { setJsonText(event.currentTarget.value) }}
          />
        </label>
        {parseError !== '' && (
          <div className="dsh-mcp-dialog-error">{parseError}</div>
        )}
        {parsed !== undefined && (
          <div className="dsh-mcp-import-preview">
            <div className="dsh-mcp-row-title">
              <Tag tone="outline">{parsed.transport}</Tag>
              <span className="dsh-mcp-code">
                {parsed.command !== undefined
                  ? [parsed.command, ...(parsed.args ?? [])].join(' ')
                  : parsed.url}
              </span>
            </div>
            <div className="dsh-mcp-row-meta">
              {parsed.env.length > 0 && (
                <span>{t('env')}: {parsed.env.map(pair => pair.key).join(', ')}</span>
              )}
              {parsed.headers.length > 0 && (
                <span>{t('headers')}: {parsed.headers.map(pair => pair.key).join(', ')}</span>
              )}
            </div>
          </div>
        )}
        {importError !== '' && <div className="dsh-mcp-dialog-error">{importError}</div>}
      </div>
    </Modal>
  )
}
