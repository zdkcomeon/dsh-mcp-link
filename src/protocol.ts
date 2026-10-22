/**
 * dsh-mcp-link 的浏览器端与 Host 端共用协议。
 *
 * 这里只放可序列化数据和路径常量，不放任何 Node 或浏览器专属实现。
 */

/** 插件在 DSH Connection 的 `/api` 通道下占用的路径前缀。 */
export const API_BASE = '/api/mcp-setting'

/** MCP 传输方式；`sse` 只用于展示，DSH 当前不支持接入。 */
export type McpTransport = 'stdio' | 'streamable-http' | 'sse' | 'unknown'

/** 一条系统 MCP 配置对浏览器可见的字段（敏感值不离开 Host）。 */
export interface PublicMcpServer {
  /** Host 端重新扫描时使用的稳定标识。 */
  readonly key: string
  /** 配置里声明的服务名。 */
  readonly name: string
  readonly transport: McpTransport
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
  readonly cwd?: string
  /** 环境变量名，值由 Host 保存。 */
  readonly envKeys: readonly string[]
  readonly secretEnvKeys: readonly string[]
  readonly headerKeys: readonly string[]
  readonly secretHeaderKeys: readonly string[]
  /** 配置本身要求用户输入，当前无法无损迁移到 DSH。 */
  readonly unsupported?: string
  /** 配置里标了 disabled。 */
  readonly disabled?: boolean
  /** 已经接入 DSH 的条目 id。 */
  readonly linkedEntryId?: string
  /** 已接入 DSH 的 serverName，可能与源配置不同名。 */
  readonly linkedServerName?: string
  /** DSH 里存在同名但不同连接参数的条目。 */
  readonly nameConflictEntryId?: string
  /** 接入时建议使用的 DSH serverName。 */
  readonly suggestedName: string
}

/** 一个系统 MCP 配置来源。 */
export interface McpSourceGroup {
  readonly sourceId: string
  readonly label: string
  readonly path: string
  readonly scope: 'global' | 'project'
  readonly projectPath?: string
  readonly servers: readonly PublicMcpServer[]
  /** 文件存在但读取或解析失败时的说明。 */
  readonly error?: string
}

/** 当前 DSH 已加载的 MCP 客户端条目。 */
export interface DshMcpEntry {
  readonly entryId: string
  readonly serverName: string
  readonly transport: McpTransport
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
  readonly envKeys: readonly string[]
  readonly headerKeys: readonly string[]
  readonly enabled: boolean
  /** 条目来自 profile patch、home patch、bundle 还是启动 overlay。 */
  readonly source: 'profile' | 'home' | 'bundle' | 'overlay'
  /** 能否从本插件移除（只有 profile patch 里插入的行可以）。 */
  readonly editable: boolean
  /** 本插件曾经写入的条目。 */
  readonly managed: boolean
}

/** 编辑表单中的一组键值；secret 为 true 时不返回原值。 */
export interface EditablePair {
  readonly key: string
  /** 敏感值不回传；其余值回传用于编辑。 */
  readonly value?: string
  readonly secret: boolean
  /** 原值是 `!!js` 表达式；保持不变时 Host 会原样保留。 */
  readonly expression?: boolean
}

/** 当前 profile 中一条可由本插件编辑的 MCP 条目。 */
export interface EditableEntry {
  readonly entryId: string
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env: readonly EditablePair[]
  readonly cwd?: string
  readonly url?: string
  readonly headers: readonly EditablePair[]
  readonly toolCallTimeoutMs?: number
}

/** `GET /api/mcp-setting/entry` 的响应。 */
export interface EntryDetailResponse {
  readonly ok: true
  readonly entry: EditableEntry
}

/** 提交编辑时的一组键值；省略 value 表示保留原值。 */
export interface EditablePairInput {
  readonly key: string
  readonly value?: string
}

/** 新增或编辑 MCP 时提交的连接设置。 */
export interface EntrySettings {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command?: string
  readonly args?: readonly string[]
  readonly env: readonly EditablePairInput[]
  readonly cwd?: string
  readonly url?: string
  readonly headers: readonly EditablePairInput[]
  readonly toolCallTimeoutMs?: number
}

/** 新增一条 MCP。 */
export interface CreateEntryRequest extends EntrySettings {}

/** 新增结果。 */
export interface CreateEntryResponse {
  readonly ok: true
  readonly entryId: string
  readonly serverName: string
  readonly applied: boolean
  readonly restartRequired: boolean
}

/** 更新一条已接入 MCP 的配置。 */
export interface UpdateEntryRequest extends EntrySettings {
  readonly entryId: string
}

/** 更新结果。 */
export interface UpdateEntryResponse {
  readonly ok: true
  readonly applied: boolean
  readonly restartRequired: boolean
}

/** 项目扫描结果。 */
export interface ProjectScan {
  readonly path: string
  readonly name: string
  readonly sources: readonly McpSourceGroup[]
  readonly error?: string
}

/** 当前运行 profile 的事实。 */
export interface ProfileInfo {
  readonly name: string
  readonly patchPath: string
  readonly home: string
  readonly cwd: string
  /** 写入配置后是否会热加载。 */
  readonly reload: 'live' | 'restart'
}

/** `GET /api/mcp-setting/scan` 的响应。 */
export interface ScanResponse {
  readonly ok: true
  readonly generatedAt: string
  readonly profile: ProfileInfo
  readonly dsh: readonly DshMcpEntry[]
  readonly system: readonly McpSourceGroup[]
  readonly projects: readonly ProjectScan[]
  readonly savedProjects: readonly string[]
  readonly warnings: readonly string[]
}

/** 接入一条系统 MCP。 */
export interface LinkRequest {
  readonly key: string
  /** 可选；不传则使用 Host 计算的建议名。 */
  readonly serverName?: string
}

/** 接入结果。 */
export interface LinkResponse {
  readonly ok: true
  readonly entryId: string
  readonly serverName: string
  readonly applied: boolean
  readonly restartRequired: boolean
  readonly alreadyLinked?: boolean
}

/** 从当前 profile 移除一条 MCP。 */
export interface UnlinkRequest {
  readonly entryId: string
}

/** 移除结果。 */
export interface UnlinkResponse {
  readonly ok: true
  readonly applied: boolean
  readonly restartRequired: boolean
}

/** 保存项目列表。 */
export interface ProjectsRequest {
  readonly projects: readonly string[]
}

/** 保存项目列表的结果。 */
export interface ProjectsResponse {
  readonly ok: true
  readonly projects: readonly string[]
}

/** 统一错误响应。 */
export interface ErrorResponse {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
  }
}
