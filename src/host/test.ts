/**
 * 处理测试连接请求：把浏览器给的条目 id 或来源 key 解析成 Host 侧配置，
 * 再用独立连接探测一次，不信任浏览器传来的命令、URL 或凭据。
 */
import type {
  McpTransport,
  TestConnectionRequest,
  TestConnectionResult,
  TestFailureCode,
} from '../protocol.js'
import { ActionError, type ActionContext } from './actions.js'
import { insertedRows, readProfilePatch, rowConfig, rowConfigHasExpression } from './patch.js'
import { probeMcp, type ProbeFailure, type ProbeOutcome, type ProbeTarget } from './probe.js'
import { scanAll } from './scan.js'
import { readProjects } from './state.js'
import { asString, asStringArray, asStringRecord, isRecord } from './util.js'

interface TargetIds {
  readonly entryId?: string
  readonly key?: string
}

/** 解析后的测试目标；`probe` 与 `failure` 二选一。 */
interface ResolvedTest extends TargetIds {
  readonly target: 'dsh' | 'source'
  readonly serverName: string
  readonly transport: McpTransport
  readonly probe?: ProbeTarget
  readonly failure?: ProbeFailure
}

/**
 * 测试一条 MCP 连接。
 * @param context - 当前 profile 的运行时依赖。
 * @param request - 只能包含 `entryId` 或 `key` 之一。
 * @returns 测试结果；连接失败也返回 `ok: true`。
 */
export async function testConnection(
  context: ActionContext,
  request: TestConnectionRequest,
): Promise<TestConnectionResult> {
  const resolved = await resolveTest(context, request)
  const outcome: ProbeOutcome = resolved.probe === undefined
    ? {
      connected: false,
      durationMs: 0,
      ...(resolved.failure === undefined ? {} : { error: resolved.failure }),
    }
    : await probeMcp(resolved.probe)
  const serverInfo = outcome.serverName === undefined && outcome.serverVersion === undefined
    ? undefined
    : {
      ...(outcome.serverName === undefined ? {} : { name: outcome.serverName }),
      ...(outcome.serverVersion === undefined ? {} : { version: outcome.serverVersion }),
    }
  return {
    ok: true,
    target: resolved.target,
    ...(resolved.entryId === undefined ? {} : { entryId: resolved.entryId }),
    ...(resolved.key === undefined ? {} : { key: resolved.key }),
    serverName: resolved.serverName,
    transport: resolved.transport,
    connected: outcome.connected,
    durationMs: outcome.durationMs,
    checkedAt: new Date().toISOString(),
    ...(outcome.protocolVersion === undefined ? {} : { protocolVersion: outcome.protocolVersion }),
    ...(serverInfo === undefined ? {} : { serverInfo }),
    ...(outcome.toolCount === undefined ? {} : { toolCount: outcome.toolCount }),
    ...(outcome.toolNames === undefined ? {} : { toolNames: outcome.toolNames }),
    ...(outcome.warning === undefined ? {} : { warning: outcome.warning }),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  }
}

async function resolveTest(context: ActionContext, request: TestConnectionRequest): Promise<ResolvedTest> {
  const entryId = typeof request.entryId === 'string' ? request.entryId.trim() : ''
  const key = typeof request.key === 'string' ? request.key.trim() : ''
  if ((entryId === '') === (key === '')) {
    throw new ActionError(400, 'invalid-request', '需要且只能提供 entryId 或 key')
  }
  return entryId === '' ? resolveSource(context, key) : resolveDshEntry(context, entryId)
}

/** 连接测试会读取的配置字段。 */
const CONNECTION_KEYS = ['command', 'url', 'cwd', 'args', 'env', 'headers'] as const

async function resolveDshEntry(context: ActionContext, entryId: string): Promise<ResolvedTest> {
  const entry = [...context.loader.entries()].find(item => item.options?.id === entryId)
  let config: Record<string, unknown>
  let expression: boolean
  if (entry !== undefined) {
    if (!isMcpModule(entry.options?.name)) {
      throw new ActionError(404, 'not-found', `没有找到 ${entryId} 对应的 MCP 配置`)
    }
    const runtime = isRecord(entry.fiber?.config) ? entry.fiber.config : undefined
    const declared = isRecord(entry.options?.config) ? entry.options.config : {}
    config = runtime ?? declared
    expression = runtime === undefined && containsExpression(config)
  } else {
    const patch = await readProfilePatch(context.profile.patchPath)
    const row = insertedRows(patch).find(item => item.id === entryId)
    if (row === undefined) throw new ActionError(404, 'not-found', `没有找到 ${entryId} 对应的 MCP 配置`)
    config = rowConfig(row)
    expression = rowConfigHasExpression(row, CONNECTION_KEYS) || containsExpression(config)
  }
  return targetOf('dsh', { entryId }, config, entryId, expression)
}

