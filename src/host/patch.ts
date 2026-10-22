/** 读写当前 profile 的 `cordis.patch.yml`，只改 MCP 客户端插入行。 */
import { readFile, writeFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, visit, Scalar, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import type { PatchRow } from './types.js'
import { writeFileAtomic } from './util.js'

const JS_TAG = 'tag:yaml.org,2002:js'
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'

/** 一个已解析的 profile patch 文档。 */
export interface ProfilePatch {
  readonly file: string
  /** 文件原始内容，用于失败回滚。 */
  readonly original: string
  readonly document: Document
}

/** 一条 inserted MCP 行及其所在容器。 */
export interface InsertedRow {
  readonly id: string
  readonly name: string
  readonly map: YAMLMap
  readonly sequence: YAMLSeq
  readonly container: YAMLMap
  readonly containerIndex: number
  readonly rowIndex: number
}

/** 读取 profile patch；文件不存在时按空数组处理。 */
export async function readProfilePatch(file: string): Promise<ProfilePatch> {
  let original = '[]\n'
  try {
    original = await readFile(file, 'utf8')
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') {
      throw new Error(`读取 profile patch 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const document = parseDocument(original === '' ? '[]\n' : original, {
    customTags: [{ tag: JS_TAG, resolve: (value: string) => value }],
  })
  if (document.errors.length > 0) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('profile patch 顶层必须是 YAML 数组')
  document.contents.flow = false
  return { file, original, document }
}

/** 列出所有 inserted MCP 行。 */
export function insertedRows(patch: ProfilePatch): InsertedRow[] {
  const sequence = patch.document.contents
  if (!isSeq(sequence)) return []
  const output: InsertedRow[] = []
  sequence.items.forEach((item, containerIndex) => {
    if (!isMap(item)) return
    const insert = item.get('insert')
    if (!isSeq(insert)) return
    insert.items.forEach((row, rowIndex) => {
      if (!isMap(row)) return
      const id = row.get('id')
      const name = row.get('name')
      if (typeof id !== 'string' || typeof name !== 'string') return
      if (!isMcpModule(name)) return
      output.push({
        id,
        name,
        map: row,
        sequence: insert,
        container: item,
        containerIndex,
        rowIndex,
      })
    })
  })
  return output
}

/** 当前 patch 里出现过的所有行 id（含覆盖行）。 */
export function patchIds(patch: ProfilePatch): Set<string> {
  const output = new Set<string>()
  const sequence = patch.document.contents
  if (!isSeq(sequence)) return output
  for (const item of sequence.items) {
    if (!isMap(item)) continue
    const id = item.get('id')
    if (typeof id === 'string') output.add(id)
    const insert = item.get('insert')
    if (!isSeq(insert)) continue
    for (const row of insert.items) {
      if (!isMap(row)) continue
      const rowId = row.get('id')
      if (typeof rowId === 'string') output.add(rowId)
    }
  }
  return output
}

/** 判断某个 id 是否由 inserted MCP 行占用。 */
export function hasInsertedRow(patch: ProfilePatch, id: string): boolean {
  return insertedRows(patch).some(row => row.id === id)
}

/** 追加一条 MCP 客户端插入行。 */
export function appendMcpRow(patch: ProfilePatch, row: PatchRow): void {
  const sequence = patch.document.contents
  if (!isSeq(sequence)) throw new Error('profile patch 顶层必须是 YAML 数组')
  const node = patch.document.createNode({
    id: row.id,
    name: MCP_MODULE,
    config: configOf(row),
  })
  let target: YAMLSeq | undefined
  for (let index = sequence.items.length - 1; index >= 0; index--) {
    const item = sequence.items[index]
    if (!isMap(item)) continue
    const insert = item.get('insert')
    if (isSeq(insert)) {
      target = insert
      break
    }
  }
  if (target === undefined) {
    const container = patch.document.createNode({ insert: [node] })
    sequence.items.push(container)
  } else {
    target.items.push(node)
  }
  restoreJsExpressions(patch.document)
}

/** 移除指定 id 的 MCP 插入行；返回是否真的删除了内容。 */
export function removeMcpRow(patch: ProfilePatch, id: string): boolean {
  const sequence = patch.document.contents
  if (!isSeq(sequence)) return false
  let removed = false
  for (let containerIndex = sequence.items.length - 1; containerIndex >= 0; containerIndex--) {
    const item = sequence.items[containerIndex]
    if (!isMap(item)) continue
    const insert = item.get('insert')
    if (!isSeq(insert)) continue
    for (let rowIndex = insert.items.length - 1; rowIndex >= 0; rowIndex--) {
      const row = insert.items[rowIndex]
      if (!isMap(row)) continue
      const rowId = row.get('id')
      const name = row.get('name')
      if (rowId !== id || typeof name !== 'string' || !isMcpModule(name)) continue
      insert.items.splice(rowIndex, 1)
      removed = true
    }
    if (insert.items.length === 0) sequence.items.splice(containerIndex, 1)
  }
  if (removed) restoreJsExpressions(patch.document)
  return removed
}

/** 序列化并原子写入。 */
export async function saveProfilePatch(patch: ProfilePatch): Promise<void> {
  const text = `${String(patch.document).trimEnd()}\n`
  await writeFileAtomic(patch.file, text)
}

/** 写入失败时恢复原始内容。 */
export async function restoreProfilePatch(patch: ProfilePatch): Promise<void> {
  await writeFile(patch.file, patch.original, { mode: 0o600 })
}

/** 把一条 MCP 扫描结果转成 mcp-client 配置对象。 */
export function configOf(row: PatchRow): Record<string, unknown> {
  const config: Record<string, unknown> = {
    serverName: row.serverName,
    transport: row.transport,
  }
  if (row.transport === 'stdio') {
    if (row.command !== undefined) config.command = row.command
    if (row.args !== undefined) config.args = [...row.args]
    if (row.env !== undefined) config.env = { ...row.env }
    if (row.cwd !== undefined) config.cwd = row.cwd
  } else {
    if (row.url !== undefined) config.url = row.url
    if (row.headers !== undefined) config.headers = { ...row.headers }
  }
  return config
}

function isMcpModule(name: string): boolean {
  return name === MCP_MODULE || name.endsWith('/dsh-mcp-client')
}

/**
 * `yaml` 把 `!!js` 解析成标量后，通过普通对象节点重建文档时可能丢失标签；
 * 这里在保存前把带有 `__jsExpr` 的对象换回带标签的标量。
 */
function restoreJsExpressions(document: Document): void {
  visit(document, {
    Map(_key, node) {
      if (node.items.length !== 1) return
      const expression = node.get('__jsExpr')
      if (typeof expression !== 'string') return
      const scalar = new Scalar(expression)
      scalar.tag = JS_TAG
      return scalar
    },
  })
}
