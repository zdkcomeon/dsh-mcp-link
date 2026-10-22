/** 已知系统 MCP 配置来源的路径表。 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SourceDescriptor } from './types.js'

function environment(): NodeJS.ProcessEnv {
  return process.env
}

function appData(): string {
  return environment().APPDATA ?? join(homedir(), 'AppData', 'Roaming')
}

function codeUserDirectory(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Code', 'User')
  if (process.platform === 'win32') return join(appData(), 'Code', 'User')
  return join(environment().XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Code', 'User')
}

function claudeDesktopConfig(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (process.platform === 'win32') return join(appData(), 'Claude', 'claude_desktop_config.json')
  return join(environment().XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Claude', 'claude_desktop_config.json')
}

function zedSettings(): string {
  return join(environment().XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'zed', 'settings.json')
}

function globalStorage(name: string): string {
  return join(codeUserDirectory(), 'globalStorage', name)
}

/** 所有全局来源。缺失的文件会被扫描阶段跳过。 */
export function globalSources(): SourceDescriptor[] {
  const home = homedir()
  return [
    {
      sourceId: 'claude-desktop',
      label: 'Claude Desktop',
      path: claudeDesktopConfig(),
      format: 'claude',
      scope: 'global',
    },
    {
      sourceId: 'claude-code',
      label: 'Claude Code',
      path: join(home, '.claude.json'),
      format: 'claude-code',
      scope: 'global',
    },
    {
      sourceId: 'cursor',
      label: 'Cursor',
      path: join(home, '.cursor', 'mcp.json'),
      format: 'cursor',
      scope: 'global',
    },
    {
      sourceId: 'vscode',
      label: 'VS Code',
      path: join(codeUserDirectory(), 'mcp.json'),
      format: 'vscode',
      scope: 'global',
    },
    {
      sourceId: 'windsurf',
      label: 'Windsurf',
      path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      format: 'windsurf',
      scope: 'global',
    },
    {
      sourceId: 'codex',
      label: 'Codex CLI',
      path: join(home, '.codex', 'config.toml'),
      format: 'codex',
      scope: 'global',
    },
    {
      sourceId: 'gemini',
      label: 'Gemini CLI',
      path: join(home, '.gemini', 'settings.json'),
      format: 'gemini',
      scope: 'global',
    },
    {
      sourceId: 'cline',
      label: 'Cline',
      path: globalStorage(join('saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')),
      format: 'cline',
      scope: 'global',
    },
    {
      sourceId: 'roo',
      label: 'Roo Code',
      path: globalStorage(join('rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json')),
      format: 'roo',
      scope: 'global',
    },
    {
      sourceId: 'continue-yaml',
      label: 'Continue',
      path: join(home, '.continue', 'config.yaml'),
      format: 'continue',
      scope: 'global',
    },
    {
      sourceId: 'continue-json',
      label: 'Continue',
      path: join(home, '.continue', 'config.json'),
      format: 'continue',
      scope: 'global',
    },
    {
      sourceId: 'opencode',
      label: 'OpenCode',
      path: join(environment().XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode', 'opencode.json'),
      format: 'opencode',
      scope: 'global',
    },
    {
      sourceId: 'zed',
      label: 'Zed',
      path: zedSettings(),
      format: 'zed',
      scope: 'global',
    },
    {
      sourceId: 'lmstudio',
      label: 'LM Studio',
      path: join(home, '.lmstudio', 'mcp.json'),
      format: 'lmstudio',
      scope: 'global',
    },
  ]
}

/** 一个项目内常见的 MCP 配置文件。 */
export function projectSources(projectPath: string): SourceDescriptor[] {
  return [
    {
      sourceId: 'claude-project',
      label: 'Claude Code 项目配置',
      path: join(projectPath, '.mcp.json'),
      format: 'claude',
      scope: 'project',
      projectPath,
    },
    {
      sourceId: 'cursor-project',
      label: 'Cursor 项目配置',
      path: join(projectPath, '.cursor', 'mcp.json'),
      format: 'cursor',
      scope: 'project',
      projectPath,
    },
    {
      sourceId: 'vscode-project',
      label: 'VS Code 项目配置',
      path: join(projectPath, '.vscode', 'mcp.json'),
      format: 'vscode',
      scope: 'project',
      projectPath,
    },
    {
      sourceId: 'gemini-project',
      label: 'Gemini CLI 项目配置',
      path: join(projectPath, '.gemini', 'settings.json'),
      format: 'gemini',
      scope: 'project',
      projectPath,
    },
    {
      sourceId: 'opencode-project',
      label: 'OpenCode 项目配置',
      path: join(projectPath, 'opencode.json'),
      format: 'opencode',
      scope: 'project',
      projectPath,
    },
    {
      sourceId: 'roo-project',
      label: 'Roo Code 项目配置',
      path: join(projectPath, '.roo', 'mcp.json'),
      format: 'roo',
      scope: 'project',
      projectPath,
    },
  ]
}
