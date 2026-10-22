/** 注册在 DSH 认证通道下的 HTTP 接口。 */
import type { ErrorResponse, LinkRequest, ProjectsRequest, UnlinkRequest, UpdateEntryRequest } from '../protocol.js'
import { API_BASE } from '../protocol.js'
import { ActionError, entryDetail, linkServer, saveProjectPaths, unlinkServer, updateEntry, type ActionContext } from './actions.js'
import { scanAll, type LoaderLike, type ProfileLike } from './scan.js'
import { readProjects } from './state.js'

/** Connection Fetch 路由的最小结构。 */
interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  readonly fetch: (request: Request) => Promise<Response>
}

/** Connection 服务的最小接口。 */
interface ConnectionLike {
  readonly fetch: {
    register(route: FetchRoute): () => Promise<void>
  }
}

/** 路由需要的宿主上下文。 */
export interface RoutesContext {
  readonly getConnection: () => ConnectionLike | undefined
  readonly getLoader: () => LoaderLike | undefined
  readonly getProfile: () => ProfileLike | undefined
  readonly getLiveReload: () => boolean
  readonly projects: readonly string[]
  readonly log: {
    info(message: string): void
    warn(message: string): void
  }
  readonly effect: (register: () => () => Promise<void>, label: string) => void
}

/** 注册全部接口。 */
export function registerRoutes(context: RoutesContext): void {
  const connection = context.getConnection()
  if (connection === undefined) {
    context.log.warn('mcp_setting.connection_missing: Connection service is unavailable')
    return
  }
  const routes: FetchRoute[] = [
    {
      path: `${API_BASE}/scan`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: request => handle(context, request, scan),
    },
    {
      path: `${API_BASE}/link`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handle(context, request, link),
    },
    {
      path: `${API_BASE}/unlink`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handle(context, request, unlink),
    },
    {
      path: `${API_BASE}/projects`,
      methods: ['GET', 'PUT'],
      requestBody: 'buffered',
      fetch: request => handle(context, request, projects),
    },
    {
      path: `${API_BASE}/entry`,
      methods: ['GET', 'PUT'],
      requestBody: 'buffered',
      fetch: request => handle(context, request, entry),
    },
  ]
  for (const route of routes) {
    context.effect(
      () => connection.fetch.register(route),
      `dsh-mcp-setting: ${route.path}`,
    )
  }
}

async function scan(context: RoutesContext, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const extraProject = url.searchParams.get('project')?.trim() ?? ''
  const saved = await readProjects(profileOf(context).home)
  const projects = extraProject === '' ? saved.projects : [...saved.projects, extraProject]
  const result = await scanAll({
    loader: loaderOf(context),
    profile: profileOf(context),
    savedProjects: projects,
    configProjects: context.projects,
    liveReload: context.getLiveReload(),
  })
  return json({
    ...result.response,
    warnings: [...(saved.warning === undefined ? [] : [saved.warning]), ...result.response.warnings],
  })
}

async function link(context: RoutesContext, request: Request): Promise<Response> {
  const body = await readJson<LinkRequest>(request)
  if (typeof body.key !== 'string' || body.key === '') {
    throw new ActionError(400, 'invalid-request', '缺少 key')
  }
  if (body.serverName !== undefined && typeof body.serverName !== 'string') {
    throw new ActionError(400, 'invalid-request', 'serverName 必须是字符串')
  }
  const response = await linkServer(actionContext(context), body)
  context.log.info(`mcp_setting.link_completed: entry=${response.entryId} applied=${String(response.applied)}`)
  return json(response)
}

async function unlink(context: RoutesContext, request: Request): Promise<Response> {
  const body = await readJson<UnlinkRequest>(request)
  if (typeof body.entryId !== 'string' || body.entryId === '') {
    throw new ActionError(400, 'invalid-request', '缺少 entryId')
  }
  const response = await unlinkServer(actionContext(context), body.entryId)
  context.log.info(`mcp_setting.unlink_completed: entry=${body.entryId} applied=${String(response.applied)}`)
  return json(response)
}

async function entry(context: RoutesContext, request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const entryId = new URL(request.url).searchParams.get('entryId') ?? ''
    const response = await entryDetail(actionContext(context), entryId)
    context.log.info(`mcp_setting.entry_read: entry=${entryId}`)
    return json(response)
  }
  const body = await readJson<UpdateEntryRequest>(request)
  if (typeof body.entryId !== 'string' || body.entryId === '') {
    throw new ActionError(400, 'invalid-request', '缺少 entryId')
  }
  const response = await updateEntry(actionContext(context), body)
  context.log.info(`mcp_setting.entry_updated: entry=${body.entryId} applied=${String(response.applied)}`)
  return json(response)
}

async function projects(context: RoutesContext, request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const saved = await readProjects(profileOf(context).home)
    return json({ ok: true, projects: saved.projects })
  }
  const body = await readJson<ProjectsRequest>(request)
  if (!Array.isArray(body.projects) || body.projects.some(item => typeof item !== 'string')) {
    throw new ActionError(400, 'invalid-request', 'projects 必须是字符串数组')
  }
  const saved = await saveProjectPaths(actionContext(context), body.projects)
  return json({ ok: true, projects: saved })
}

async function handle(
  context: RoutesContext,
  request: Request,
  handler: (context: RoutesContext, request: Request) => Promise<Response>,
): Promise<Response> {
  try {
    return await handler(context, request)
  } catch (error) {
    if (error instanceof ActionError) {
      return json(errorBody(error.code, error.message), error.status)
    }
    const message = error instanceof Error ? error.message : String(error)
    context.log.warn(`mcp_setting.request_failed: ${request.method} ${new URL(request.url).pathname} ${message}`)
    return json(errorBody('internal', message), 500)
  }
}

function loaderOf(context: RoutesContext): LoaderLike {
  const loader = context.getLoader()
  if (loader === undefined) throw new ActionError(503, 'loader-unavailable', '当前环境没有可用的 DSH Loader')
  return loader
}

function profileOf(context: RoutesContext): ProfileLike {
  const profile = context.getProfile()
  if (profile === undefined) throw new ActionError(503, 'profile-unavailable', '当前不是 dsh profile 启动，无法管理配置')
  return profile
}

function actionContext(context: RoutesContext): ActionContext {
  return {
    loader: loaderOf(context),
    profile: profileOf(context),
    liveReload: context.getLiveReload(),
    configProjects: context.projects,
  }
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    const value: unknown = await request.json()
    if (typeof value !== 'object' || value === null) throw new Error('请求体必须是 JSON 对象')
    return value as T
  } catch (error) {
    if (error instanceof ActionError) throw error
    throw new ActionError(400, 'invalid-json', `请求体解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function errorBody(code: string, message: string): ErrorResponse {
  return { ok: false, error: { code, message } }
}
