/** 设置页的数据读取与动作控制器。 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ErrorResponse,
  LinkRequest,
  LinkResponse,
  ProjectsRequest,
  ProjectsResponse,
  ScanResponse,
  UnlinkRequest,
  UnlinkResponse,
} from '../protocol.js'
import { API_BASE } from '../protocol.js'
import { SnapshotStore } from './store.js'
import type { WorkspaceSourceLike } from './workspaces.js'

/** 一次性操作结果。 */
export type McpNotice =
  | { readonly kind: 'linked'; readonly restartRequired: boolean }
  | { readonly kind: 'unlinked'; readonly restartRequired: boolean }
  | { readonly kind: 'projects-saved' }
  | { readonly kind: 'error'; readonly message: string }

/** 下拉列表中的一项工作区或自定义项目。 */
export interface WorkspaceOption {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly selected: boolean
  /** 不在 DSH 工作区列表里、由用户手动添加的路径。 */
  readonly custom: boolean
}

/** 页面快照。 */
export interface McpSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly data?: ScanResponse
  readonly error?: string
  /** 正在执行的操作键。 */
  readonly busy: readonly string[]
  readonly notice?: McpNotice
  /** 工作区列表加手动添加的路径。 */
  readonly workspaces: readonly WorkspaceOption[]
  /** 工作区列表的加载状态。 */
  readonly workspaceState: 'loading' | 'ready' | 'error'
}

/** 注入给页面的动作面。 */
export interface McpSettingsInjected {
  readonly hooks: {
    readonly mcpSettings: HostObservable<McpSnapshot>
  }
  refresh: () => void
  clearNotice: () => void
  link: (key: string, serverName: string) => Promise<boolean>
  unlink: (entryId: string) => Promise<boolean>
  /** 勾选或取消一个工作区/自定义路径。 */
  setProjectSelected: (path: string, selected: boolean) => Promise<boolean>
  /** 清空所有已选路径。 */
  clearProjects: () => Promise<boolean>
  /** 添加一个不在工作区列表里的项目路径。 */
  addProject: (path: string) => Promise<boolean>
}

const INITIAL: McpSnapshot = {
  status: 'loading',
  busy: [],
  workspaces: [],
  workspaceState: 'loading',
}

/** 管理页面状态与所有 Host 请求。 */
export class McpSettingsController {
  private readonly store = new SnapshotStore<McpSnapshot>(INITIAL)
  private readonly workspaceSource: WorkspaceSourceLike
  private readonly unsubscribeWorkspaces: () => void
  private selectedPaths = new Set<string>()
  private generation = 0
  private disposed = false
  private noticeTimer: ReturnType<typeof setTimeout> | undefined

  /** @param workspaceSource - DSH 工作区列表服务（`ctx.workspaces.list`）。 */
  constructor(workspaceSource: WorkspaceSourceLike) {
    this.workspaceSource = workspaceSource
    this.unsubscribeWorkspaces = workspaceSource.subscribe(() => { this.syncWorkspaces() })
    this.syncWorkspaces()
  }

