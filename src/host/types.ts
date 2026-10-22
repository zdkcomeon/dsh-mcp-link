/** Host 内部使用的扫描与配置模型。 */
import type { McpTransport } from '../protocol.js'

/** 从任意来源解析出来的一条 MCP 配置。 */
export interface RawMcpServer {
  readonly name: string
  readonly transport: McpTransport
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly unsupported?: string
  readonly disabled?: boolean
}

/** 一个待扫描的配置文件。 */
export interface SourceDescriptor {
  /** 稳定的来源 id，例如 claude-desktop、cursor-project。 */
  readonly sourceId: string
  /** 给用户看的来源名。 */
  readonly label: string
  readonly path: string
  readonly format: SourceFormat
  readonly scope: 'global' | 'project'
  readonly projectPath?: string
}

/** 支持的文件格式。 */
export type SourceFormat =
  | 'claude'
  | 'claude-code'
  | 'claude-code-project'
  | 'cursor'
  | 'vscode'
  | 'windsurf'
  | 'cline'
  | 'roo'
  | 'codex'
  | 'gemini'
  | 'continue'
  | 'opencode'
  | 'zed'
  | 'lmstudio'

/** 扫描得到的完整条目；只在 Host 进程内使用，含未脱敏的 env/headers。 */
export interface ScannedServer {
  /** 对浏览器公开的稳定标识。 */
  readonly key: string
  readonly source: SourceDescriptor
  readonly raw: RawMcpServer
}

/** 扫描一个文件的结果。 */
export interface ParsedSource {
  readonly servers: readonly RawMcpServer[]
}

/** 写回 profile patch 时使用的一行 MCP 客户端配置。 */
export interface PatchRow {
  readonly id: string
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly toolCallTimeoutMs?: number
}
