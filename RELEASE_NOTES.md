# dsh-mcp-link 0.1.1 发版说明

- 发布日期：2026-10-29
- 版本：0.1.1
- 仓库：https://github.com/zdkcomeon/dsh-mcp-link
- npm：https://www.npmjs.com/package/dsh-mcp-link

## 版本概述

`dsh-mcp-link` 0.1.1 增加连接测试和失败重连，用于排查并恢复 MCP 使用一段时间后断开、连不上或配置写错的情况。

## 主要变化

- `已接入 DSH`、系统 MCP、项目 MCP 的每一行新增 `测试连接` 按钮。
- 测试会按当前配置新开一次 MCP 握手，支持 `stdio` 和 `streamable-http`。
- 成功时显示耗时、协议版本、服务名称和版本、工具数量。
- 失败时区分命令无法启动、进程提前退出、握手超时、网络错误、HTTP 状态错误、协议错误和 JSON-RPC 错误，并显示诊断信息。
- 配置里包含只有 Loader 能求值的 `!!js` 表达式时，测试会直接说明无法独立求值。
- 测试失败且属于连接类问题时弹出确认框，可以直接重连。
- 测试成功的结果行也提供 `重连`，用于测试通过但工具调用仍提示 `server is disconnected` 的情况。
- 重连会原地重载 mcp-client fiber，使用 `fiber.update(config, true)` 跳过配置写回；完成后自动再做一次连接测试。
- 新增 `mcp_link_reconnect` Agent 工具，支持用 `serverName` 或 `entryId` 重连。
- 测试和重连接口只接受标识，命令、URL、环境变量和请求头都从 Host 侧配置读取。
- 新增 `POST /api/mcp-setting/reconnect`。

## 兼容性

- DSH `0.2.0-rc.2` 及以上；Host 侧握手和接口已在 DSH `0.2.1-rc.3` 环境中验证。
- 构建需要 Node.js `22.19` 及以上。
- 已有的 profile patch、系统配置和项目配置不需要迁移；升级只替换插件 bundle。

