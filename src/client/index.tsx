/**
 * dsh-mcp-setting 浏览器半：在 Settings 和左侧全局面板里注册「MCP 链接」页面。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { McpSettingsController } from './controller.js'
import { McpPanelIcon } from './McpPanelIcon.js'
import { McpSettingsPanel, McpSettingsSection } from './Section.js'
import { en, zh, NS, type McpLocaleKey } from './locales.js'
import { STYLE_TEXT } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP 链接设置页文案。 */
    'settings.mcpSetting': McpLocaleKey
  }
}

/** 左侧全局面板的 id，与主面板 key 保持一致。 */
const PANEL_ID = 'mcp-settings' as MainPanelId

/** 浏览器半需要的服务。 */
export const inject = ['slots', 'locale', 'workspaces']

/**
 * 注册设置页。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-setting: dictionaries')
  const controller = new McpSettingsController(ctx.workspaces.list)
  ctx.effect(() => () => { controller.dispose() }, 'dsh-mcp-setting: controller')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-mcp-setting'
    style.dataset.pluginCss = 'dsh-mcp-setting/page'
    style.textContent = STYLE_TEXT
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-mcp-setting: styles')
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-setting',
    order: 35,
    label: () => t('nav'),
    locale: NS,
    inject: () => controller.inject(),
  }, McpSettingsSection)), 'dsh-mcp-setting: settings section')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => controller.inject(),
  }, McpSettingsPanel)), 'dsh-mcp-setting: main panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1000,
    label: () => t('nav'),
    locale: NS,
  }, McpPanelIcon)), 'dsh-mcp-setting: sidebar entry')
}
