/** 接入与移除 MCP 的 Host 动作。 */
import { join } from 'node:path'
import type {
  CreateEntryRequest,
  CreateEntryResponse,
  EditableEntry,
  EditablePair,
  EditablePairInput,
  EntryDetailResponse,
  EntrySettings,
  LinkResponse,
  UnlinkResponse,
  UpdateEntryRequest,
  UpdateEntryResponse,
} from '../protocol.js'
import {
  appendMcpRow,
  insertedRows,
  isExpressionValue,
  patchIds,
  readProfilePatch,
  removeMcpRow,
  restoreProfilePatch,
  rowConfig,
  saveProfilePatch,
  updateRowConfig,
  type InsertedRow,
  type ProfilePatch,
} from './patch.js'
import { scanAll, sameConnection, validateProjectPath, type LoaderLike, type ProfileLike } from './scan.js'
import { readProjects, writeProjects } from './state.js'
import type { PatchRow, RawMcpServer } from './types.js'
import { asString, asStringArray, asStringRecord, delay, isRecord, looksSecret, sanitizeServerName, uniqueEntryId, uniqueName } from './util.js'

/** 动作失败时携带 HTTP 状态码与稳定错误码。 */
export class ActionError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ActionError'
    this.status = status
    this.code = code
  }
}

/** 动作需要的运行时依赖。 */
export interface ActionContext {
  readonly loader: LoaderLike
  readonly profile: ProfileLike
  readonly liveReload: boolean
  readonly configProjects: readonly string[]
}

let actionQueue: Promise<unknown> = Promise.resolve()

/** 串行执行会修改 profile 或状态文件的动作，避免并发读改写互相覆盖。 */
function withActionLock<T>(action: () => Promise<T>): Promise<T> {
  const run = actionQueue.then(action, action)
  actionQueue = run.then(() => undefined, () => undefined)
  return run
}

/** 接入一条系统 MCP。 */
export function linkServer(
  context: ActionContext,
  request: { key: string; serverName?: string },
): Promise<LinkResponse> {
  return withActionLock(() => linkServerUnlocked(context, request))
}

async function linkServerUnlocked(
  context: ActionContext,
  request: { key: string; serverName?: string },
): Promise<LinkResponse> {
  const saved = await readProjects(context.profile.home)
  const scan = await scanAll({
    loader: context.loader,
    profile: context.profile,
    savedProjects: saved.projects,
    configProjects: context.configProjects,
    liveReload: context.liveReload,
  })
  const server = scan.rawByKey.get(request.key)
  if (server === undefined) {
    throw new ActionError(409, 'source-changed', '源配置已经变化，请刷新后重试')
  }
  const raw = server.raw
  if (raw.unsupported !== undefined) {
    throw new ActionError(409, 'unsupported', raw.unsupported)
  }
  if (raw.transport !== 'stdio' && raw.transport !== 'streamable-http') {
    throw new ActionError(409, 'unsupported-transport', '只能接入 stdio 或 Streamable HTTP 的 MCP')
  }
  if (raw.disabled === true) {
    throw new ActionError(409, 'source-disabled', '源配置把这条 MCP 标成了 disabled')
  }
  const already = scan.response.dsh.find(entry => sameConnection(entry, raw))
  if (already !== undefined) {
    return {
      ok: true,
      entryId: already.entryId,
      serverName: already.serverName,
      applied: already.enabled,
      restartRequired: false,
      alreadyLinked: true,
    }
  }

  const takenNames = new Set(scan.response.dsh.map(entry => entry.serverName))
  const requestedName = request.serverName?.trim()
  let serverName: string
  if (requestedName !== undefined && requestedName !== '') {
    if (!/^[A-Za-z0-9_-]{1,32}$/u.test(requestedName)) {
      throw new ActionError(400, 'invalid-name', '名称只能包含字母、数字、下划线和短横线，长度 1-32')
    }
    if (takenNames.has(requestedName)) {
      throw new ActionError(409, 'name-conflict', `DSH 里已经有名为 ${requestedName} 的 MCP`)
    }
    serverName = requestedName
  } else {
    serverName = uniqueName(raw.name, takenNames)
  }

  const patch = await readProfilePatch(context.profile.patchPath)
  const usedIds = new Set([
    ...scan.patchIds,
    ...[...context.loader.entries()].flatMap(entry =>
      typeof entry.options?.id === 'string' ? [entry.options.id] : []),
  ])
  const entryId = uniqueEntryId(`mcp-link-${sanitizeServerName(serverName)}`, usedIds)
  const row: PatchRow = {
    id: entryId,
    serverName,
    transport: raw.transport,
    ...(raw.command === undefined ? {} : { command: raw.command }),
    ...(raw.args === undefined ? {} : { args: raw.args }),
    ...(raw.env === undefined ? {} : { env: raw.env }),
    ...(raw.cwd === undefined ? {} : { cwd: raw.cwd }),
    ...(raw.url === undefined ? {} : { url: raw.url }),
    ...(raw.headers === undefined ? {} : { headers: raw.headers }),
  }
  appendMcpRow(patch, row)
  try {
    await saveProfilePatch(patch)
  } catch (error) {
    await restoreProfilePatch(patch).catch(() => undefined)
    throw new ActionError(500, 'write-failed', `写入 profile 配置失败：${errorMessage(error)}`)
  }

  if (!context.liveReload) {
    return { ok: true, entryId, serverName, applied: false, restartRequired: true }
  }
  const applied = await waitFor(() => entryConfigured(context.loader, entryId, {
    serverName,
    transport: row.transport,
    ...(row.command === undefined ? {} : { command: row.command }),
    ...(row.args === undefined ? {} : { args: row.args }),
    ...(row.url === undefined ? {} : { url: row.url }),
    ...(row.env === undefined ? {} : { env: row.env }),
    ...(row.headers === undefined ? {} : { headers: row.headers }),
  }), 5000)
  if (!applied && entryState(context.loader, entryId) === 3) {
    const rollback = await readProfilePatch(context.profile.patchPath)
    removeMcpRow(rollback, entryId)
    await saveProfilePatch(rollback).catch(() => undefined)
    throw new ActionError(500, 'startup-failed', '新 MCP 启动失败，已回滚配置；请检查命令和环境变量')
  }
  return { ok: true, entryId, serverName, applied, restartRequired: !applied }
}

