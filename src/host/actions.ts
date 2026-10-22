/** 接入与移除 MCP 的 Host 动作。 */
import { join } from 'node:path'
import type { LinkResponse, UnlinkResponse } from '../protocol.js'
import {
  appendMcpRow,
  insertedRows,
  readProfilePatch,
  removeMcpRow,
  restoreProfilePatch,
  saveProfilePatch,
} from './patch.js'
import { scanAll, sameConnection, validateProjectPath, type LoaderLike, type ProfileLike } from './scan.js'
import { readProjects, writeProjects } from './state.js'
import type { PatchRow, RawMcpServer } from './types.js'
import { delay, sanitizeServerName, uniqueEntryId, uniqueName } from './util.js'

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
  const applied = await waitFor(() => entryActive(context.loader, entryId), 5000)
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

function entryActive(loader: LoaderLike, id: string): boolean {
  const entry = [...loader.entries()].find(item => item.options?.id === id)
  return entry !== undefined && entry.disabled !== true && entry.fiber?.state === 2
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
