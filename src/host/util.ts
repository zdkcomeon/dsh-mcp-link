/** 通用工具：路径、脱敏、原子写入与 JSONC 解析。 */
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'

/** 展开开头的 `~`。 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** 把用户输入解析成绝对路径（相对路径按进程 cwd 解析）。 */
export function absolutePath(path: string): string {
  return resolve(expandHome(path.trim()))
}

/** 稳定的短标识，用于来源 key 与条目 id。 */
export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

/** 把任意服务名裁剪成 DSH 接受的 serverName。 */
export function sanitizeServerName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32)
  return normalized === '' ? 'mcp' : normalized
}

/** 在已有名字集合里找一个不冲突的名字。 */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const sanitized = sanitizeServerName(base)
  if (!taken.has(sanitized)) return sanitized
  for (let index = 2; index < 1000; index++) {
    const suffix = `-${String(index)}`
    const candidate = `${sanitized.slice(0, 32 - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${sanitized.slice(0, 24)}-${shortHash(String(Date.now()))}`
}

/** 在已有 id 集合里找一个不冲突的插件行 id。 */
export function uniqueEntryId(prefix: string, taken: ReadonlySet<string>): string {
  if (!taken.has(prefix)) return prefix
  for (let index = 2; index < 1000; index++) {
    const candidate = `${prefix}-${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
  return `${prefix}-${shortHash(String(Date.now()))}`
}

/** 判断一个键名是否可能承载凭据。 */
export function looksSecret(key: string): boolean {
  return /(?:token|secret|password|passwd|api[-_]?key|authorization|auth[-_]?key|credential|cookie|session[-_]?id|private[-_]?key|(?:^|[-_])key(?:$|[-_]))/iu.test(key)
}

/** 脱敏 URL 里的用户名、密码和敏感 query 参数。 */
export function redactUrl(input: string): string {
  try {
    const url = new URL(input)
    if (url.username !== '' || url.password !== '') {
      url.username = '•••'
      url.password = '•••'
    }
    for (const key of [...url.searchParams.keys()]) {
      if (looksSecret(key)) url.searchParams.set(key, 'REDACTED')
    }
    return url.toString()
  } catch {
    return input
  }
}

/** 脱敏命令行参数中形如 `--token=xxx` 或 `--token xxx` 的值。 */
export function redactArgs(args: readonly string[]): string[] {
  const output: string[] = []
  let redactNext = false
  for (const arg of args) {
    if (redactNext) {
      output.push('••••••')
      redactNext = false
      continue
    }
    const equals = /^(--?[^=]+)=(.+)$/u.exec(arg)
    if (equals !== null) {
      const [, flag, value] = equals
      if (flag !== undefined && value !== undefined && looksSecret(flag)) {
        output.push(`${flag}=••••••`)
        continue
      }
    }
    if (/^--?[^=]+$/u.test(arg) && looksSecret(arg)) {
      output.push(arg)
      redactNext = true
      continue
    }
    output.push(arg)
  }
  return output
}

/** 去掉 JSON 文件里的注释和尾逗号，兼容 JSONC。 */
export function parseJsonc(text: string): unknown {
  let output = ''
  let index = 0
  let inString = false
  let escaped = false
  while (index < text.length) {
    const char = text[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      index++
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      index++
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      index += 2
      continue
    }
    output += char
    index++
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/gu, '$1'))
}

/** 判断值是否是普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从 `unknown` 里读取字符串。 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 从 `unknown` 里读取字符串数组。 */
export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

/** 从 `unknown` 里读取键值均为字符串的对象。 */
export function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const output: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') output[key] = item
    else if (typeof item === 'number' || typeof item === 'boolean') output[key] = String(item)
  }
  return output
}

/** 读取未知对象的字符串字段。 */
export function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

/** 等待。 */
export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

/** 同目录临时文件 + rename 的原子写入。 */
export async function writeFileAtomic(path: string, text: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${randomNomad()}.tmp`)
  await writeFile(temporary, text, { mode })
  try {
    await rename(temporary, path)
  } catch (error) {
    try {
      await unlink(path)
      await rename(temporary, path)
    } catch {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}

function randomNomad(): string {
  return `${String(process.pid)}-${randomBytes(8).toString('hex')}`
}

/** 判断路径是否绝对路径；供配置校验使用。 */
export function isAbsolutePath(path: string): boolean {
  return isAbsolute(path)
}