## 安装与升级

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-mcp-link
```

Web profile 使用 `--profile web`。新增 bundle 后重启 DSH；只修改 `lib/client.js` 时刷新页面即可。

## 已知限制

- 连接测试会新开一个 stdio 子进程或 HTTP 会话，不复用 DSH 当前的长连接。测试通过只说明服务当前可以建立新连接。
- 只能单实例运行的服务可能在测试时多启动一个实例，或因为端口和文件锁而失败。
- 连接测试的总超时为 20 秒；依赖 `npx` 冷启动的服务可能超时，可以稍后重试。
- 重连最多等待 20 秒让 mcp-client 完成重启；超时后仍可能在后台继续重试。
- 只有已经在 DSH 中运行的 mcp-client 条目可以重连，已禁用的条目需要先启用。
- 服务本身不可达时，重连会完成重载但连接测试仍然失败；服务恢复后由 mcp-client 自己的重连策略继续尝试。
- 仍不支持 SSE 传输、MCP OAuth 和凭据交互。

## 验证

- `pnpm verify` 通过，50 个测试全部通过。
- 覆盖 stdio 握手、Streamable HTTP 的 JSON 与 SSE 响应、工具列表分页、超时、命令不存在、进程提前退出、HTTP 错误、JSON-RPC 错误、`!!js` 表达式、fiber 重载、Agent 工具、`/api/mcp-setting/test` 和 `/api/mcp-setting/reconnect`。
- 用本机的 codegraph stdio 服务和 IntelliJ IDEA streamable-http 服务验证了真实握手、协议协商和工具列表读取。
- 在 desktop profile 中以 `link:` 方式安装 0.1.1 后，通过认证后的 `/api/mcp-setting/test` 对 codegraph 和 idea 各做了一次真实测试，两者均返回连接成功。
- 通过认证后的 `/api/mcp-setting/reconnect` 重连 codegraph，重载耗时 484ms，重连后测试成功并返回 1 个工具。
- 通过 `mcp_link_reconnect` 工具重连 idea，返回 `Reconnected idea, protocol 2025-11-25, 66 tools.`，重连后 IDE 工具仍可用。
- 两次重连后 `cordis.patch.yml` 和 `cordis.yml` 的哈希、大小和修改时间都没有变化，两个 MCP 条目仍为启用状态。

---

# dsh-mcp-link 0.1.0 发版说明

- 发布日期：2026-10-22
- 版本：0.1.0
- 仓库：https://github.com/zdkcomeon/dsh-mcp-link
- npm：https://www.npmjs.com/package/dsh-mcp-link

## 版本概述

`dsh-mcp-link` 0.1.0 是项目重命名后的首个公开版本。

插件用于在 DeepSeek Harness 中集中查看、接入和管理本机 MCP 配置，提供左侧导航入口和设置页入口。本版本覆盖系统 MCP 扫描、来源切换、项目工作区扫描、JSON 导入、图形化新增、编辑、移除和敏感值保护。

## 主要亮点

- 左侧导航与设置页双入口，共用同一份状态。
- 系统 MCP 按来源显示顶部标签页，点击 Cursor、Codex CLI、Gemini CLI 等应用名称即可切换。
- 项目 MCP 直接从 DSH 工作区列表多选，并支持自定义路径。
- 新增 MCP 支持 JSON 导入和图形配置两种方式。
- 编辑时保留未知配置字段和未修改的 `!!js` 表达式。
- 接入、新增和编辑会等待 Loader 加载新配置；启动失败时尝试回滚。

## 新增功能

### 入口与页面

- 在左侧导航中注册 `MCP 链接` 全局面板，位置在工作区标题上方。
- 在 `设置 → MCP 链接` 注册同一份页面。
- 两个入口共用控制器和状态，新增、编辑、移除和刷新会同步。

### 系统 MCP

- 扫描 Claude Desktop、Claude Code、Cursor、VS Code、Windsurf、Codex CLI、Gemini CLI、Cline、Roo Code、Continue、OpenCode、Zed、LM Studio 等客户端的配置。
- 按来源展示顶部标签页，标签显示服务数量，已接入服务的来源显示绿色圆点。
- 自动识别已经接入 DSH 的服务，并处理同名但连接参数不同的名称冲突。
- 支持 `stdio` 和 `streamable-http`；SSE 配置标记为不可接入。

### 项目 MCP

- 从 DSH 左侧工作区列表多选工作区。
- 扫描项目内的 `.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json`、`.gemini/settings.json`、`.roo/mcp.json`、`opencode.json` 等文件。
- 替换 `${workspaceFolder}`、`${workspaceRoot}`、`${projectPath}`、`${cwd}` 等项目变量。
- 支持添加不在工作区列表中的自定义路径。

### 新增与导入

- 支持粘贴单个服务对象、只含一个条目的 `mcpServers` 映射，或 DSH `mcp-client` 配置。
- JSON 解析后显示服务名、传输方式、命令或 URL、环境变量和请求头预览。
- 支持在图形表单中填写服务名、传输方式、命令、启动参数、工作目录、环境变量、URL、请求头和工具调用超时。
- 保存前校验服务名冲突、命令、URL、超时和键值重复。
- 写入后等待 Loader 加载新配置；启动失败时回滚新增条目。

### 编辑与移除

- 编辑服务名、传输方式、命令、参数、工作目录、环境变量、URL、请求头和工具调用超时。
- 非敏感值回填到表单；敏感值不返回浏览器，留空表示保留当前值。
- 表单未覆盖的字段原样保留，包括 `reconnect`、`failOnStartupError` 等。
- 未修改的 `!!js` 表达式保留原标签。
- 移除只删除当前 profile patch 中由本插件插入的条目，不修改源配置。

### 安全与可靠性

- 接口注册在 DSH 的 `/api` 认证通道下，沿用浏览器 Cookie 认证和 Host/Origin 校验。
- 扫描结果只返回环境变量和请求头的键名及敏感标记。
- URL 中的用户名、密码和敏感查询参数在返回浏览器前脱敏。
- profile patch 使用 YAML AST 修改，保留注释、缩进和未修改的标量标签。
- 写入使用临时文件替换，文件权限为 `0600`。
- Host 日志只记录条目 id、操作结果等诊断信息，不记录环境变量和请求头的值。

## 兼容性

- DSH `0.2.0-rc.2` 及以上；已在 DSH `0.2.1-rc.2` 的 desktop 和 web profile 上验证。
- 构建需要 Node.js `22.19` 及以上。
- 支持 macOS、Windows 和 Linux 的常见配置路径。
- 仅支持 `stdio` 和 `streamable-http` 传输。
- profile patch 中已有的 `mcp-link-*` MCP 条目和配置可以继续使用。

## 安装

桌面 profile：

```sh
dsh plugin --profile desktop add dsh-mcp-link
```

Web profile：

```sh
dsh plugin --profile web add dsh-mcp-link
```

安装后重启 DSH，左侧导航和设置页会出现 `MCP 链接`。

## 从旧版本升级

本版本将包名和插件 id 统一为 `dsh-mcp-link`。

`dsh-mcp-setting` 是 npm 上属于其他维护者的包，不是本项目的包，请勿安装同名包。

如果之前通过本地 link 安装过旧名称，先移除旧依赖，再安装新包：

```sh
dsh plugin --profile desktop remove dsh-mcp-setting
dsh plugin --profile desktop add dsh-mcp-link
```

Web profile 同理：

```sh
dsh plugin --profile web remove dsh-mcp-setting
dsh plugin --profile web add dsh-mcp-link
```

升级只替换插件 bundle，profile patch 中已有的 `mcp-link-*` MCP 条目和配置不受影响。新增 bundle 后需要重启 DSH。

## 已知限制

- 不支持 SSE 传输，也不处理 MCP OAuth 和凭据交互。
- 配置中包含 `${input:...}` 等未解析占位符时不可接入。
- 源配置中 `disabled: true` 的条目不可接入。
- 只有当前 profile patch 中由本插件插入的条目可以编辑或移除。
- HMR 未启用时，写入配置后需要重启 DSH 才能生效。
- 系统配置的扫描结果取决于各客户端配置文件的格式和可读性；解析失败时页面会显示来源错误，不影响其他来源。

## 验证

- `pnpm verify` 通过，23 个测试全部通过。
- 在 DSH `0.2.1-rc.2` 的 desktop 和 web profile 上完成接入、新增、编辑、JSON 导入和来源切换验证。
- README 中的界面截图来自测试 profile，覆盖主面板、编辑、新增、JSON 导入和图形配置。

## 相关链接

- 仓库：https://github.com/zdkcomeon/dsh-mcp-link
- npm：https://www.npmjs.com/package/dsh-mcp-link
- 问题反馈：https://github.com/zdkcomeon/dsh-mcp-link/issues
- 使用文档：https://github.com/zdkcomeon/dsh-mcp-link#readme
