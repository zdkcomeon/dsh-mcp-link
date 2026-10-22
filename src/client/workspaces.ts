/** 浏览器半读取 DSH 工作区列表所需的最小类型。 */
export interface WorkspaceViewLike {
  readonly workspaceId: string
  /** 工作区的规范目录路径。 */
  readonly path: string
  /** 用户可见的工作区标题。 */
  readonly title: string
}

/** 工作区列表快照。 */
export interface WorkspaceSnapshotLike {
  readonly items: readonly WorkspaceViewLike[]
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase: 'pending' | 'ready'
}

/** 工作区列表的只读观察源。 */
export interface WorkspaceSourceLike {
  getSnapshot(): WorkspaceSnapshotLike
  subscribe(listener: () => void): () => void
}

/** 工作区服务的最小接口。 */
export interface WorkspacesLike {
  readonly list: WorkspaceSourceLike
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** DSH 的工作区列表服务，由 api-workspace-controller 提供。 */
    workspaces: WorkspacesLike
  }
}
