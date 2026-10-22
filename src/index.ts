/**
 * dsh-mcp-link Host 半：扫描系统 MCP 配置，并通过认证后的 `/api/mcp-setting/*`
 * 接口把选中的 MCP 写入当前 profile。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerRoutes } from './host/routes.js'
import type { LoaderLike, ProfileLike } from './host/scan.js'

export const name = 'dsh-mcp-link'
export const inject = ['connection', 'loader']

/** 插件配置。 */
export interface Config {
  /** 额外参与扫描的项目路径；界面上保存的项目也会合并进来。 */
  projects: string[]
}

export const Config: z<Config> = z.object({
  projects: z.array(String).default([]),
})

interface ProfileContextLike extends ProfileLike {
  readonly dir: string
}

interface ConnectionLike {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly string[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/**
 * 注册 Host 接口。
 * @param ctx - 当前 profile 的 Cordis 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx: Context, config: Config): void {
  const profile = ctx.get('profileContext') as ProfileContextLike | undefined
  if (profile === undefined) {
    ctx.logger.warn('mcp_setting.profile_context_missing: plugin is inactive outside a dsh profile')
    return
  }
  const connection = ctx.get('connection') as ConnectionLike | undefined
  const loader = ctx.get('loader') as LoaderLike | undefined
  if (connection === undefined || loader === undefined) {
    ctx.logger.warn('mcp_setting.services_missing: connection or loader is unavailable')
    return
  }
  registerRoutes({
    getConnection: () => connection,
    getLoader: () => loader,
    getProfile: () => profile,
    getLiveReload: () => ctx.get('hmr') !== undefined,
    projects: config.projects,
    log: {
      info: message => { ctx.logger.info(message) },
      warn: message => { ctx.logger.warn(message) },
    },
    effect: (register, label) => { ctx.effect(register, label) },
  })
  ctx.logger.info(`mcp_setting.ready: profile=${profile.name} patch=${profile.patchPath}`)
}
