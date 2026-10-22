/** 汇总系统 MCP、项目 MCP 与当前 DSH 已加载的 MCP 客户端条目。 */
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  DshMcpEntry,
  McpSourceGroup,
  McpTransport,
  ProjectScan,
  PublicMcpServer,
  ScanResponse,
} from '../protocol.js'
import { MISSING, readSource } from './parsers.js'
import { insertedRows, readProfilePatch } from './patch.js'
import { globalSources, projectSources } from './sources.js'
import type { RawMcpServer, ScannedServer, SourceDescriptor } from './types.js'
import {
  absolutePath,
  asString,
  asStringArray,
  asStringRecord,
  isRecord,
  looksSecret,
  redactArgs,
  redactUrl,
  shortHash,
  uniqueName,
} from './util.js'

/** Loader 中本插件需要的字段。 */
export interface LoaderEntryLike {
  readonly options?: {
    readonly id?: string
    readonly name?: string
    readonly config?: unknown
    readonly disabled?: boolean
  }
  readonly disabled?: boolean
  /** Cordis fiber 状态：2 = ACTIVE，3 = FAILED。 */
  readonly fiber?: {
    readonly state?: number
  }
}

/** Loader 服务的最小接口。 */
export interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
}

/** 当前 profile 的位置信息。 */
export interface ProfileLike {
  readonly name: string
  readonly patchPath: string
  readonly home: string
  readonly cwd: string
}

/** 一次扫描的输入。 */
export interface ScanInput {
  readonly loader: LoaderLike
  readonly profile: ProfileLike
  readonly savedProjects: readonly string[]
  readonly configProjects: readonly string[]
  readonly liveReload: boolean
}

/** 扫描结果，同时保留 Host 内部用于接入的原始配置。 */
export interface ScanResult {
  readonly response: ScanResponse
  readonly rawByKey: ReadonlyMap<string, ScannedServer>
  readonly patchIds: ReadonlySet<string>
}

interface CollectedGroup {
  readonly descriptor: SourceDescriptor
  readonly servers: readonly ScannedServer[]
  readonly error?: string
}

interface CollectedProject {
  readonly path: string
  readonly name: string
  readonly groups: readonly CollectedGroup[]
  readonly error?: string
}

/** 扫描全部来源。 */
export async function scanAll(input: ScanInput): Promise<ScanResult> {
  const warnings: string[] = []
  const projectPaths = await validateProjects(
    uniqueStrings([...input.savedProjects, ...input.configProjects]),
    warnings,
  )

  const collected: CollectedGroup[] = []
  for (const descriptor of globalSources()) {
    const group = await scanSource(descriptor)
    if (group !== null) collected.push(group)
  }

  const projects: CollectedProject[] = []
  for (const project of projectPaths) {
    const groups: CollectedGroup[] = []
    for (const descriptor of projectSources(project.path)) {
      const group = await scanSource(descriptor)
      if (group !== null) groups.push(group)
    }
    const claudeProject = await scanSource({
      sourceId: 'claude-code-project',
      label: 'Claude Code 项目配置',
      path: join(homedir(), '.claude.json'),
      format: 'claude-code-project',
      scope: 'project',
      projectPath: project.path,
    })
    if (claudeProject !== null) groups.push(claudeProject)
    for (const group of groups) {
      if (group.error !== undefined) warnings.push(group.error)
    }
    projects.push({ path: project.path, name: project.name, groups })
  }
  for (const group of collected) {
    if (group.error !== undefined) warnings.push(group.error)
  }

  const dsh = await readDshEntries(input.loader, input.profile, warnings)
  const dshNames = new Set(dsh.map(entry => entry.serverName))
  const system = collected
    .filter(group => group.servers.length > 0)
    .map(group => sourceGroupOf(group, dsh, dshNames))
  const projectScans: ProjectScan[] = projects.map(project => ({
    path: project.path,
    name: project.name,
    sources: project.groups
      .filter(group => group.servers.length > 0 || group.error !== undefined)
      .map(group => sourceGroupOf(group, dsh, dshNames)),
  }))

  const rawByKey = new Map<string, ScannedServer>()
  for (const group of collected) {
    for (const server of group.servers) rawByKey.set(server.key, server)
  }
  for (const project of projects) {
    for (const group of project.groups) {
      for (const server of group.servers) rawByKey.set(server.key, server)
    }
  }

  let patchIds = new Set<string>()
  try {
    patchIds = new Set(insertedRows(await readProfilePatch(input.profile.patchPath)).map(row => row.id))
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error))
  }

  const response: ScanResponse = {
    ok: true,
    generatedAt: new Date().toISOString(),
    profile: {
      name: input.profile.name,
      patchPath: input.profile.patchPath,
      home: input.profile.home,
      cwd: input.profile.cwd,
      reload: input.liveReload ? 'live' : 'restart',
    },
    dsh,
    system,
    projects: projectScans,
    savedProjects: projectPaths.map(project => project.path),
    warnings,
  }
  return { response, rawByKey, patchIds }
}