/** 从当前 profile 移除一条 MCP。 */
export function unlinkServer(context: ActionContext, entryId: string): Promise<UnlinkResponse> {
  return withActionLock(() => unlinkServerUnlocked(context, entryId))
}

async function unlinkServerUnlocked(context: ActionContext, entryId: string): Promise<UnlinkResponse> {
  const patch = await readProfilePatch(context.profile.patchPath)
  const row = insertedRows(patch).find(item => item.id === entryId)
  if (row === undefined) {
    throw new ActionError(409, 'not-editable', '这条 MCP 不是由当前 profile 的 patch 插入的，不能在这里移除')
  }
  removeMcpRow(patch, entryId)
  try {
    await saveProfilePatch(patch)
  } catch (error) {
    await restoreProfilePatch(patch).catch(() => undefined)
    throw new ActionError(500, 'write-failed', `写入 profile 配置失败：${errorMessage(error)}`)
  }
  if (!context.liveReload) {
    return { ok: true, applied: false, restartRequired: true }
  }
  const applied = await waitFor(() => !entryExists(context.loader, entryId), 5000)
  return { ok: true, applied, restartRequired: !applied }
}

/** 读取一条可编辑 MCP 的完整连接信息；敏感值只返回键名。 */
export async function entryDetail(context: ActionContext, entryId: string): Promise<EntryDetailResponse> {
  if (entryId.trim() === '') throw new ActionError(400, 'invalid-request', '缺少 entryId')
  const patch = await readProfilePatch(context.profile.patchPath)
  const row = insertedRows(patch).find(item => item.id === entryId)
  if (row === undefined) {
    throw new ActionError(409, 'not-editable', '这条 MCP 不是由当前 profile 的 patch 插入的，不能在这里编辑')
  }
  const config = rowConfig(row)
  const transport = transportOfConfig(config)
  if (transport === undefined) {
    throw new ActionError(409, 'unsupported-transport', '只能编辑 stdio 或 Streamable HTTP 的 MCP')
  }
  const command = asString(config.command)
  const args = asStringArray(config.args)
  const cwd = asString(config.cwd)
  const url = asString(config.url)
  const timeout = typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : undefined
  const entry: EditableEntry = {
    entryId,
    serverName: asString(config.serverName) ?? entryId,
    transport,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    env: pairsOf(config.env, row, 'env'),
    ...(cwd === undefined ? {} : { cwd }),
    ...(url === undefined ? {} : { url }),
    headers: pairsOf(config.headers, row, 'headers'),
    ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
  }
  return { ok: true, entry }
}