async function resolveSource(context: ActionContext, key: string): Promise<ResolvedTest> {
  const saved = await readProjects(context.profile.home)
  const scan = await scanAll({
    loader: context.loader,
    profile: context.profile,
    savedProjects: saved.projects,
    configProjects: context.configProjects,
    liveReload: context.liveReload,
  })
  const server = scan.rawByKey.get(key)
  if (server === undefined) {
    throw new ActionError(409, 'source-changed', '源配置已经变化，请刷新后重试')
  }
  const raw = server.raw
  if (raw.unsupported !== undefined) {
    return unavailable('source', { key }, raw.name, raw.transport, 'unresolved', 'The source configuration is not usable as-is', raw.unsupported)
  }
  return targetOf('source', { key }, {
    serverName: raw.name,
    transport: raw.transport,
    command: raw.command,
    args: raw.args,
    env: raw.env,
    cwd: raw.cwd,
    url: raw.url,
    headers: raw.headers,
  }, raw.name)
}

function targetOf(
  target: 'dsh' | 'source',
  ids: TargetIds,
  config: Record<string, unknown>,
  fallbackName: string,
  expression = containsExpression(config),
): ResolvedTest {
  const serverName = asString(config.serverName) ?? fallbackName
  const transport = transportOf(config)
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    return unavailable(target, ids, serverName, transport, 'unsupported', `transport ${transport} cannot be probed`)
  }
  if (expression) {
    return unavailable(target, ids, serverName, transport, 'unresolved', 'the configuration still contains unevaluated expressions')
  }
  if (transport === 'stdio') {
    const command = asString(config.command)
    if (command === undefined) {
      return unavailable(target, ids, serverName, transport, 'missing-command', 'the stdio MCP has no command')
    }
    const args = asStringArray(config.args)
    const env = asStringRecord(config.env)
    const cwd = asString(config.cwd)
    return resolved(target, ids, serverName, transport, {
      name: serverName,
      transport,
      command,
      ...(args === undefined ? {} : { args }),
      ...(env === undefined ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
    })
  }
  const url = asString(config.url)
  if (url === undefined) {
    return unavailable(target, ids, serverName, transport, 'missing-url', 'the streamable-http MCP has no url')
  }
  const headers = asStringRecord(config.headers)
  return resolved(target, ids, serverName, transport, {
    name: serverName,
    transport,
    url,
    ...(headers === undefined ? {} : { headers }),
  })
}

function resolved(
  target: 'dsh' | 'source',
  ids: TargetIds,
  serverName: string,
  transport: McpTransport,
  probe: ProbeTarget,
): ResolvedTest {
  return {
    target,
    ...(ids.entryId === undefined ? {} : { entryId: ids.entryId }),
    ...(ids.key === undefined ? {} : { key: ids.key }),
    serverName,
    transport,
    probe,
  }
}

function unavailable(
  target: 'dsh' | 'source',
  ids: TargetIds,
  serverName: string,
  transport: McpTransport,
  code: TestFailureCode,
  message: string,
  detail?: string,
): ResolvedTest {
  return {
    target,
    ...(ids.entryId === undefined ? {} : { entryId: ids.entryId }),
    ...(ids.key === undefined ? {} : { key: ids.key }),
    serverName,
    transport,
    failure: { code, message, ...(detail === undefined ? {} : { detail }) },
  }
}

/** 从 mcp-client 配置推断传输方式。 */
export function transportOf(config: Record<string, unknown>): McpTransport {
  const declared = asString(config.transport)
  if (declared === 'stdio' || declared === 'streamable-http' || declared === 'sse') return declared
  if (asString(config.url) !== undefined) return 'streamable-http'
  if (asString(config.command) !== undefined) return 'stdio'
  return 'unknown'
}

/** 判断 loader 条目是否由 mcp-client 提供。 */
export function isMcpModule(name: string | undefined): boolean {
  return name === '@deepseek-ai/dsh-mcp-client' || (name?.endsWith('/dsh-mcp-client') ?? false)
}

/**
 * 判断连接字段里是否还有 `!!js` 表达式；配置文件里的表达式只有 Loader 能求值。
 * 只检查与连接有关的字段，避免无关字段上的表达式误伤测试。
 */
function containsExpression(config: Record<string, unknown>): boolean {
  return [config.command, config.url, config.cwd, config.args, config.env, config.headers]
    .some(hasExpression)
}

function hasExpression(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExpression)
  if (!isRecord(value)) return false
  if (typeof value.__jsExpr === 'string' && Object.keys(value).length === 1) return true
  return Object.values(value).some(hasExpression)
}
