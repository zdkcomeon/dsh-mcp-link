# dsh-mcp-link 推广手册

给维护者自己用的操作清单：定位、渠道、现成文案、待办和度量。不包含任何账号或 token。

## 1. 一句话定位

中文：

> 把 Cursor、Claude Code、Codex CLI、Gemini CLI、VS Code 等 13 种客户端里已有的 MCP 配置，一键接入 DeepSeek Harness；接入后还能测试连接、断线重连。

英文：

> Import the MCP servers you already configured in Claude Desktop, Claude Code, Cursor, VS Code, Codex CLI, Gemini CLI and eight more clients into DeepSeek Harness, with connection testing and one-click reconnect.

### 和同类插件的差别

同类插件主要解决“已接入之后的工具检索、可视化管理和健康诊断”。本项目解决“接入之前”和“接入之后出故障”这两段，据各自 README 的自我描述对比：

| 插件 | 它主要解决 | 本项目的位置 |
| --- | --- | --- |
| `dsh-mcp` | MCP 管理界面 + tool search 热注入，控制上下文占用 | 不抢工具检索，先把手抄配置的时间省掉 |
| `dsh-mcp-panel` | 已接入 MCP 的健康诊断、管线试调用、`/mcp` 命令 | 额外负责从其他客户端发现配置，不只是看已接入的 |
| `dsh-mcp-connector` | 远程 MCP 目录、OAuth 授权、跨连接工具搜索 | 处理本机已有配置和项目级 `.mcp.json`，不需要账号授权 |
| `dsh-mcp-link` | 13 种客户端配置扫描 → 接入 → 测试 → 重连（含 Agent 工具） | — |

宣传时只讲自己的场景，不要拉踩；用户往往同时装两三个插件，互补比替代更好卖。

## 2. 当前状态盘点（2026-10-30）

| 项目 | 现状 | 判断 |
| --- | --- | --- |
| npm | `dsh-mcp-link@0.1.1`，`latest` 已指向 | 可安装，正常 |
| GitHub topics | 仅 `dsh-plugin` | 靠它被生态自动发现，够用但不充分 |
| GitHub description | 147 字符的两段话拼接，缺关键词 | 需要改，直接影响所有自动收录站的简介 |
| GitHub homepage | 空 | 需要填 |
| GitHub 星标 | 1 | 冷启动阶段 |
| awesome-dsh-plugin | 已自动收录进 `tools-capabilities`，但条目**没有描述**，只有 `⭐1` | 在 2.3 万条清单里等于隐身，改 description 后等下次同步 |
| dshbase.com `PLUGINS.md` | 未登记 | 可提 PR |
| deepseekplugin.org | 404，未收录 | 视其收录方式决定是否提交 |
| npm 关键词搜索 | `keywords:dsh-plugin` 命中 11,178 个包，本项目不在前 250 | npm 站内搜索基本带不来量，别指望 |
| 官方仓库 | `deepseek-ai/deepseek-harness` 开放 Discussions | 潜在的精准流量入口 |

结论：**收录机制已经通了，问题在“被看到时说不清自己是什么”**。所以优先级是元数据 > 首屏文案 > 人工投递 > 社区发帖。

## 3. 行动清单

### P0 仓库元数据（半小时内可完成，收益最大）

在 GitHub 仓库页面 `Settings` 顶部即可编辑，或用 API：

```sh
GH_TOKEN=你的_token \
curl -s -X PATCH https://api.github.com/repos/zdkcomeon/dsh-mcp-link \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -d '{
    "description": "DeepSeek Harness (DSH) 插件：扫描 Cursor、Claude Code、Codex CLI、Gemini CLI、VS Code 等 13 种客户端的 MCP 配置，一键接入 DSH profile，支持连接测试、断线重连和项目级 .mcp.json 导入。",
    "homepage": "https://www.npmjs.com/package/dsh-mcp-link",
    "topics": ["dsh-plugin","dsh","deepseek-harness","mcp","mcp-client","mcp-config","cursor","claude-code","typescript","cordis","developer-tools"]
  }'
```

要点：

- description 必须是**单行**、把“DSH 插件”和“MCP”放在前半句，因为收录站大多截断到 100 字符左右。
- topics 里 `dsh-plugin` 不能删，它是生态所有目录的抓取入口；其余用来覆盖 GitHub 站内搜索。
- 改完后等 awesome-dsh-plugin 的每日同步（其 `categories/*.md` 每天更新），条目描述会自动补上。

### P1 首屏文案（已改，需要你提交推送）

`README.md` 顶部已重写：一句话定位、徽章、一行安装命令、为什么需要它。首屏决定别人看完标题后是否继续往下读。

### P2 人工投递

| 目标 | 动作 | 备注 |
| --- | --- | --- |
| awesome-dsh-plugin | 已自动收录。若想立刻补描述，PR 修改 `categories/tools-capabilities.md` 里对应那行为带描述的格式 | 等自动同步更省事 |
| dshbase.com | 按 `PLUGINS.md` 的 PR 格式登记一行 | 先读它的 CONTRIBUTING 确认字段 |
| DSH 插件市场（`chnjames/dsh-plugin-market`） | 无需 PR，它按 GitHub topic + npm 关键词抓取，CI 定时刷新 | 确保 topics 和 npm keywords 齐全即可 |
| deepseekplugin.org | 先确认它是否有提交入口，没有就跳过 | 未收录站点不必强求 |
| 官方 Discussions | 在 `deepseek-ai/deepseek-harness` 的 Discussions 发一条 Show and tell | 见下方文案，注意别发成广告 |