/** 新增一条 MCP。 */
export function createEntry(context: ActionContext, request: CreateEntryRequest): Promise<CreateEntryResponse> {
  return withActionLock(() => createEntryUnlocked(context, request))
}

async function createEntryUnlocked(context: ActionContext, request: CreateEntryRequest): Promise<CreateEntryResponse> {
  const patch = await readProfilePatch(context.profile.patchPath)
  const next = buildNextConfig(context.loader, patch, request, undefined, {})
  const serverName = asString(next.serverName) ?? ''
  const usedIds = new Set([
    ...patchIds(patch),
    ...[...context.loader.entries()].flatMap(entry =>
      typeof entry.options?.id === 'string' ? [entry.options.id] : []),
  ])
  const entryId = uniqueEntryId(`mcp-link-${sanitizeServerName(serverName)}`, usedIds)
  appendMcpRow(patch, patchRowOf(entryId, next))
  try {
    await saveProfilePatch(patch)
  } catch (error) {
    await restoreProfilePatch(patch).catch(() => undefined)
    throw new ActionError(500, 'write-failed', `写入 profile 配置失败：${errorMessage(error)}`)
  }
  if (!context.liveReload) {
    return { ok: true, entryId, serverName, applied: false, restartRequired: true }
  }
  const applied = await waitFor(() => entryConfigured(context.loader, entryId, expectationOf(next)), 5000)
  if (!applied && entryState(context.loader, entryId) === 3) {
    const rollback = await readProfilePatch(context.profile.patchPath)
    removeMcpRow(rollback, entryId)
    await saveProfilePatch(rollback).catch(() => undefined)
    throw new ActionError(500, 'startup-failed', '新增的 MCP 启动失败，已回滚配置；请检查命令和链接信息')
  }
  return { ok: true, entryId, serverName, applied, restartRequired: !applied }
}

/** 更新一条已接入 MCP 的连接信息。 */
export function updateEntry(context: ActionContext, request: UpdateEntryRequest): Promise<UpdateEntryResponse> {
  return withActionLock(() => updateEntryUnlocked(context, request))
}

async function updateEntryUnlocked(context: ActionContext, request: UpdateEntryRequest): Promise<UpdateEntryResponse> {
  if (typeof request.entryId !== 'string' || request.entryId.trim() === '') {
    throw new ActionError(400, 'invalid-request', '缺少 entryId')
  }
  const patch = await readProfilePatch(context.profile.patchPath)
  const row = insertedRows(patch).find(item => item.id === request.entryId)
  if (row === undefined) {
    throw new ActionError(409, 'not-editable', '这条 MCP 不是由当前 profile 的 patch 插入的，不能在这里编辑')
  }
  const previous = structuredClone(rowConfig(row))
  const next = buildNextConfig(context.loader, patch, request, request.entryId, previous)
  updateRowConfig(patch, row, next)
  try {
    await saveProfilePatch(patch)
  } catch (error) {
    await restoreProfilePatch(patch).catch(() => undefined)
    throw new ActionError(500, 'write-failed', `写入 profile 配置失败：${errorMessage(error)}`)
  }
  if (!context.liveReload) {
    return { ok: true, applied: false, restartRequired: true }
  }
  const applied = await waitFor(() => entryConfigured(context.loader, request.entryId, expectationOf(next)), 5000)
  if (!applied && entryState(context.loader, request.entryId) === 3) {
    const rollback = await readProfilePatch(context.profile.patchPath)
    const rollbackRow = insertedRows(rollback).find(item => item.id === request.entryId)
    if (rollbackRow !== undefined) {
      updateRowConfig(rollback, rollbackRow, previous)
      await saveProfilePatch(rollback).catch(() => undefined)
    }
    throw new ActionError(500, 'startup-failed', '编辑后的 MCP 启动失败，已回滚配置；请检查命令和链接信息')
  }
  return { ok: true, applied, restartRequired: !applied }
}

