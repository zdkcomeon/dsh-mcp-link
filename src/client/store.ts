/** 极小的快照 store，满足 slot hooks 的 HostObservable 接口。 */
export class SnapshotStore<T> {
  private value: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) {
    this.value = initial
  }

  /** 读取当前快照。 */
  readonly getSnapshot = (): T => this.value

  /** 订阅快照变化。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 整体替换快照并通知订阅者。 */
  set(next: T): void {
    this.value = next
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // 一个订阅者失败不能阻断其他订阅者。
      }
    }
  }
}