### P3 社区发帖

先选 2 到 3 个渠道，不要全平台同一时间贴同一条内容。推荐顺序：官方 Discussions → V2EX → 掘金技术文。X 和 Reddit 用来覆盖英文用户，可选。

## 4. 现成文案

### GitHub Discussions（Show and tell）

标题：`[插件] dsh-mcp-link：把 Cursor / Claude Code / Gemini CLI 里的 MCP 配置一键搬进 DSH`

> 换到 DSH 之后，最费时间的不是装插件，而是把散落在 Cursor、Claude Code、Codex CLI、Gemini CLI、VS Code 里的 MCP 配置重新抄一遍：命令、参数、工作目录、环境变量、请求头，漏一个就连不上。
>
> 另外接入之后经常遇到 `server is disconnected`，不好判断是配置写错了、服务挂了，还是 DSH 侧的连接已经失效。
>
> dsh-mcp-link 把这两件事放在一个页面里：
>
> - 扫描 13 种客户端的 MCP 配置，按来源分标签，显示哪些已经接入
> - 一键写入当前 profile 的 `cordis.patch.yml`，保留注释和未修改的 `!!js` 表达式
> - 项目 MCP：从 DSH 工作区多选，扫描 `.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json`
> - 测试连接：新开一次握手，显示耗时、协议版本、服务信息和工具数量；失败时说明原因
> - 失败重连：原地重载 mcp-client，完成后自动再测一次；Agent 也能调用 `mcp_link_reconnect` 自己修
>
> 安装：`dsh plugin --profile desktop add dsh-mcp-link`（Web profile 用 `--profile web`），重启后左侧出现 `MCP 链接`。
>
> 仓库：https://github.com/zdkcomeon/dsh-mcp-link
> npm：https://www.npmjs.com/package/dsh-mcp-link
>
> 截图和限制在 README 里。已知不足：不支持 SSE，`${input:...}` 占位符需要先补全，测试会新开连接所以单实例服务可能失败。用下来有问题欢迎直接开 issue。

### V2EX（分享节点）

标题：`做了一个 DSH 插件，把各个 AI 客户端的 MCP 配置导进 DeepSeek Harness`

正文用上面那段，去掉“欢迎开 issue”改成“有问题回帖或开 issue 都行”，并补一句真实背景，例如你原本要手工维护几份配置。V2EX 反感纯推广，务必写清楚解决了什么麻烦。

### 掘金 / 知乎（技术文，转化最好但成本高）

建议写成实操文而不是产品介绍，标题方向：

- `从 Cursor 迁到 DeepSeek Harness：MCP 配置怎么不重抄一遍`
- `MCP 报 server is disconnected 到底是谁的问题：一次握手诊断的实践`

文章结构：痛点场景 → 手工迁移的完整步骤与坑（这部分要真实，有代码和配置）→ 插件怎么自动化这些步骤 → 实现要点（YAML AST 保留注释、敏感值不回传浏览器、fiber 原地重载）→ 限制与取舍。最后再放安装命令和仓库链接。

### X / Twitter

英文：

> Built a DSH plugin: import MCP servers you already configured in Cursor, Claude Code, Codex CLI, Gemini CLI, VS Code and 9 more clients into DeepSeek Harness. Connection test + one-click reconnect, and agents can self-heal via a tool call.
>
> `dsh plugin --profile desktop add dsh-mcp-link`
> npm: https://www.npmjs.com/package/dsh-mcp-link

中文：

> 把 Cursor、Claude Code、Codex CLI、Gemini CLI、VS Code 里已有的 MCP 配置，一键接进 DeepSeek Harness，还能测连接和断线重连。装完重启，左侧多一个 MCP 链接。
> `dsh plugin --profile desktop add dsh-mcp-link`

配图用 `docs/screenshots/01-overview.png`，别用超过两张。

### Reddit / Hacker News

只在英文 README 完善后再发，否则进来的人看不懂。`r/DeepSeek`、`r/mcp` 可以发；HN 的 Show HN 需要英文标题和能自解释的落地页，优先级最低。

## 5. 节奏建议

| 时间 | 做什么 |
| --- | --- |
| D0 | 改 description / topics / homepage，提交 README 改动并推送 |
| D1 | 找 3 到 5 个真实 DSH 用户装上，收集“哪一步卡住”，据此改文案和 README |
| D3 | 官方 Discussions 发帖；确认 awesome-dsh-plugin 条目已带上描述 |
| D5 | V2EX 发帖，按反馈补 FAQ |
| D7 | 掘金或知乎发实操文；有英文 README 再发 X / Reddit |

## 6. 度量

```sh
# npm 每周下载量
curl -s https://api.npmjs.org/downloads/point/last-week/dsh-mcp-link

# 仓库星标与关注
curl -s https://api.github.com/repos/zdkcomeon/dsh-mcp-link | \
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.stargazers_count,j.subscribers_count,j.open_issues_count)})"
```

看三个数就够：每周下载量、星标增量、issue 数量。issue 里有真实反馈比星标更有价值；没有 issue 但下载量涨，说明文案到位但产品还没人深用。

## 7. 不要做的事

- 不要在每个群和每个平台同一时间贴同一段话，容易被当垃圾信息。
- 不要刷星，GitHub 和收录站都能看出来，反而影响可信度。
- 不要在描述里堆竞品关键词，检索权重不看这个，反而让人看不懂这插件干什么。
- 不要承诺还没做的能力，例如 SSE、OAuth；README 的限制章节已经写了没有，宣传口径要和它一致。