function buildNextConfig(
  loader: LoaderLike,
  patch: ProfilePatch,
  input: EntrySettings,
  excludeEntryId: string | undefined,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const serverName = typeof input.serverName === 'string' ? input.serverName.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(serverName)) {
    throw new ActionError(400, 'invalid-name', '名称只能包含字母、数字、下划线和短横线，长度 1-32')
  }
  if (input.transport !== 'stdio' && input.transport !== 'streamable-http') {
    throw new ActionError(400, 'invalid-transport', '传输方式必须是 stdio 或 streamable-http')
  }
  const takenNames = namesOfOtherEntries(loader, patch, excludeEntryId)
  if (takenNames.has(serverName)) {
    throw new ActionError(409, 'name-conflict', `DSH 里已经有名为 ${serverName} 的 MCP`)
  }
  const next: Record<string, unknown> = { ...previous, serverName, transport: input.transport }
  for (const key of ['command', 'args', 'env', 'cwd', 'url', 'headers', 'toolCallTimeoutMs']) delete next[key]
  if (input.transport === 'stdio') {
    const command = typeof input.command === 'string' ? input.command.trim() : ''
    if (command === '') throw new ActionError(400, 'invalid-command', 'stdio MCP 需要 command')
    next.command = command
    if (input.args !== undefined) {
      if (!Array.isArray(input.args) || input.args.some(item => typeof item !== 'string')) {
        throw new ActionError(400, 'invalid-args', 'args 必须是字符串数组')
      }
      if (input.args.length > 0) next.args = [...input.args]
    }
    const env = mergePairs(previous.env, input.env, '环境变量')
    if (Object.keys(env).length > 0) next.env = env
    const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : ''
    if (cwd !== '') next.cwd = cwd
  } else {
    const url = typeof input.url === 'string' ? input.url.trim() : ''
    assertHttpUrl(url)
    next.url = url
    const headers = mergePairs(previous.headers, input.headers, '请求头')
    if (Object.keys(headers).length > 0) next.headers = headers
  }
  if (input.toolCallTimeoutMs !== undefined) {
    if (!Number.isSafeInteger(input.toolCallTimeoutMs) || input.toolCallTimeoutMs <= 0) {
      throw new ActionError(400, 'invalid-timeout', '超时必须是正整数毫秒值')
    }
    next.toolCallTimeoutMs = input.toolCallTimeoutMs
  } else if (previous.toolCallTimeoutMs !== undefined && typeof previous.toolCallTimeoutMs !== 'number') {
    // 表单不展示非数字表达式；未显式清空时原样保留。
    next.toolCallTimeoutMs = previous.toolCallTimeoutMs
  }
  return next
}

function expectationOf(config: Record<string, unknown>): EntryExpectation {
  return {
    serverName: asString(config.serverName) ?? '',
    transport: asString(config.transport) ?? '',
    ...(typeof config.command === 'string' ? { command: config.command } : {}),
    ...(Array.isArray(config.args) && config.args.every(item => typeof item === 'string') ? { args: config.args } : {}),
    ...(typeof config.url === 'string' ? { url: config.url } : {}),
    ...(isRecord(config.env) ? { env: asStringRecord(config.env) ?? {} } : {}),
    ...(isRecord(config.headers) ? { headers: asStringRecord(config.headers) ?? {} } : {}),
  }
}

function patchRowOf(id: string, config: Record<string, unknown>): PatchRow {
  const transport = config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const serverName = asString(config.serverName) ?? id
  const command = asString(config.command)
  const args = asStringArray(config.args)
  const env = asStringRecord(config.env)
  const cwd = asString(config.cwd)
  const url = asString(config.url)
  const headers = asStringRecord(config.headers)
  const timeout = typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : undefined
  return {
    id,
    serverName,
    transport,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(url === undefined ? {} : { url }),
    ...(headers === undefined ? {} : { headers }),
    ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
  }
}

function pairsOf(value: unknown, row: InsertedRow, section: 'env' | 'headers'): EditablePair[] {
  const record = asStringRecord(value)
  if (record === undefined) return []
  return Object.entries(record).map(([key, item]) => {
    const expression = isExpressionValue(row, section, key)
    if (looksSecret(key)) {
      return { key, secret: true, ...(expression ? { expression: true } : {}) }
    }
    return { key, value: item, secret: false, ...(expression ? { expression: true } : {}) }
  })
}

function mergePairs(
  previous: unknown,
  pairs: readonly EditablePairInput[],
  label: string,
): Record<string, string> {
  if (!Array.isArray(pairs)) throw new ActionError(400, 'invalid-pairs', `${label}必须是数组`)
  const current = asStringRecord(previous) ?? {}
  const next: Record<string, string> = {}
  for (const pair of pairs) {
    if (!isRecord(pair)) throw new ActionError(400, 'invalid-pairs', `${label}包含非法项`)
    const key = typeof pair.key === 'string' ? pair.key.trim() : ''
    if (key === '') throw new ActionError(400, 'invalid-pairs', `${label}的键不能为空`)
    if (Object.hasOwn(next, key)) throw new ActionError(400, 'invalid-pairs', `${label}的键 ${key} 重复`)
    if (Object.hasOwn(pair, 'value')) {
      if (typeof pair.value !== 'string') throw new ActionError(400, 'invalid-pairs', `${label} ${key} 的值必须是字符串`)
      next[key] = pair.value
    } else {
      if (!Object.hasOwn(current, key)) {
        throw new ActionError(400, 'missing-value', `${label} ${key} 需要填写值`)
      }
      next[key] = current[key] ?? ''
    }
  }
  return next
}

function assertHttpUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch {
    throw new ActionError(400, 'invalid-url', 'Streamable HTTP 需要合法的 http(s) URL')
  }
}

function transportOfConfig(config: Record<string, unknown>): 'stdio' | 'streamable-http' | undefined {
  const declared = asString(config.transport)
  if (declared === 'stdio' || declared === 'streamable-http') return declared
  if (asString(config.command) !== undefined) return 'stdio'
  if (asString(config.url) !== undefined) return 'streamable-http'
  return undefined
}

function namesOfOtherEntries(
  loader: LoaderLike,
  patch: ProfilePatch,
  entryId: string | undefined,
): Set<string> {
  const names = new Set<string>()
  for (const entry of loader.entries()) {
    if (entryId !== undefined && entry.options?.id === entryId) continue
    if (!isMcpModule(entry.options?.name)) continue
    const config = isRecord(entry.options?.config) ? entry.options.config : {}
    const name = asString(config.serverName)
    if (name !== undefined) names.add(name)
  }
  for (const item of insertedRows(patch)) {
    if (entryId !== undefined && item.id === entryId) continue
    const name = asString(rowConfig(item).serverName)
    if (name !== undefined) names.add(name)
  }
  return names
}

function isMcpModule(name: string | undefined): boolean {
  return name === '@deepseek-ai/dsh-mcp-client' || (name?.endsWith('/dsh-mcp-client') ?? false)
}

/** 保存用户添加的项目路径。 */
export function saveProjectPaths(
  context: ActionContext,
  paths: readonly string[],
): Promise<string[]> {
  return withActionLock(() => saveProjectPathsUnlocked(context, paths))
}

async function saveProjectPathsUnlocked(
  context: ActionContext,
  paths: readonly string[],
): Promise<string[]> {
  const normalized: string[] = []
  for (const path of paths.slice(0, 20)) {
    const result = await validateProjectPath(path)
    if ('error' in result) throw new ActionError(400, 'invalid-project', result.error)
    if (!normalized.includes(result.path)) normalized.push(result.path)
  }
  await writeProjects(context.profile.home, normalized)
  return normalized
}

/** 项目扫描接口使用：读取当前保存的项目。 */
export async function currentProjects(context: Pick<ActionContext, 'profile'>): Promise<string[]> {
  return (await readProjects(context.profile.home)).projects
}

/** 给路由层使用的 home patch 路径。 */
export function homePatchPath(profile: ProfileLike): string {
  return join(profile.home, 'cordis.patch.yml')
}

interface EntryExpectation {
  readonly serverName: string
  readonly transport: string
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
  readonly env?: Readonly<Record<string, string>>
  readonly headers?: Readonly<Record<string, string>>
}

function entryConfigured(loader: LoaderLike, id: string, expected: EntryExpectation): boolean {
  const entry = [...loader.entries()].find(item => item.options?.id === id)
  if (entry === undefined || entry.disabled === true || entry.fiber?.state !== 2) return false
  const config = isRecord(entry.options?.config) ? entry.options.config : {}
  if (asString(config.serverName) !== expected.serverName) return false
  if (asString(config.transport) !== expected.transport) return false
  if (asString(config.command) !== expected.command) return false
  if ((asStringArray(config.args) ?? []).join('\0') !== (expected.args ?? []).join('\0')) return false
  if (asString(config.url) !== expected.url) return false
  if (envKeys(config.env) !== envKeys(expected.env)) return false
  if (envKeys(config.headers) !== envKeys(expected.headers)) return false
  return true
}

function envKeys(value: unknown): string {
  return Object.keys(asStringRecord(value) ?? {}).sort().join(',')
}

function entryExists(loader: LoaderLike, id: string): boolean {
  return [...loader.entries()].some(entry => entry.options?.id === id)
}

function entryState(loader: LoaderLike, id: string): number | undefined {
  return [...loader.entries()].find(entry => entry.options?.id === id)?.fiber?.state
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(100)
  }
  return predicate()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
