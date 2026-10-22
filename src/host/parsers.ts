/** 解析各类客户端常见的 MCP 配置文件。 */
import { readFile, stat } from 'node:fs/promises'
import { parse as parseToml } from 'smol-toml'
import { parse as parseYaml } from 'yaml'
import type { ParsedSource, RawMcpServer, SourceDescriptor, SourceFormat } from './types.js'
import { asString, asStringArray, asStringRecord, field, isRecord, parseJsonc } from './util.js'

/** 文件不存在时返回该标记；存在但读取失败时抛出可展示的错误。 */
export const MISSING = Symbol('missing')

/** 读取并解析一个来源文件。 */
export async function readSource(descriptor: SourceDescriptor): Promise<ParsedSource | typeof MISSING> {
  let text: string
  try {
    const info = await stat(descriptor.path)
    if (!info.isFile()) throw new Error(`不是普通文件：${descriptor.path}`)
    if (info.size > 5 * 1024 * 1024) throw new Error(`文件超过 5 MiB：${descriptor.path}`)
    text = await readFile(descriptor.path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return MISSING
    throw new Error(`读取 ${descriptor.path} 失败：${errorMessage(error)}`)
  }
  try {
    return { servers: parseSourceDescriptor(descriptor, text).servers }
  } catch (error) {
    throw new Error(`解析 ${descriptor.path} 失败：${errorMessage(error)}`)
  }
}

/** 按来源描述符解析；Claude Code 的项目条目需要额外知道项目路径。 */
export function parseSourceDescriptor(descriptor: SourceDescriptor, text: string): ParsedSource {
  const data = parseText(descriptor.format, text)
  if (descriptor.format === 'claude-code-project') {
    return {
      servers: descriptor.projectPath === undefined
        ? []
        : parseClaudeCodeProject(data, descriptor.projectPath),
    }
  }
  return { servers: serversOf(descriptor.format, data) }
}

/** 解析文本内容；拆出来便于单元测试。 */
export function parseSourceText(format: SourceFormat, text: string): ParsedSource {
  const data = parseText(format, text)
  return { servers: serversOf(format, data) }
}

/** 解析 Claude Code 的 `~/.claude.json`：顶层与 projects 下都可能带 mcpServers。 */
export function parseClaudeCodeConfig(data: unknown, projectPath?: string): RawMcpServer[] {
  const servers = serversOf('claude', data)
  if (projectPath === undefined) return servers
  return [...servers, ...parseClaudeCodeProject(data, projectPath)]
}

/** 只取 Claude Code 中某个项目的 mcpServers。 */
export function parseClaudeCodeProject(data: unknown, projectPath: string): RawMcpServer[] {
  const projects = field(data, 'projects')
  if (!isRecord(projects)) return []
  const project = projects[projectPath]
  if (!isRecord(project)) return []
  return serversOf('claude', project)
}

function parseText(format: SourceFormat, text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  if (format === 'codex') return parseToml(trimmed)
  if (format === 'continue' && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return parseYaml(trimmed)
  }
  return parseJsonc(trimmed)
}

function serversOf(format: SourceFormat, data: unknown): RawMcpServer[] {
  const root = isRecord(data) ? data : {}
  if (format === 'opencode') return collect(root.mcp)
  if (format === 'zed') return collect(root.context_servers)
  if (format === 'codex') return collect(root.mcp_servers)
  const container = root.mcpServers ?? root.servers ?? root.mcp_servers
  return collect(container)
}

function collect(container: unknown): RawMcpServer[] {
  if (Array.isArray(container)) {
    const output: RawMcpServer[] = []
    for (const item of container) {
      const name = asString(field(item, 'name')) ?? asString(field(item, 'id'))
      if (name === undefined) continue
      const server = serverOf(name, item)
      if (server !== undefined) output.push(server)
    }
    return output
  }
  if (!isRecord(container)) return []
  const output: RawMcpServer[] = []
  for (const [name, value] of Object.entries(container)) {
    if (!isRecord(value)) continue
    const server = serverOf(name, value)
    if (server !== undefined) output.push(server)
  }
  return output
}

function serverOf(name: string, value: unknown): RawMcpServer | undefined {
  const record = isRecord(value) ? value : {}
  const type = asString(record.type)?.toLowerCase()
  const url = asString(record.url) ?? asString(record.httpUrl) ?? asString(record.http_url)
    ?? asString(record.serverUrl) ?? asString(record.server_url)
  const commandValue = record.command
  const zedCommand = isRecord(commandValue) ? commandValue : undefined
  let command: string | undefined
  let args: string[] | undefined
  if (typeof commandValue === 'string') {
    command = asString(commandValue)
    args = asStringArray(record.args)
  } else if (Array.isArray(commandValue)) {
    const parts = asStringArray(commandValue)
    if (parts !== undefined && parts.length > 0) {
      command = parts[0]
      args = parts.slice(1)
    }
  } else if (zedCommand !== undefined) {
    command = asString(zedCommand.path) ?? asString(zedCommand.command)
    args = asStringArray(zedCommand.args)
  } else {
    command = asString(record.command)
    args = asStringArray(record.args)
  }
  const env = asStringRecord(record.env) ?? asStringRecord(record.environment)
    ?? asStringRecord(record.envVars) ?? asStringRecord(record.env_vars)
  const headers = asStringRecord(record.headers) ?? asStringRecord(record.http_headers)
    ?? asStringRecord(record.httpHeaders) ?? asStringRecord(record.requestHeaders)
  const cwd = asString(record.cwd) ?? asString(record.workingDirectory) ?? asString(record.working_directory)
  const transport = transportOf(type, url, command)
  const disabled = record.disabled === true || record.enabled === false
  const unsupported = unsupportedOf({ url, command, args, env, headers, transport })
  return {
    name,
    transport,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(url === undefined ? {} : { url }),
    ...(headers === undefined ? {} : { headers }),
    ...(disabled ? { disabled: true } : {}),
    ...(unsupported === undefined ? {} : { unsupported }),
  }
}

function transportOf(
  type: string | undefined,
  url: string | undefined,
  command: string | undefined,
): RawMcpServer['transport'] {
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
      return 'unknown'
  }
}

function unsupportedOf(input: {
  url: string | undefined
  command: string | undefined
  args: string[] | undefined
  env: Record<string, string> | undefined
  headers: Record<string, string> | undefined
  transport: RawMcpServer['transport']
}): string | undefined {
  const hasInputReference = [
    input.command,
    input.url,
    ...(input.args ?? []),
    ...Object.values(input.env ?? {}),
    ...Object.values(input.headers ?? {}),
  ].some(value => value !== undefined && value.includes('${input:'))
  if (hasInputReference) return '配置里包含 ${input:...} 变量，需要先在源配置中补全'
  if (input.transport === 'sse') return 'DSH 目前不支持 SSE 传输，只能接入 stdio 或 Streamable HTTP'
  if (input.transport === 'stdio' && input.command === undefined) return '缺少 command'
  if (input.transport === 'streamable-http' && input.url === undefined) return '缺少 url'
  if (input.transport === 'unknown') return '无法判断传输方式，缺少 command 或 url'
  return undefined
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