  /** 读取一次扫描结果。 */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    this.patch(current => {
      const { error: _error, ...rest } = current
      return {
        ...rest,
        status: current.data === undefined ? 'loading' : 'ready',
        busy: addBusy(current.busy, 'refresh'),
      }
    })
    try {
      const data = await request<ScanResponse>('/scan')
      if (this.stale(generation)) return
      this.selectedPaths = new Set(data.savedProjects)
      this.patch(current => {
        const { error: _error, ...rest } = current
        return {
          ...rest,
          status: 'ready',
          data,
          busy: removeBusy(current.busy, 'refresh'),
        }
      })
      this.syncWorkspaces()
    } catch (error) {
      if (this.stale(generation)) return
      this.patch(current => ({
        ...current,
        status: current.data === undefined ? 'error' : 'ready',
        error: messageOf(error),
        busy: removeBusy(current.busy, 'refresh'),
      }))
    }
  }

  /** 接入一条系统 MCP。 */
  async link(key: string, serverName: string): Promise<boolean> {
    const busyKey = `link:${key}`
    this.patch(current => ({ ...current, busy: addBusy(current.busy, busyKey) }))
    try {
      const body: LinkRequest = { key, serverName }
      const result = await request<LinkResponse>('/link', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      this.setNotice({ kind: 'linked', restartRequired: result.restartRequired })
      await this.refresh()
      return true
    } catch (error) {
      this.setNotice({ kind: 'error', message: messageOf(error) })
      return false
    } finally {
      this.patch(current => ({ ...current, busy: removeBusy(current.busy, busyKey) }))
    }
  }

  /** 从当前 profile 移除一条 MCP。 */
  async unlink(entryId: string): Promise<boolean> {
    const busyKey = `unlink:${entryId}`
    this.patch(current => ({ ...current, busy: addBusy(current.busy, busyKey) }))
    try {
      const body: UnlinkRequest = { entryId }
      const result = await request<UnlinkResponse>('/unlink', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      this.setNotice({ kind: 'unlinked', restartRequired: result.restartRequired })
      await this.refresh()
      return true
    } catch (error) {
      this.setNotice({ kind: 'error', message: messageOf(error) })
      return false
    } finally {
      this.patch(current => ({ ...current, busy: removeBusy(current.busy, busyKey) }))
    }
  }

  /** 保存项目列表。 */
  async saveProjects(projects: readonly string[]): Promise<boolean> {
    const previous = this.selectedPaths
    this.selectedPaths = new Set(projects)
    this.syncWorkspaces()
    this.patch(current => ({ ...current, busy: addBusy(current.busy, 'projects') }))
    try {
      const body: ProjectsRequest = { projects }
      await request<ProjectsResponse>('/projects', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      this.setNotice({ kind: 'projects-saved' })
      await this.refresh()
      return true
    } catch (error) {
      this.selectedPaths = previous
      this.syncWorkspaces()
      this.setNotice({ kind: 'error', message: messageOf(error) })
      return false
    } finally {
      this.patch(current => ({ ...current, busy: removeBusy(current.busy, 'projects') }))
    }
  }

  /** 勾选或取消一个工作区/自定义路径。 */
  async setProjectSelected(path: string, selected: boolean): Promise<boolean> {
    const next = new Set(this.selectedPaths)
    if (selected) next.add(path)
    else next.delete(path)
    return this.saveProjects([...next])
  }

  /** 清空所有已选路径。 */
  async clearProjects(): Promise<boolean> {
    return this.saveProjects([])
  }

  /** 追加一个不在工作区列表里的项目路径。 */
  async addProject(path: string): Promise<boolean> {
    const next = new Set(this.selectedPaths)
    next.add(path)
    return this.saveProjects([...next])
  }

  /** 构造注入面。 */
  inject(): McpSettingsInjected {
    return {
      hooks: { mcpSettings: this.store },
      refresh: () => { void this.refresh() },
      clearNotice: () => { this.setNotice(undefined) },
      link: (key, serverName) => this.link(key, serverName),
      unlink: entryId => this.unlink(entryId),
      setProjectSelected: (path, selected) => this.setProjectSelected(path, selected),
      clearProjects: () => this.clearProjects(),
      addProject: path => this.addProject(path),
    }
  }

  /** 释放定时器并忽略迟到的响应。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.unsubscribeWorkspaces()
    if (this.noticeTimer !== undefined) {
      clearTimeout(this.noticeTimer)
      this.noticeTimer = undefined
    }
  }

  private stale(generation: number): boolean {
    return this.disposed || generation !== this.generation
  }

  /** 把 DSH 工作区列表与已选路径合并为下拉选项。 */
  private syncWorkspaces(): void {
    if (this.disposed) return
    const snapshot = this.workspaceSource.getSnapshot()
    const workspacePaths = new Set(snapshot.items.map(item => item.path))
    const workspaces: WorkspaceOption[] = snapshot.items.map(item => ({
      id: item.workspaceId,
      path: item.path,
      title: item.title.trim() === '' ? baseName(item.path) : item.title,
      selected: this.selectedPaths.has(item.path),
      custom: false,
    }))
    for (const path of this.selectedPaths) {
      if (workspacePaths.has(path)) continue
      workspaces.push({
        id: `custom:${path}`,
        path,
        title: baseName(path),
        selected: true,
        custom: true,
      })
    }
    const workspaceState = snapshot.phase === 'ready'
      ? snapshot.state === 'error' ? 'error' : 'ready'
      : 'loading'
    this.patch(current => ({ ...current, workspaces, workspaceState }))
  }

  private patch(update: (current: McpSnapshot) => McpSnapshot): void {
    if (this.disposed) return
    this.store.set(update(this.store.getSnapshot()))
  }

  private setNotice(notice: McpNotice | undefined): void {
    if (this.noticeTimer !== undefined) {
      clearTimeout(this.noticeTimer)
      this.noticeTimer = undefined
    }
    this.patch(current => {
      if (notice === undefined) {
        const { notice: _drop, ...rest } = current
        return rest
      }
      return { ...current, notice }
    })
    if (notice !== undefined) {
      this.noticeTimer = setTimeout(() => {
        this.noticeTimer = undefined
        this.patch(current => {
          const { notice: _drop, ...rest } = current
          return rest
        })
      }, 8000)
    }
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let parsed: unknown = {}
  if (text !== '') {
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(text)
    }
  }
  if (!response.ok) {
    const failure = parsed as Partial<ErrorResponse>
    throw new Error(failure.error?.message ?? `HTTP ${String(response.status)}`)
  }
  return parsed as T
}

function addBusy(busy: readonly string[], key: string): string[] {
  return busy.includes(key) ? [...busy] : [...busy, key]
}

function removeBusy(busy: readonly string[], key: string): string[] {
  return busy.includes(key) ? busy.filter(item => item !== key) : [...busy]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/u, '').split(/[\\/]/u)
  return parts[parts.length - 1] ?? path
}