/** 只扫描项目路径，供项目校验使用。 */
export async function validateProjectPath(path: string): Promise<{ path: string; name: string } | { error: string }> {
  const resolved = absolutePath(path)
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) return { error: `不是目录：${resolved}` }
    return { path: resolved, name: basename(resolved) || resolved }
  } catch {
    return { error: `目录不存在：${resolved}` }
  }
}

async function scanSource(descriptor: SourceDescriptor): Promise<CollectedGroup | null> {
  try {
    const parsed = await readSource(descriptor)
    if (parsed === MISSING) return null
    const servers: ScannedServer[] = []
    for (const raw of parsed.servers) {
      const resolved = resolveProjectPlaceholders(withProjectCwd(raw, descriptor), descriptor)
      const unsupported = resolved.unsupported ?? placeholderUnsupported(resolved)
      servers.push({
        key: keyOf(descriptor, resolved),
        source: descriptor,
        raw: unsupported === undefined ? resolved : { ...resolved, unsupported },
      })
    }
    return { descriptor, servers }
  } catch (error) {
    return {
      descriptor,
      servers: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 项目扫描列表：保存的项目 + 配置里声明的项目。 */
async function validateProjects(
  paths: readonly string[],
  warnings: string[],
): Promise<Array<{ path: string; name: string }>> {
  const output: Array<{ path: string; name: string }> = []
  for (const path of paths) {
    const result = await validateProjectPath(path)
    if ('error' in result) {
      warnings.push(result.error)
      continue
    }
    output.push(result)
  }
  return output
}

async function readDshEntries(
  loader: LoaderLike,
  profile: ProfileLike,
  warnings: string[],
): Promise<DshMcpEntry[]> {
  const profileIds = new Set<string>()
  const homeIds = new Set<string>()
  try {
    for (const row of insertedRows(await readProfilePatch(profile.patchPath))) profileIds.add(row.id)
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error))
  }
  try {
    const homePatch = await readProfilePatch(join(profile.home, 'cordis.patch.yml'))
    for (const row of insertedRows(homePatch)) homeIds.add(row.id)
  } catch {
    // home patch 不存在或不可读时不影响 profile 自身的条目。
  }

  const entries = new Map<string, DshMcpEntry>()
  for (const entry of loader.entries()) {
    const options = entry.options
    if (options === undefined || typeof options.id !== 'string' || typeof options.name !== 'string') continue
    if (!isMcpModule(options.name)) continue
    const config = isRecord(options.config) ? options.config : {}
    const id = options.id
    const command = asString(config.command)
    const args = asStringArray(config.args)
    const url = asString(config.url)
    const entryValue: DshMcpEntry = {
      entryId: id,
      serverName: asString(config.serverName) ?? id,
      transport: transportOfConfig(config),
      ...(command === undefined ? {} : { command }),
      ...(args === undefined ? {} : { args }),
      ...(url === undefined ? {} : { url: redactUrl(url) }),
      envKeys: Object.keys(asStringRecord(config.env) ?? {}),
      headerKeys: Object.keys(asStringRecord(config.headers) ?? {}),
      enabled: !entry.disabled && options.disabled !== true,
      source: profileIds.has(id) ? 'profile' : homeIds.has(id) ? 'home' : 'bundle',
      editable: profileIds.has(id),
      managed: profileIds.has(id) && id.startsWith('mcp-link-'),
    }
    entries.set(id, entryValue)
  }
  return [...entries.values()].sort((left, right) => left.serverName.localeCompare(right.serverName))
}

function sourceGroupOf(
  group: CollectedGroup,
  dsh: readonly DshMcpEntry[],
  dshNames: ReadonlySet<string>,
): McpSourceGroup {
  return {
    sourceId: group.descriptor.sourceId,
    label: group.descriptor.label,
    path: group.descriptor.path,
    scope: group.descriptor.scope,
    ...(group.descriptor.projectPath === undefined ? {} : { projectPath: group.descriptor.projectPath }),
    ...(group.error === undefined ? {} : { error: group.error }),
    servers: group.servers.map(server => publicOf(server, dsh, dshNames)),
  }
}

function publicOf(
  server: ScannedServer,
  dsh: readonly DshMcpEntry[],
  dshNames: ReadonlySet<string>,
): PublicMcpServer {
  const raw = server.raw
  const env = raw.env ?? {}
  const headers = raw.headers ?? {}
  return {
    key: server.key,
    name: raw.name,
    transport: raw.transport,
    ...(raw.command === undefined ? {} : { command: raw.command }),
    ...(raw.args === undefined ? {} : { args: redactArgs(raw.args) }),
    ...(raw.url === undefined ? {} : { url: redactUrl(raw.url) }),
    ...(raw.cwd === undefined ? {} : { cwd: raw.cwd }),
    envKeys: Object.keys(env),
    secretEnvKeys: Object.keys(env).filter(looksSecret),
    headerKeys: Object.keys(headers),
    secretHeaderKeys: Object.keys(headers).filter(looksSecret),
    ...(raw.unsupported === undefined ? {} : { unsupported: raw.unsupported }),
    ...(raw.disabled === true ? { disabled: true } : {}),
    ...linkFields(raw, dsh),
    suggestedName: uniqueName(raw.name, dshNames),
  }
}

function linkFields(
  server: Pick<RawMcpServer, 'transport' | 'command' | 'args' | 'url' | 'name'>,
  dsh: readonly DshMcpEntry[],
): Pick<PublicMcpServer, 'linkedEntryId' | 'linkedServerName' | 'nameConflictEntryId'> {
  const exact = dsh.find(entry => sameConnection(entry, server))
  if (exact !== undefined) {
    return { linkedEntryId: exact.entryId, linkedServerName: exact.serverName }
  }
  const sameName = dsh.find(entry => entry.serverName === server.name)
  return sameName === undefined ? {} : { nameConflictEntryId: sameName.entryId }
}

function keyOf(descriptor: SourceDescriptor, raw: RawMcpServer): string {
  const envKeys = Object.keys(raw.env ?? {}).sort()
  const headerKeys = Object.keys(raw.headers ?? {}).sort()
  return shortHash([
    descriptor.sourceId,
    descriptor.path,
    raw.name,
    connectionSignature(raw),
    envKeys.join(','),
    headerKeys.join(','),
  ].join('\0'))
}

function connectionSignature(server: Pick<RawMcpServer, 'transport' | 'command' | 'args' | 'url'>): string {
  return JSON.stringify([
    server.transport,
    server.command === undefined ? null : commandKey(server.command),
    normalizeArgs(server.args),
    server.url === undefined ? null : normalizeUrl(server.url),
  ])
}

export function sameConnection(
  left: Pick<DshMcpEntry, 'transport' | 'command' | 'args' | 'url'>,
  right: Pick<RawMcpServer, 'transport' | 'command' | 'args' | 'url'>,
): boolean {
  if (left.transport !== right.transport) return false
  if (left.transport === 'stdio') {
    if (left.command === undefined || right.command === undefined) return false
    return commandKey(left.command) === commandKey(right.command)
      && JSON.stringify(normalizeArgs(left.args)) === JSON.stringify(normalizeArgs(right.args))
  }
  if (left.transport === 'streamable-http' || left.transport === 'sse') {
    if (left.url === undefined || right.url === undefined) return false
    return normalizeUrl(left.url) === normalizeUrl(right.url)
  }
  return false
}

function commandKey(command: string): string {
  return basename(command).toLowerCase().replace(/\.(?:cmd|exe|bat)$/u, '')
}

function normalizeArgs(args: readonly string[] | undefined): string[] {
  return args === undefined ? [] : [...args]
}

function normalizeUrl(input: string): string {
  try {
    const url = new URL(input)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = ''
    }
    url.pathname = url.pathname.replace(/\/+$/u, '') || '/'
    const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
    url.search = ''
    for (const [key, value] of params) url.searchParams.append(key, value)
    return url.toString()
  } catch {
    return input.trim().replace(/\/+$/u, '')
  }
}

