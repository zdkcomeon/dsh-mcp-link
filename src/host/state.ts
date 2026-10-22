/** 插件自己的小型持久化状态：用户保存的项目路径。 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './util.js'

/** 状态文件格式。 */
interface StateDocument {
  readonly version: 1
  readonly projects: readonly string[]
}

/** 读取保存的项目列表；损坏时返回空列表并附带警告。 */
export async function readProjects(home: string): Promise<{ projects: string[]; warning?: string }> {
  const file = stateFile(home)
  try {
    const text = await readFile(file, 'utf8')
    const data: unknown = JSON.parse(text)
    if (typeof data !== 'object' || data === null || !('projects' in data) || !Array.isArray(data.projects)) {
      return { projects: [], warning: `状态文件 ${file} 格式不正确，已忽略` }
    }
    return {
      projects: data.projects.filter((item): item is string => typeof item === 'string'),
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { projects: [] }
    }
    return { projects: [], warning: `读取状态文件 ${file} 失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 原子保存项目列表。 */
export async function writeProjects(home: string, projects: readonly string[]): Promise<void> {
  const data: StateDocument = { version: 1, projects }
  await writeFileAtomic(stateFile(home), `${JSON.stringify(data, null, 2)}\n`)
}

/** 插件状态目录。 */
export function stateDirectory(home: string): string {
  return join(home, 'mcp-setting')
}

function stateFile(home: string): string {
  return join(stateDirectory(home), 'state.json')
}
