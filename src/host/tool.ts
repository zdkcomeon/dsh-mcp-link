/** 暴露给 Agent 的 MCP 重连工具，与页面上的重连按钮共用同一段 Host 逻辑。 */
import type { ReconnectResponse } from '../protocol.js'
import type { ActionContext } from './actions.js'
import { reconnectMcp } from './reconnect.js'
import { isRecord } from './util.js'

/** ToolRegistry 的最小接口，避免依赖 dsh 安装目录里的类型包。 */
export interface ToolsLike {
  register(definition: ToolDefinitionLike): () => void
}

/** 文本工具结果。 */
export interface ToolContentText {
  readonly type: 'text'
  readonly text: string
}

/** 工具注册需要的字段。 */
export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): readonly ToolContentText[]
  }
  readonly timeoutMs?: number
  execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown>
}

/** 工具名；带插件前缀，避免和其他插件的工具冲突。 */
export const RECONNECT_TOOL_NAME = 'mcp_link_reconnect'

/**
 * 创建重连工具。
 * @param getContext - 每次执行时读取当前 profile 的 loader 等依赖。
 * @returns 可直接交给 `ctx.tools.register` 的定义。
 */
export function createReconnectTool(getContext: () => ActionContext): ToolDefinitionLike {
  return {
    name: RECONNECT_TOOL_NAME,
    description: 'Reconnect one MCP server that DSH has loaded by reloading its mcp-client entry. Use this when a tool call reports "mcp-client(<server>): server is disconnected", or after a connection test fails. Pass serverName from the error, or entryId from MCP links. The stored configuration is not changed.',
    parameters: {
      type: 'object',
      properties: {
        serverName: {
          type: 'string',
          description: 'MCP server name as shown in the mcp-client error, for example "idea".',
        },
        entryId: {
          type: 'string',
          description: 'Loader entry id shown in MCP links, for example "mcp-idea".',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entryId: { type: 'string', description: 'Loader entry id of the reconnected MCP.' },
          serverName: { type: 'string', description: 'MCP server name.' },
          transport: { type: 'string', description: 'stdio or streamable-http.' },
          reloaded: { type: 'boolean', description: 'Whether the mcp-client entry finished reloading.' },
          connected: { type: 'boolean', description: 'Whether the connection test after the reload succeeded.' },
          reloadDurationMs: { type: 'number', description: 'Time spent reloading and testing, in milliseconds.' },
          toolCount: { type: 'number', description: 'Tool count reported by the connection test.' },
          protocolVersion: { type: 'string', description: 'MCP protocol version reported by the server.' },
          errorCode: { type: 'string', description: 'Connection test failure code when connected is false.' },
          message: { type: 'string', description: 'Human-readable outcome.' },
        },
        required: ['entryId', 'serverName', 'transport', 'reloaded', 'connected', 'reloadDurationMs', 'message'],
      },
      render: (_args, value) => {
        const message = isRecord(value) && typeof value.message === 'string'
          ? value.message
          : 'MCP reconnect finished.'
        return [{ type: 'text', text: message }]
      },
    },
    timeoutMs: 60_000,
    async execute(rawArgs, exec) {
      const args = isRecord(rawArgs) ? rawArgs : {}
      const entryId = typeof args.entryId === 'string' ? args.entryId.trim() : ''
      const serverName = typeof args.serverName === 'string' ? args.serverName.trim() : ''
      if ((entryId === '') === (serverName === '')) {
        throw new Error('Provide exactly one of serverName or entryId.')
      }
      if (exec.signal.aborted) throw new Error('The reconnect was cancelled before it started.')
      const result = await reconnectMcp(getContext(), {
        ...(entryId === '' ? {} : { entryId }),
        ...(serverName === '' ? {} : { serverName }),
      })
      return toolValue(result)
    },
  }
}

function toolValue(result: ReconnectResponse): Record<string, unknown> {
  const test = result.test
  const connected = test?.connected === true
  const failure = test?.error
  const errorCode = failure?.code ?? result.error?.code
  const detail = failure?.detail ?? failure?.message
  let message: string
  if (!result.reloaded) {
    message = `Could not reconnect ${result.serverName}: ${result.error?.message ?? 'the reload did not finish'}`
  } else if (!connected) {
    message = `Reloaded ${result.serverName}, but the connection test still failed: ${errorCode ?? 'unknown'}${detail === undefined ? '' : ` (${shorten(detail)})`}.`
  } else {
    const parts = [`Reconnected ${result.serverName}`]
    if (test?.protocolVersion !== undefined) parts.push(`protocol ${test.protocolVersion}`)
    if (test?.toolCount !== undefined) parts.push(test.toolCount === 1 ? '1 tool' : `${String(test.toolCount)} tools`)
    message = `${parts.join(', ')}.`
  }
  return {
    entryId: result.entryId,
    serverName: result.serverName,
    transport: result.transport,
    reloaded: result.reloaded,
    connected,
    reloadDurationMs: result.reloadDurationMs,
    ...(test?.toolCount === undefined ? {} : { toolCount: test.toolCount }),
    ...(test?.protocolVersion === undefined ? {} : { protocolVersion: test.protocolVersion }),
    ...(errorCode === undefined ? {} : { errorCode }),
    message,
  }
}

function shorten(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length > 300 ? `${normalized.slice(0, 300)}…` : normalized
}
