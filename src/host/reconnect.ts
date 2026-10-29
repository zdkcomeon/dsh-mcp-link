/**
 * 重新加载 DSH 已加载的 MCP 连接。
 *
 * 只重载 mcp-client 的 Cordis fiber，不修改配置文件：`fiber.update(config, true)`
 * 的第二个参数让 Loader 跳过写回，随后等待 fiber 完成重启，再用现有测试逻辑验证。
 */
import type {
  ReconnectFailureCode,
  ReconnectRequest,
  ReconnectResponse,
} from '../protocol.js'
import { ActionError, type ActionContext } from './actions.js'
import { isMcpModule, testConnection, transportOf } from './test.js'
import { asString, isRecord } from './util.js'

/** 等待 fiber 重启的上限；超时后 mcp-client 仍可能在后台继续重连。 */
const RELOAD_TIMEOUT_MS = 20_000
/** Cordis FiberState.LOADING。 */
const FIBER_LOADING = 1
/** Cordis FiberState.UNLOADING。 */
const FIBER_UNLOADING = 5

interface ReloadableFiber {
  readonly uid: number | null
  readonly state?: number
  readonly config?: unknown
  update(config: unknown, noSave?: boolean): void
  await(): Promise<unknown>
}

interface ReloadableEntry {
  readonly options?: {
    readonly id?: string
    readonly name?: string
    readonly config?: unknown
    readonly disabled?: boolean
  }
  /** Loader Entry 的 getter，包含父级 group 的禁用状态。 */
  readonly disabled?: boolean
  readonly fiber?: ReloadableFiber
}

interface ResolvedEntry {
  readonly entry: ReloadableEntry
  readonly entryId: string
  readonly serverName: string
  readonly config: Record<string, unknown>
}

const inFlight = new Map<string, Promise<ReconnectResponse>>()

/**
 * 重连一条已加载的 MCP。
 * @param context - 当前 profile 的运行时依赖。
 * @param request - 只能包含 `entryId` 或 `serverName` 之一。
 * @returns 重载和重连后测试的结果。
 */
export function reconnectMcp(
  context: ActionContext,
  request: ReconnectRequest,
): Promise<ReconnectResponse> {
  const entryId = typeof request.entryId === 'string' ? request.entryId.trim() : ''
  const serverName = typeof request.serverName === 'string' ? request.serverName.trim() : ''
  if ((entryId === '') === (serverName === '')) {
    return Promise.reject(new ActionError(400, 'invalid-request', '需要且只能提供 entryId 或 serverName'))
  }
  const key = entryId === '' ? `server:${serverName}` : `entry:${entryId}`
  const running = inFlight.get(key)
  if (running !== undefined) return running
  const run = reconnectUnlocked(context, entryId, serverName).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, run)
  return run
}

async function reconnectUnlocked(
  context: ActionContext,
  entryId: string,
  serverName: string,
): Promise<ReconnectResponse> {
  const resolved = resolveEntry(context, entryId, serverName)
  const fiber = resolved.entry.fiber
  if (fiber === undefined || fiber.uid === null) {
    throw new ActionError(409, 'not-running', '这条 MCP 没有运行中的实例，请重启 DSH 后重试')
  }
  const startedAt = Date.now()
  try {
    // 已经处于重启过程中时只等待，避免两次 update 互相覆盖。
    if (fiber.state !== FIBER_LOADING && fiber.state !== FIBER_UNLOADING) {
      fiber.update(resolved.entry.options?.config, true)
    }
    const settled = await waitForFiber(fiber, RELOAD_TIMEOUT_MS)
    if (settled === 'timeout') {
      return failedResponse(resolved, startedAt, 'timeout', '重连仍在进行，请稍后再测试连接')
    }
  } catch (error) {
    return failedResponse(resolved, startedAt, 'reload-failed', `重新加载 mcp-client 条目失败：${messageOf(error)}`)
  }
  try {
    const test = await testConnection(context, { entryId: resolved.entryId })
    return {
      ok: true,
      entryId: resolved.entryId,
      serverName: resolved.serverName,
      transport: transportOf(resolved.config),
      reloaded: true,
      reloadDurationMs: Date.now() - startedAt,
      test,
    }
  } catch (error) {
    return failedResponse(resolved, startedAt, 'reload-failed', `重连后测试失败：${messageOf(error)}`, true)
  }
}

function resolveEntry(
  context: ActionContext,
  entryId: string,
  serverName: string,
): ResolvedEntry {
  const entries = [...context.loader.entries()] as unknown as ReloadableEntry[]
  const entry = entryId === ''
    ? entries.find(item => isMcpModule(item.options?.name) && asString(configOf(item).serverName) === serverName)
    : entries.find(item => item.options?.id === entryId)
  if (entry === undefined || !isMcpModule(entry.options?.name)) {
    throw new ActionError(404, 'not-found', entryId === ''
      ? `没有找到名为 ${serverName} 的 MCP`
      : `没有找到 ${entryId} 对应的 MCP 配置`)
  }
  if (entry.disabled === true || entry.options?.disabled === true) {
    throw new ActionError(409, 'entry-disabled', '这条 MCP 已经禁用，无法重连')
  }
  const localId = entry.options?.id
  if (localId === undefined || localId === '') {
    throw new ActionError(404, 'not-found', '这条 MCP 没有稳定的条目 id')
  }
  const config = configOf(entry)
  return {
    entry,
    entryId: localId,
    serverName: asString(config.serverName) ?? localId,
    config,
  }
}

function configOf(entry: ReloadableEntry): Record<string, unknown> {
  if (isRecord(entry.fiber?.config)) return entry.fiber.config
  if (isRecord(entry.options?.config)) return entry.options.config
  return {}
}

async function waitForFiber(
  fiber: ReloadableFiber,
  timeoutMs: number,
): Promise<'settled' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
    timer.unref()
  })
  // 用 rejected 分支收住错误，超时后 fiber 再失败也不会产生未处理的 rejection。
  const settled = fiber.await().then(
    () => 'settled' as const,
    (error: unknown) => ({ failed: error }),
  )
  try {
    const winner = await Promise.race([settled, timeout])
    if (winner === 'timeout') return 'timeout'
    if (winner === 'settled') return 'settled'
    throw winner.failed
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function failedResponse(
  resolved: ResolvedEntry,
  startedAt: number,
  code: ReconnectFailureCode,
  message: string,
  reloaded = false,
): ReconnectResponse {
  return {
    ok: true,
    entryId: resolved.entryId,
    serverName: resolved.serverName,
    transport: transportOf(resolved.config),
    reloaded,
    reloadDurationMs: Date.now() - startedAt,
    error: { code, message },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
