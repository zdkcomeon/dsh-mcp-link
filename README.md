# dsh-mcp-setting

在 DeepSeek Harness 中集中查看本机 MCP 配置，并将选中的服务接入当前 DSH profile。

`dsh-mcp-setting` 是一个 DSH 插件，提供左侧导航入口和设置页入口，支持扫描系统 MCP 配置、按来源切换、扫描项目工作区、JSON 导入、图形化新增、编辑和移除。

DSH 0.2+ · Node.js 22.19+ · MIT License

![MCP 链接主面板](docs/screenshots/01-overview.png)

## 目录

- [功能](#功能)
- [界面预览](#界面预览)
- [支持的来源](#支持的来源)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [实现说明](#实现说明)
- [安全](#安全)
- [限制](#限制)
- [开发](#开发)

## 功能

- **统一入口**：左侧导航中的 `MCP 链接` 直接打开主面板；`设置 → MCP 链接` 打开同一份内容。
- **系统配置扫描**：读取 Cursor、Claude Code、Codex CLI、Gemini CLI、VS Code 等客户端的 MCP 配置。
- **来源导航**：系统 MCP 按来源显示为顶部标签页，点击应用名称切换，下方只展示当前来源的服务。
- **已链接识别**：根据传输方式、命令参数或 URL 判断服务是否已经接入 DSH，并在列表中显示 `已链接`。
- **一键接入**：把选中的配置写入当前 profile 的 `cordis.patch.yml`，由 DSH Loader 加载。
- **项目 MCP**：从 DSH 左侧工作区列表多选工作区，扫描项目内的 `.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json` 等文件；也支持添加自定义路径。
- **新增 MCP**：支持粘贴 JSON 导入，或在图形表单中填写连接信息。
- **编辑 MCP**：修改服务名、传输方式、命令、参数、工作目录、环境变量、URL、请求头和工具调用超时。
- **配置保留**：表单未覆盖的字段会原样保留；未修改的 `!!js` 表达式保留原标签。
- **移除 MCP**：删除当前 profile patch 中由本插件插入的条目，不修改源配置。
- **项目变量替换**：`${workspaceFolder}`、`${workspaceRoot}`、`${projectPath}`、`${cwd}` 会替换为项目路径。

## 界面预览

以下截图来自测试 profile，实际显示的工作区、来源和 profile 名称以本机为准。点击图片可以查看原图。

### 编辑已接入 MCP

| 编辑 MCP | 新增 MCP |
| --- | --- |
| [![编辑 MCP](docs/screenshots/02-edit-mcp.png)](docs/screenshots/02-edit-mcp.png) | [![新增 MCP](docs/screenshots/03-add-mcp.png)](docs/screenshots/03-add-mcp.png) |

### JSON 导入与图形配置

| JSON 导入 | 图形配置 |
| --- | --- |
| [![JSON 导入](docs/screenshots/04-json-import.png)](docs/screenshots/04-json-import.png) | [![图形配置](docs/screenshots/05-gui-config.png)](docs/screenshots/05-gui-config.png) |

## 支持的来源

| 来源 | 默认路径 | 格式 |
| --- | --- | --- |
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

缺失的文件会被跳过。文件存在但读取或解析失败时，页面会显示该来源的错误，不影响其他来源。

## 环境要求

- DeepSeek Harness `0.2.0-rc.2` 及以上；已在 DSH `0.2.1-rc.2` 的 desktop 和 web profile 上验证。
- Node.js `22.19` 及以上，用于本地构建和测试。
- pnpm 11，用于安装依赖和构建。

## 安装

### 从本地目录安装

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-mcp-setting
```

Web profile 使用 `--profile web`：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-mcp-setting
```

安装会把这个包加入 profile 的 `dsh.profile.bundles`，并在 profile 目录中建立依赖。新增 bundle 后需要重启 DSH；只修改 `cordis.patch.yml` 时，HMR 会热加载。

### 从 npm 或 Git 安装

```sh
# 如果包已发布到 npm
dsh plugin --profile desktop add dsh-mcp-setting
dsh plugin --profile desktop add github:<owner>/<repo>
```

从 Git 安装时由 `prepare` 执行构建。pnpm 默认会拦截依赖的构建脚本，需要先在 profile 的构建许可中允许 `dsh-mcp-setting`。也可以先在本地构建，再通过本地路径安装：

```sh
pnpm install
pnpm build
```

### 从源码构建

```sh
pnpm install
pnpm build
```

`lib/` 是构建产物，不进入 Git 仓库。

## 使用

### 打开页面

- 点击左侧导航中的 `MCP 链接`，在主面板中打开。
- 或打开 `设置 → MCP 链接`。

两个入口共用同一个控制器和状态，新增、编辑、移除和刷新会同步。

### 接入系统 MCP

1. 在 `系统已有 MCP` 顶部的来源标签中选择 Cursor、Codex CLI、Gemini CLI 等。
2. 找到要接入的服务，点击 `接入 DSH`。
3. 确认 DSH 服务名后点击 `接入`。
4. 接入成功后，服务会出现在 `已接入 DSH`，新的 MCP 工具在新会话中可用。

来源标签会显示该来源的服务数量。已经接入的服务会在标签右侧显示绿色圆点，并在列表中显示 `已链接`。

### 接入项目 MCP

1. 在 `项目 MCP` 中点击 `选择工作区`。
2. 从 DSH 左侧工作区列表中勾选一个或多个工作区。
3. 勾选变化后自动重新扫描项目内的 MCP 配置。
4. 下拉底部的 `添加自定义路径` 可以扫描未登记为工作区的目录。

项目来源中的 workspace 占位符会自动替换为项目路径。其他 `${...}` 占位符需要先在源配置中补全。

### 新增 MCP

点击 `已接入 DSH` 右上角的 `新增 MCP`，选择一种方式：

- **JSON 导入**：支持单个服务对象、只含一个条目的 `mcpServers` 映射，或 DSH `mcp-client` 配置。解析成功后会显示服务名、传输方式、命令或 URL、环境变量和请求头预览。
- **图形配置**：填写服务名、传输方式、命令、启动参数、工作目录、环境变量、URL、请求头和工具调用超时。

保存时会校验服务名冲突、命令、URL、超时和键值重复。写入后等待 Loader 加载新配置；启动失败会回滚新增条目。

### 编辑与移除

- `编辑` 会读取当前 profile patch 中该条目的配置。非敏感值回填到表单，敏感值不返回浏览器，留空表示保留当前值。
- 未知字段（例如 `reconnect`、`failOnStartupError`）会保留。
- `移除` 只删除当前 profile `cordis.patch.yml` 中由本插件插入的行。来自 home patch、bundle 或其他配置层的条目会显示为不可移除。

## 实现说明

### 数据流

1. Host 扫描系统配置和项目配置，解析为统一的 MCP 服务模型。
2. 浏览器通过认证的 `/api/mcp-setting/*` 接口读取扫描结果。
3. 用户接入、新增或编辑时，Host 重新读取源配置或表单数据，写入当前 profile 的 `cordis.patch.yml`。
4. DSH Loader 监听 patch 变化并加载新的 MCP 条目。
5. 页面在写入后刷新扫描结果，并显示 `已生效` 或 `重启后生效` 提示。

### HTTP 接口

所有接口注册在 DSH 的 `/api` 认证通道下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/mcp-setting/scan` | 读取 DSH、系统和项目 MCP 配置 |
| `POST` | `/api/mcp-setting/link` | 接入一条系统或项目 MCP |
| `POST` | `/api/mcp-setting/unlink` | 移除当前 profile 中由本插件插入的条目 |
| `GET` / `PUT` | `/api/mcp-setting/projects` | 读取或保存扫描的项目路径 |
| `GET` / `PUT` / `POST` | `/api/mcp-setting/entry` | 读取详情、编辑、新增 MCP |

### 配置写入

- 写入目标为当前 profile 的 `cordis.patch.yml`，顶层是 YAML 数组。
- 接入和新增会追加一个 `@deepseek-ai/dsh-mcp-client` 条目；编辑会更新对应条目；移除会删除对应条目。
- 使用 YAML AST 修改，保留文件中的注释、缩进和未修改的 `!!js` 标量。
- 写入使用临时文件替换，文件权限为 `0600`。
- 新条目启动失败时，插件会尝试回滚这次写入。

## 安全

- 接口和页面同源，沿用 DSH 的浏览器 Cookie 认证以及 Host/Origin 校验。
- 扫描结果中的环境变量和请求头只返回键名以及是否为敏感键；原始值保留在 Host 进程内。
- URL 中的用户名、密码和敏感查询参数在返回浏览器前脱敏。
- 编辑时敏感值不回传。留空表示保留原值，输入新值才会替换。
- JSON 导入中的 env/header 值会作为普通字符串写入 profile patch。如果 JSON 包含真实令牌，请确认导入内容。
- Host 日志只记录条目 id、操作结果等诊断信息，不记录环境变量和请求头的值。

## 限制

- 只支持 DSH `@deepseek-ai/dsh-mcp-client` 支持的 `stdio` 和 `streamable-http`。SSE 配置显示为不可接入。
- 配置中包含 `${input:...}` 等未解析占位符时不可接入；项目来源的 workspace 变量会自动替换。
- 源配置中 `disabled: true` 的条目不可接入。
- 只有当前 profile patch 中由本插件插入的条目可以编辑或移除。
- 同名但连接参数不同的 DSH 条目会显示 `名称冲突`；接入时会生成带数字后缀的建议名，也可以在弹窗中手动修改。
- 写入配置后依赖 DSH HMR。HMR 未启用时，页面会提示重启后生效。
- 不处理 MCP OAuth、凭据交互和 SSE。
- 已选工作区路径保存在 `$DSH_HOME/mcp-setting/state.json`，只在本机使用。

## 开发

```sh
pnpm install
pnpm build       # tsc 产出 Host 与类型，esbuild 产出 lazy-CJS 的 lib/client.js
pnpm typecheck
pnpm test
pnpm verify      # build + typecheck + test
```

### 构建产物

- `lib/index.js`：Host 半。
- `lib/client.js`：浏览器半，包装为 `window.__ModuleLoader__.load({ id, factory })`。
- `lib/types/**`：类型声明。

### 调试

- 本地调试可以用 `link:` 方式把目录安装到 profile。
- 修改 Host 代码后重启 DSH。
- 修改 `lib/client.js` 后刷新页面，或依赖客户端 HMR。

### 目录

```text
src/index.ts                    Host 插件入口
src/protocol.ts                 前后端共用协议
src/host/actions.ts             接入、新增、编辑、移除动作
src/host/patch.ts               YAML patch 读写与 AST 修改
src/host/routes.ts              认证 HTTP 路由
src/host/scan.ts                系统与项目 MCP 扫描
src/host/parsers.ts             各客户端配置解析
src/host/sources.ts             来源与路径定义
src/host/state.ts               项目路径状态
src/client/index.tsx            浏览器插件入口
src/client/Section.tsx          MCP 管理页面
src/client/EntryEditor.tsx      新增与编辑表单
src/client/JsonImportDialog.tsx JSON 导入弹窗
src/client/import-json.ts       JSON 配置归一化
src/client/WorkspaceSelect.tsx  工作区多选
src/client/controller.ts        页面状态与接口调用
src/client/styles.ts            页面样式
tests/                          Node 单元测试
docs/screenshots/               README 截图
cordis.patch.yml                插件 bundle 的配置行
```

## License

MIT
