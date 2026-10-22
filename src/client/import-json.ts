/** 把常见 MCP JSON 配置归一化成新增请求。 */
import type { CreateEntryRequest, EditablePairInput } from '../protocol.js'

/**
 * 解析一段 MCP JSON。
 * 支持单个服务对象、只含一个条目的 mcpServers/servers/mcp 映射，以及带 config 的 DSH 条目。
 * @param text - 用户粘贴的 JSON 文本。
 * @returns 可直接提交给 Host 的新增请求。
 * @throws 当 JSON 非法、一次包含多个服务或缺少必要连接字段时。
 */
export function parseMcpJson(text: string): CreateEntryRequest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return normalize(value)
}

function normalize(value: unknown): CreateEntryRequest {
  if (!isRecord(value)) throw new Error('JSON 顶层必须是对象')
  let name = ''
  let config: Record<string, unknown> = value
  if (isRecord(value.config) && (value.config.command !== undefined || value.config.url !== undefined)) {
    name = asString(value.config.serverName) ?? asString(value.serverName)
      ?? asString(value.id) ?? asString(value.name) ?? ''
    config = value.config
  } else {
    const container = value.mcpServers ?? value.servers ?? value.mcp
    if (isRecord(container)) {
      const entries = Object.entries(container)
      if (entries.length !== 1) throw new Error('一次只能导入一个 MCP，请只保留一个条目')
      const [key, entry] = entries[0] ?? []
      if (!isRecord(entry)) throw new Error('MCP 配置必须是对象')
      name = asString(entry.serverName) ?? asString(entry.name) ?? key ?? ''
      config = entry
    } else {
      name = asString(value.serverName) ?? asString(value.name) ?? ''
    }
  }
  const type = (asString(config.transport) ?? asString(config.type))?.toLowerCase()
  const commandValue = config.command
  const commandArray = Array.isArray(commandValue) ? commandValue.filter(isString) : undefined
  const command = typeof commandValue === 'string' ? commandValue : commandArray?.[0]
  const args = Array.isArray(config.args) ? config.args.filter(isString) : commandArray?.slice(1) ?? []
  const url = asString(config.url) ?? asString(config.httpUrl) ?? asString(config.http_url)
    ?? asString(config.serverUrl) ?? asString(config.server_url)
  const cwd = asString(config.cwd) ?? asString(config.workingDirectory) ?? asString(config.working_directory)
  const env = pairsOf(config.env ?? config.environment ?? config.envVars ?? config.env_vars, '环境变量')
  const headers = pairsOf(config.headers ?? config.http_headers ?? config.httpHeaders ?? config.requestHeaders, '请求头')
  const transport = transportOf(type, url, command)
  if (transport === 'sse') throw new Error('DSH 不支持 SSE 传输，请改用 streamable-http')
  if (transport === 'stdio' && (command === undefined || command === '')) {
    throw new Error('stdio MCP 缺少 command')
  }
  if (transport === 'streamable-http' && url === undefined) {
    throw new Error('Streamable HTTP MCP 缺少 url')
  }
  const timeout = config.toolCallTimeoutMs
  return {
    serverName: name,
    transport,
    ...(command === undefined ? {} : { command }),
    args,
    env,
    ...(cwd === undefined ? {} : { cwd }),
    ...(url === undefined ? {} : { url }),
    headers,
    ...(typeof timeout === 'number' && Number.isSafeInteger(timeout) && timeout > 0
      ? { toolCallTimeoutMs: timeout }
      : {}),
  }
}

function transportOf(
  type: string | undefined,
  url: string | undefined,
  command: string | undefined,
): 'stdio' | 'streamable-http' | 'sse' {
  switch (type) {
    case 'sse':
      return 'sse'
    case 'http':
    case 'streamable-http':
    case 'streamable_http':
    case 'streamablehttp':
    case 'remote':
      return 'streamable-http'
    case 'stdio':
    case 'local':
      return 'stdio'
    default:
      if (url !== undefined) return 'streamable-http'
      if (command !== undefined) return 'stdio'
      throw new Error('无法判断传输方式，请提供 command 或 url')
  }
}

function pairsOf(value: unknown, label: string): EditablePairInput[] {
  if (!isRecord(value)) return []
  return Object.entries(value).map(([key, item]) => {
    if (typeof item === 'string') return { key, value: item }
    if (typeof item === 'number' || typeof item === 'boolean') return { key, value: String(item) }
    throw new Error(`${label} ${key} 的值必须是字符串`)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
