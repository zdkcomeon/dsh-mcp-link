/** MCP 链接设置页。 */
import { useEffect, useState } from 'react'
import { Button, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DshMcpEntry, EditableEntry, McpSourceGroup, PublicMcpServer, UpdateEntryRequest } from '../protocol.js'
import type { McpSettingsInjected, McpSnapshot, WorkspaceOption } from './controller.js'
import { EntryEditor } from './EntryEditor.js'
import { NS } from './locales.js'
import { WorkspaceSelect } from './WorkspaceSelect.js'

/** 页面 props：运行时关闭设置、locale 文案、注入的数据与动作。 */
export type McpSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<McpSettingsInjected>

/** 单个 MCP 服务行。 */
function ServerRow(props: {
  readonly server: PublicMcpServer
  readonly busy: boolean
  readonly onLink: (server: PublicMcpServer) => void
  readonly t: McpSettingsSectionProps['t']
}) {
  const { server, busy, onLink, t } = props
  const linked = server.linkedEntryId !== undefined
  const blocked = server.unsupported !== undefined || server.disabled === true
  const tags = (
    <div className="dsh-mcp-row-title">
      <span className="dsh-mcp-name">{server.name}</span>
      <Tag tone="outline">{server.transport}</Tag>
      {linked ? <Tag tone="success">{t('linked')}</Tag> : null}
      {!linked && server.unsupported === undefined && server.nameConflictEntryId !== undefined
        ? <Tag tone="warning">{t('nameConflict')}</Tag>
        : null}
      {server.disabled === true ? <Tag tone="quiet">{t('disabled')}</Tag> : null}
    </div>
  )
  return (
    <div className="dsh-mcp-row">
      <div className="dsh-mcp-row-main">
        {tags}
        <div className="dsh-mcp-row-meta">
          {server.command !== undefined && (
            <span className="dsh-mcp-code">
              {t('command')}: {[server.command, ...(server.args ?? [])].join(' ')}
            </span>
          )}
          {server.url !== undefined && <span className="dsh-mcp-code">{t('url')}: {server.url}</span>}
          {server.cwd !== undefined && <span>{t('cwd')}: <span className="dsh-mcp-code">{server.cwd}</span></span>}
          {linked && server.linkedServerName !== undefined && server.linkedServerName !== server.name
            ? <span>DSH: {server.linkedServerName}</span>
            : null}
          {server.envKeys.length > 0 && (
            <span>
              {t('env')}: {server.envKeys.join(', ')}
              {server.secretEnvKeys.length > 0 ? ` (${String(server.secretEnvKeys.length)} ${t('secretHidden')})` : ''}
            </span>
          )}
          {server.headerKeys.length > 0 && (
            <span>
              {t('headers')}: {server.headerKeys.join(', ')}
              {server.secretHeaderKeys.length > 0 ? ` (${String(server.secretHeaderKeys.length)} ${t('secretHidden')})` : ''}
            </span>
          )}
        </div>
        {server.unsupported !== undefined && (
          <div className="dsh-mcp-row-meta" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
            {server.unsupported}
          </div>
        )}
      </div>
      <div className="dsh-mcp-row-actions">
        {linked ? null : (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || blocked}
            title={server.unsupported ?? (server.disabled === true ? t('disabled') : undefined)}
            onClick={() => { onLink(server) }}
          >
            {busy ? t('linking') : t('link')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 一组系统 MCP 来源。 */
function SourceGroup(props: {
  readonly group: McpSourceGroup
  readonly filter: string
  readonly busy: readonly string[]
  readonly onLink: (server: PublicMcpServer) => void
  readonly t: McpSettingsSectionProps['t']
}) {
  const { group, filter, busy, onLink, t } = props
  const servers = group.servers.filter(server => matches(server, filter))
  if (servers.length === 0 && group.error === undefined) return null
  return (
    <details className="dsh-mcp-source" open>
      <summary>
        <div className="dsh-mcp-source-title">
          <span className="dsh-mcp-source-name">{group.label}</span>
          <Tag tone="quiet">{group.scope === 'project' ? t('project') : t('source')}</Tag>
        </div>
        <span className="dsh-mcp-source-path" title={group.path}>{group.path}</span>
      </summary>
      {group.error !== undefined && <div className="dsh-mcp-row dsh-mcp-warning">{group.error}</div>}
      {servers.map(server => (
        <ServerRow
          key={server.key}
          server={server}
          busy={busy.includes(`link:${server.key}`)}
          onLink={onLink}
          t={t}
        />
      ))}
    </details>
  )
}

/** 已接入 DSH 的一行。 */
function DshRow(props: {
  readonly entry: DshMcpEntry
  readonly busy: boolean
  readonly loading: boolean
  readonly onEdit: (entry: DshMcpEntry) => void
  readonly onUnlink: (entry: DshMcpEntry) => void
  readonly t: McpSettingsSectionProps['t']
}) {
  const { entry, busy, loading, onEdit, onUnlink, t } = props
  const source = entry.source === 'profile'
    ? t('fromProfile')
    : entry.source === 'home' ? t('fromHome') : t('fromBundle')
  return (
    <div className="dsh-mcp-row">
      <div className="dsh-mcp-row-main">
        <div className="dsh-mcp-row-title">
          <span className="dsh-mcp-name">{entry.serverName}</span>
          <Tag tone="outline">{entry.transport}</Tag>
          <Tag tone="info">{source}</Tag>
          {entry.managed ? <Tag tone="neutral">{t('managed')}</Tag> : null}
          {!entry.enabled ? <Tag tone="quiet">{t('disabled')}</Tag> : null}
        </div>
        <div className="dsh-mcp-row-meta">
          <span className="dsh-mcp-code">{entry.entryId}</span>
          {entry.command !== undefined && (
            <span className="dsh-mcp-code">
              {[entry.command, ...(entry.args ?? [])].join(' ')}
            </span>
          )}
          {entry.url !== undefined && <span className="dsh-mcp-code">{entry.url}</span>}
          {entry.envKeys.length > 0 && <span>{t('env')}: {entry.envKeys.join(', ')}</span>}
          {entry.headerKeys.length > 0 && <span>{t('headers')}: {entry.headerKeys.join(', ')}</span>}
        </div>
      </div>
      <div className="dsh-mcp-row-actions">
        {entry.editable && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading}
            onClick={() => { onEdit(entry) }}
          >
            {loading ? t('loading') : t('edit')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || loading || !entry.editable}
          title={entry.editable ? undefined : t('notEditable')}
          onClick={() => { onUnlink(entry) }}
        >
          {busy ? t('unlinking') : t('unlink')}
        </Button>
      </div>
    </div>
  )
}

/** 页面主体。 */
export function McpSettingsSection(props: McpSettingsSectionProps) {
  const {
    t, useMcpSettings, refresh, clearNotice, link, unlink, loadEntry, updateEntry,
    setProjectSelected, clearProjects, addProject,
  } = props
  const snapshot: McpSnapshot = useMcpSettings(value => value)
  const [filter, setFilter] = useState('')
  const [pendingLink, setPendingLink] = useState<PublicMcpServer | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [linkError, setLinkError] = useState('')
  const [pendingUnlink, setPendingUnlink] = useState<DshMcpEntry | null>(null)
  const [editing, setEditing] = useState<EditableEntry | null>(null)
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  // 只在挂载时读取一次；不要把注入面函数的身份放进依赖，否则父级重建注入面时会反复触发刷新。
  useEffect(() => { refresh() }, [])

  const data = snapshot.data
  const busy = snapshot.busy
  const filtered = filter.trim().toLowerCase()
  if (snapshot.status === 'loading' && data === undefined) {
    return (
      <section className="dsh-mcp-page" aria-label={t('nav')}>
        <Header t={t} snapshot={snapshot} onRefresh={refresh} />
        <div className="dsh-mcp-loading"><span className="dsh-mcp-spinner" />{t('loading')}</div>
      </section>
    )
  }
  if (snapshot.status === 'error' && data === undefined) {
    return (
      <section className="dsh-mcp-page" aria-label={t('nav')}>
        <Header t={t} snapshot={snapshot} onRefresh={refresh} />
        <div className="dsh-mcp-warning">
          <strong>{t('loadFailed')}</strong>
          <span>{snapshot.error}</span>
          <div><Button size="sm" variant="outline" onClick={refresh}>{t('retry')}</Button></div>
        </div>
      </section>
    )
  }
  if (data === undefined) return null

  const systemCount = data.system.reduce((sum, group) => sum + group.servers.length, 0)
  const projectCount = data.projects.reduce(
    (sum, project) => sum + project.sources.reduce((inner, group) => inner + group.servers.length, 0),
    0,
  )
  const linkedCount = [...data.system, ...data.projects.flatMap(project => project.sources)]
    .reduce((sum, group) => sum + group.servers.filter(server => server.linkedEntryId !== undefined).length, 0)
  const openLink = (server: PublicMcpServer) => {
    setPendingLink(server)
    setPendingName(server.suggestedName)
    setLinkError('')
  }
  const closeLink = () => {
    setPendingLink(null)
    setLinkError('')
  }
  const confirmLink = async () => {
    if (pendingLink === null) return
    const name = pendingName.trim()
    if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name)) {
      setLinkError(t('serverNameHint'))
      return
    }
    const ok = await link(pendingLink.key, name)
    if (ok) closeLink()
    else setLinkError(t('error'))
  }
  const confirmUnlink = async () => {
    if (pendingUnlink === null) return
    const ok = await unlink(pendingUnlink.entryId)
    if (ok) setPendingUnlink(null)
  }
  const openEditor = async (entry: DshMcpEntry) => {
    setEditLoadingId(entry.entryId)
    setEditError('')
    try {
      setEditing(await loadEntry(entry.entryId))
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error))
    } finally {
      setEditLoadingId(null)
    }
  }
  const saveEntry = async (request: UpdateEntryRequest): Promise<boolean> => {
    const ok = await updateEntry(request)
    if (ok) setEditing(null)
    return ok
  }
  const notice = noticeOf(snapshot, t)
  const systemGroups = data.system
    .map(group => ({ group, servers: group.servers.filter(server => matches(server, filtered)) }))
    .filter(item => item.servers.length > 0 || (filtered === '' && item.group.error !== undefined))

  return (
    <section className="dsh-mcp-page" aria-label={t('nav')}>
      <Header t={t} snapshot={snapshot} onRefresh={refresh} />
      {notice !== undefined && (
        <div className="dsh-mcp-notice" data-kind={notice.kind}>
          <span className="dsh-mcp-notice-text">{notice.text}</span>
          <Button size="sm" variant="ghost" onClick={clearNotice}>{t('close')}</Button>
        </div>
      )}
      {editError !== '' && (
        <div className="dsh-mcp-warning">
          <strong>{t('editLoadFailed')}</strong>
          <span>{editError}</span>
          <div><Button size="sm" variant="outline" onClick={() => { setEditError('') }}>{t('close')}</Button></div>
        </div>
      )}
      <div className="dsh-mcp-stats">
        <span className="dsh-mcp-stat"><strong>{data.dsh.length}</strong>{t('dshSection')}</span>
        <span className="dsh-mcp-stat"><strong>{systemCount}</strong>{t('systemSection')}</span>
        <span className="dsh-mcp-stat"><strong>{projectCount}</strong>{t('projectSection')}</span>
        <span className="dsh-mcp-stat"><strong>{linkedCount}</strong>{t('linkedCount')}</span>
        <span className="dsh-mcp-stat">
          {data.profile.name} · {data.profile.reload === 'live' ? t('reloadLive') : t('reloadRestart')}
        </span>
      </div>
      {data.warnings.length > 0 && (
        <details className="dsh-mcp-warning">
          <summary>{t('warnings')} ({data.warnings.length})</summary>
          {data.warnings.map((warning, index) => <div key={`${String(index)}:${warning}`}>{warning}</div>)}
        </details>
      )}
      <div className="dsh-mcp-toolbar-row">
        <Input
          className="dsh-mcp-search"
          value={filter}
          placeholder={t('searchPlaceholder')}
          onChange={event => { setFilter(event.currentTarget.value) }}
          aria-label={t('searchPlaceholder')}
        />
      </div>

      <section className="dsh-mcp-section">
        <div className="dsh-mcp-section-head">
          <h2 className="dsh-mcp-section-title">{t('dshSection')}</h2>
          <span className="dsh-mcp-section-count">{data.dsh.length} {t('servers')}</span>
        </div>
        {data.dsh.length === 0
          ? <div className="dsh-mcp-empty">{t('dshEmpty')}</div>
          : (
            <div className="dsh-mcp-card">
              {data.dsh.map(entry => (
                <DshRow
                  key={entry.entryId}
                  entry={entry}
                  busy={busy.includes(`unlink:${entry.entryId}`) || busy.includes(`update:${entry.entryId}`)}
                  loading={editLoadingId === entry.entryId}
                  onEdit={entryToEdit => { void openEditor(entryToEdit) }}
                  onUnlink={setPendingUnlink}
                  t={t}
                />
              ))}
            </div>
          )}
      </section>

      <section className="dsh-mcp-section">
        <div className="dsh-mcp-section-head">
          <h2 className="dsh-mcp-section-title">{t('systemSection')}</h2>
          <span className="dsh-mcp-section-count">{systemCount} {t('servers')}</span>
        </div>
        {systemGroups.length === 0
          ? <div className="dsh-mcp-empty">{filtered === '' ? t('systemEmpty') : t('noMatches')}</div>
          : (
            <div className="dsh-mcp-card">
              {systemGroups.map(item => (
                <SourceGroup
                  key={item.group.sourceId + item.group.path}
                  group={{ ...item.group, servers: item.servers }}
                  filter={filtered}
                  busy={busy}
                  onLink={openLink}
                  t={t}
                />
              ))}
            </div>
          )}
      </section>

      <section className="dsh-mcp-section">
        <div className="dsh-mcp-section-head">
          <h2 className="dsh-mcp-section-title">{t('projectSection')}</h2>
          <span className="dsh-mcp-section-count">{projectCount} {t('servers')}</span>
        </div>
        <WorkspaceSelect
          workspaces={snapshot.workspaces}
          state={snapshot.workspaceState}
          busy={busy.includes('projects')}
          t={t}
          onToggle={(path, selected) => { void setProjectSelected(path, selected) }}
          onClear={() => { void clearProjects() }}
          onAddCustom={addProject}
        />
        <div className="dsh-mcp-hint">{t('projectHint')}</div>
        {data.projects.length === 0
          ? <div className="dsh-mcp-empty">{t('projectEmpty')}</div>
          : data.projects.map(project => (
            <div className="dsh-mcp-project-block" key={project.path}>
              <div className="dsh-mcp-project-head">
                <div className="dsh-mcp-project-title">
                  <span className="dsh-mcp-project-name">{workspaceTitle(project.path, snapshot.workspaces) ?? project.name}</span>
                  <span className="dsh-mcp-source-path" title={project.path}>{project.path}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy.includes('projects')}
                  onClick={() => { void setProjectSelected(project.path, false) }}
                >
                  {t('deselectProject')}
                </Button>
              </div>
              {project.error !== undefined && <div className="dsh-mcp-warning">{project.error}</div>}
              {project.sources.length === 0 && project.error === undefined
                ? <div className="dsh-mcp-empty">{t('projectNoMcp')}</div>
                : (
                  <div className="dsh-mcp-card">
                    {project.sources.map(group => (
                      <SourceGroup
                        key={group.sourceId + group.path}
                        group={group}
                        filter={filtered}
                        busy={busy}
                        onLink={openLink}
                        t={t}
                      />
                    ))}
                  </div>
                )}
            </div>
          ))}
      </section>

      <Modal
        open={pendingLink !== null}
        onClose={closeLink}
        title={t('linkDialogTitle')}
        closeLabel={t('close')}
        description={t('linkDialogDescription')}
        footer={(
          <div className="dsh-mcp-dialog-actions">
            <Button size="md" variant="outline" onClick={closeLink}>{t('cancel')}</Button>
            <Button
              size="md"
              variant="primary"
              disabled={pendingLink !== null && busy.includes(`link:${pendingLink.key}`)}
              onClick={() => { void confirmLink() }}
            >
              {pendingLink !== null && busy.includes(`link:${pendingLink.key}`) ? t('linking') : t('confirm')}
            </Button>
          </div>
        )}
      >
        {pendingLink !== null && (
          <div className="dsh-mcp-dialog-body">
            <div className="dsh-mcp-dialog-summary">
              <span className="dsh-mcp-name">{pendingLink.name}</span>
              <span className="dsh-mcp-code">
                {pendingLink.command !== undefined
                  ? [pendingLink.command, ...(pendingLink.args ?? [])].join(' ')
                  : pendingLink.url}
              </span>
              <span className="dsh-mcp-dialog-hint">{pendingLink.transport}</span>
            </div>
            <label className="dsh-mcp-dialog-label" htmlFor="dsh-mcp-server-name">{t('serverName')}</label>
            <Input
              id="dsh-mcp-server-name"
              value={pendingName}
              onChange={event => { setPendingName(event.currentTarget.value) }}
              aria-label={t('serverName')}
            />
            <span className="dsh-mcp-dialog-hint">{t('serverNameHint')}</span>
            {linkError !== '' && <span className="dsh-mcp-dialog-error">{linkError}</span>}
          </div>
        )}
      </Modal>

      {editing !== null && (
        <EntryEditor
          entry={editing}
          busy={busy.includes(`update:${editing.entryId}`)}
          t={t}
          onClose={() => { setEditing(null) }}
          onSave={saveEntry}
        />
      )}

      <Modal
        open={pendingUnlink !== null}
        onClose={() => { setPendingUnlink(null) }}
        title={t('unlinkDialogTitle')}
        closeLabel={t('close')}
        description={t('unlinkDialogDescription')}
        footer={(
          <div className="dsh-mcp-dialog-actions">
            <Button size="md" variant="outline" onClick={() => { setPendingUnlink(null) }}>{t('cancel')}</Button>
            <Button
              size="md"
              variant="primary"
              disabled={pendingUnlink !== null && busy.includes(`unlink:${pendingUnlink.entryId}`)}
              onClick={() => { void confirmUnlink() }}
            >
              {pendingUnlink !== null && busy.includes(`unlink:${pendingUnlink.entryId}`) ? t('unlinking') : t('confirmUnlink')}
            </Button>
          </div>
        )}
      >
        {pendingUnlink !== null && (
          <div className="dsh-mcp-dialog-body">
            <div className="dsh-mcp-dialog-summary">
              <span className="dsh-mcp-name">{pendingUnlink.serverName}</span>
              <span className="dsh-mcp-code">{pendingUnlink.entryId}</span>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}

function Header(props: {
  readonly t: McpSettingsSectionProps['t']
  readonly snapshot: McpSnapshot
  readonly onRefresh: () => void
}) {
  const { t, snapshot, onRefresh } = props
  return (
    <header className="dsh-mcp-head">
      <div className="dsh-mcp-head-copy">
        <h1 className="dsh-mcp-title">{t('title')}</h1>
        <p className="dsh-mcp-desc">{t('description')}</p>
      </div>
      <Button
        size="md"
        variant="outline"
        disabled={snapshot.busy.includes('refresh')}
        onClick={onRefresh}
      >
        {snapshot.busy.includes('refresh') ? t('refreshing') : t('refresh')}
      </Button>
    </header>
  )
}

function workspaceTitle(path: string, workspaces: readonly WorkspaceOption[]): string | undefined {
  return workspaces.find(item => item.path === path)?.title
}

function matches(server: PublicMcpServer, filter: string): boolean {
  if (filter === '') return true
  const haystack = [
    server.name,
    server.transport,
    server.command ?? '',
    ...(server.args ?? []),
    server.url ?? '',
    server.cwd ?? '',
    ...server.envKeys,
    ...server.headerKeys,
  ].join('\n').toLowerCase()
  return haystack.includes(filter)
}

function noticeOf(
  snapshot: McpSnapshot,
  t: McpSettingsSectionProps['t'],
): { kind: 'success' | 'error'; text: string } | undefined {
  const notice = snapshot.notice
  if (notice === undefined) return undefined
  switch (notice.kind) {
    case 'linked':
      return { kind: 'success', text: notice.restartRequired ? t('linkedRestartNotice') : t('linkedNotice') }
    case 'unlinked':
      return { kind: 'success', text: notice.restartRequired ? t('unlinkedRestartNotice') : t('unlinkedNotice') }
    case 'updated':
      return { kind: 'success', text: notice.restartRequired ? t('updatedRestartNotice') : t('updatedNotice') }
    case 'projects-saved':
      return { kind: 'success', text: t('projectSaved') }
    case 'error':
      return { kind: 'error', text: `${t('error')}: ${notice.message}` }
    default:
      return undefined
  }
}