function transportOfConfig(config: Record<string, unknown>): McpTransport {
  const declared = asString(config.transport)
  if (declared === 'stdio' || declared === 'streamable-http' || declared === 'sse') return declared
  if (asString(config.url) !== undefined) return 'streamable-http'
  if (asString(config.command) !== undefined) return 'stdio'
  return 'unknown'
}

function resolveProjectPlaceholders(raw: RawMcpServer, descriptor: SourceDescriptor): RawMcpServer {
  if (descriptor.scope !== 'project' || descriptor.projectPath === undefined) return raw
  const project = descriptor.projectPath
  const replace = (value: string): string => value
    .replaceAll('${workspaceFolder}', project)
    .replaceAll('${workspaceRoot}', project)
    .replaceAll('${projectPath}', project)
    .replaceAll('${cwd}', project)
  return {
    ...raw,
    ...(raw.command === undefined ? {} : { command: replace(raw.command) }),
    ...(raw.args === undefined ? {} : { args: raw.args.map(replace) }),
    ...(raw.env === undefined ? {} : { env: mapValues(raw.env, replace) }),
    ...(raw.cwd === undefined ? {} : { cwd: replace(raw.cwd) }),
    ...(raw.url === undefined ? {} : { url: replace(raw.url) }),
    ...(raw.headers === undefined ? {} : { headers: mapValues(raw.headers, replace) }),
  }
}

function placeholderUnsupported(raw: RawMcpServer): string | undefined {
  const values = [
    raw.command,
    raw.url,
    ...(raw.args ?? []),
    ...Object.values(raw.env ?? {}),
    ...Object.values(raw.headers ?? {}),
  ]
  return values.some(value => value !== undefined && /\$\{[^}]+\}/u.test(value))
    ? '配置里包含 ${...} 变量，需要先在源配置中补全'
    : undefined
}

function mapValues(record: Readonly<Record<string, string>>, transform: (value: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, transform(value)]))
}

function withProjectCwd(raw: RawMcpServer, descriptor: SourceDescriptor): RawMcpServer {
  if (descriptor.scope !== 'project' || descriptor.projectPath === undefined) return raw
  if (raw.transport !== 'stdio') return raw
  if (raw.cwd === undefined) return { ...raw, cwd: descriptor.projectPath }
  if (raw.cwd.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(raw.cwd)) return raw
  return { ...raw, cwd: join(descriptor.projectPath, raw.cwd) }
}

function isMcpModule(name: string): boolean {
  return name === '@deepseek-ai/dsh-mcp-client' || name.endsWith('/dsh-mcp-client')
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(value => value !== ''))]
}
