# dsh-mcp-setting

把本机各客户端里已经配置好的 MCP 服务收集起来，在 DeepSeek Harness（DSH）的 **设置 → MCP 链接** 页面里展示，并支持一键接入当前 DSH profile。

## 功能

- **已接入 DSH**：读取当前 profile 的 Loader，列出所有已加载的 `@deepseek-ai/dsh-mcp-client` 条目。
- **系统已有 MCP**：扫描常见客户端配置文件，按来源分组展示 MCP 服务。
- **项目 MCP**：直接从 DSH 左侧的工作区列表多选工作区，扫描其中的 `.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json` 等文件；也支持添加不在工作区列表里的自定义路径。
- **已链接识别**：按传输方式、命令参数或 URL 判断系统 MCP 是否已经接入 DSH；已经接入的会显示「已链接」。
- **一键接入**：把选中的 MCP 配置写入当前 profile 的 `cordis.patch.yml`，由 DSH 的 HMR 立即加载。
- **移除**：删除当前 profile patch 里由插件插入的 MCP 条目，不修改源配置。
- **项目变量**：项目来源里的 `${workspaceFolder}`、`${workspaceRoot}`、`${projectPath}`、`${cwd}` 会替换成项目路径。

## 支持的来源

| 来源 | 默认路径 | 格式 |
|---|---|---|
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`；Windows `%APPDATA%\Claude\...`；Linux `~/.config/Claude/...` | `mcpServers` |
| Claude Code | `~/.claude.json`，项目 `.mcp.json` | `mcpServers`、`projects[].mcpServers` |
| Cursor | `~/.cursor/mcp.json`，项目 `.cursor/mcp.json` | `mcpServers` |
| VS Code | Code User 目录 `mcp.json`，项目 `.vscode/mcp.json` | `servers` / `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.*]` |
| Gemini CLI | `~/.gemini/settings.json`，项目 `.gemini/settings.json` | `mcpServers` |
| Cline | VS Code `globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `mcpServers` |
| Roo Code | VS Code `globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`，项目 `.roo/mcp.json` | `mcpServers` |
| Continue | `~/.continue/config.yaml`、`config.json` | `mcpServers` |
| OpenCode | `~/.config/opencode/opencode.json`，项目 `opencode.json` | `mcp` |
| Zed | `~/.config/zed/settings.json` | `context_servers` |
| LM Studio | `~/.lmstudio/mcp.json` | `mcpServers` |

缺失的文件会被跳过；文件存在但读取或解析失败时，页面会显示该来源的错误，不影响其他来源。

## 安装

从本地目录安装到 Web profile：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-setting
```

也可以安装已发布的包或 Git 仓库：

```sh
dsh plugin --profile web add dsh-mcp-setting
dsh plugin --profile web add github:<owner>/<repo>
```

安装会把这个包加入 profile 的 `dsh.profile.bundles`，并在 profile 目录里建立依赖。**新增 bundle 后需要重启 DSH**；只修改 patch 配置时 HMR 会热加载。

仓库只提交源码，`lib/` 是构建产物，不进入 Git。从 Git 安装时由 `prepare` 执行构建；pnpm 默认会拦截依赖的构建脚本，需要先在 profile 的构建许可里允许 `dsh-mcp-setting`。也可以先克隆仓库执行 `pnpm install && pnpm build`，再用本地路径安装。

## 使用

1. 打开 **设置 → MCP 链接**。
2. 在「系统已有 MCP」里找到要接入的服务，点击「接入 DSH」。
3. 确认 DSH 服务名后点击「接入」。
4. 已接入的服务会出现在「已接入 DSH」，新的 MCP 工具在新会话里可用。
5. 如果要扫描项目内的 MCP 配置，在「项目 MCP」里点击「选择工作区」，勾选一个或多个左侧工作区；勾选变化后会自动重新扫描。下拉底部的「添加自定义路径」可以扫描未登记为工作区的目录。

「移除」只会删除当前 profile `cordis.patch.yml` 中由本插件插入的行。来自 home patch、bundle 或其他配置层的条目在页面上会标记为不可移除。

## 链接行为与限制

- 只支持 DSH `@deepseek-ai/dsh-mcp-client` 支持的 `stdio` 和 `streamable-http`。SSE 配置会显示为不可接入。
- 配置里包含 `${input:...}` 等其他占位符时不可接入，需要先在源配置里补全。项目来源的 workspace 变量会自动替换。
- 源配置里 `disabled: true` 的条目不可接入。
- 接入时会把命令、参数、URL、环境变量和请求头复制到当前 profile 的 `cordis.patch.yml`。**环境变量和请求头里的敏感值会一并写入该文件**，文件以 `0600` 权限原子写入；页面上只显示变量名，不会把值发送到浏览器。
- 同名但连接参数不同的 DSH 条目会显示「名称冲突」；接入时会自动给建议名加数字后缀，也可以在弹窗里手动改。
- 已选工作区路径保存在 `$DSH_HOME/mcp-setting/state.json`，只在本机使用。工作区列表来自 DSH 的 `ctx.workspaces`，与左侧工作区保持同步。
- 写入配置后依赖 DSH 的 HMR 热加载。HMR 未启用时，页面会提示重启后生效。
- 不处理 MCP OAuth、凭据交互和 SSE；这些需要源客户端或后续版本支持。

## 安全

- HTTP 接口注册在 DSH 的 `/api` 认证通道下：`/api/mcp-setting/scan`、`/link`、`/unlink`、`/projects`。
- 接口和页面同源，沿用 DSH 的浏览器 Cookie 认证和 Host/Origin 校验。
- 扫描结果中的 env/header 只返回键名和是否为敏感键；原始值保留在 Host 进程内，接入时由 Host 重新读取源文件并写入 profile patch。
- URL 中的用户名、密码和敏感查询参数会在返回浏览器前脱敏。

## 开发

```sh
pnpm install
pnpm build       # tsc 产出 Host 与类型，esbuild 产出 lazy-CJS 的 lib/client.js
pnpm typecheck
pnpm test
```

构建产物：

- `lib/index.js`：Host 半。
- `lib/client.js`：浏览器半，包装为 `window.__ModuleLoader__.load({ id, factory })`。
- `lib/types/**`：类型声明。

调试时可以把本地目录以 `link:` 方式安装到 profile。修改 Host 代码后重启 DSH；修改 `lib/client.js` 后刷新页面或依赖客户端 HMR。

## 目录

```
src/index.ts          Host 插件入口
src/protocol.ts       前后端共用协议
src/host/             扫描、解析、patch 写入、HTTP 路由
src/client/           设置页、控制器、文案与样式
tests/                Node 单元测试
cordis.patch.yml      插件 bundle 的配置行
```
