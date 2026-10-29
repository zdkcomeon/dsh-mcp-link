/**
 * 对一条 MCP 配置做一次独立的连接握手。
 *
 * 测试会新开一个 stdio 子进程或 HTTP 会话，不复用 DSH 里已经建立的长连接；
 * 因此它回答的是这份配置当前能不能连上服务，而不是 DSH 当前会话是否还活着。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { McpTransport, TestFailureCode } from '../protocol.js'

/** 与 DSH mcp-client 一致的客户端标识和协议版本。 */
const CLIENT_INFO = Object.freeze({ name: 'dsh-mcp-link', version: '0.1.1' })
const PROTOCOL_VERSION = '2026-07-28'
/** 单次测试的默认总超时。 */
const DEFAULT_TIMEOUT_MS = 20_000
/** 关闭子进程或 HTTP 会话时最多等待的时间。 */
const CLOSE_TIMEOUT_MS = 1_000
/** 保留的 stderr 上限，避免异常服务刷屏。 */
const STDERR_LIMIT = 4_000
/** 返回给浏览器的诊断详情上限。 */
const DETAIL_LIMIT = 600
/** 返回的工具名数量上限。 */
const TOOL_NAME_LIMIT = 50

/** 需要探测的连接参数；值已经由 Host 求值。 */
export interface ProbeTarget {
  readonly name: string
  readonly transport: McpTransport
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
}

/** 探测失败信息。 */
export interface ProbeFailure {
  readonly code: TestFailureCode
  readonly message: string
  readonly detail?: string
}

/** 一次探测的结果。 */
export interface ProbeOutcome {
  readonly connected: boolean
  readonly durationMs: number
  readonly protocolVersion?: string
  readonly serverName?: string
  readonly serverVersion?: string
  readonly toolCount?: number
  readonly toolNames?: readonly string[]
  readonly warning?: string
  readonly error?: ProbeFailure
}

interface HandshakeResult {
  readonly protocolVersion?: string
  readonly serverName?: string
  readonly serverVersion?: string
  readonly toolCount?: number
  readonly toolNames?: readonly string[]
  readonly warning?: string
}

interface ProbeSession {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>
  notify(method: string, params: unknown, timeoutMs: number): Promise<void>
  setProtocolVersion(version: string): void
  close(): Promise<void>
}

/** 探测过程中的可分类错误。 */
class ProbeError extends Error {
  readonly code: TestFailureCode
  readonly detail: string | undefined
  readonly rpcCode: number | undefined

  constructor(code: TestFailureCode, message: string, detail?: string, rpcCode?: number) {
    super(message)
    this.name = 'ProbeError'
    this.code = code
    this.detail = detail
    this.rpcCode = rpcCode
  }
}

/**
 * 测试一条 MCP 配置。
 * @param target - 已求值的连接参数。
 * @param timeoutMs - 总超时，默认 20 秒。
 * @returns 连接结果；连接失败通过 `connected: false` 和 `error` 表达。
 */
export async function probeMcp(target: ProbeTarget, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeOutcome> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  if (target.transport === 'stdio') {
    if (target.command === undefined || target.command.trim() === '') {
      return failureOutcome(startedAt, 'missing-command', 'stdio target has no command')
    }
    return probeStdio(target, startedAt, deadline)
  }
  if (target.transport === 'streamable-http') {
    if (target.url === undefined || target.url.trim() === '') {
      return failureOutcome(startedAt, 'missing-url', 'streamable-http target has no url')
    }
    return probeHttp(target, startedAt, deadline)
  }
  return failureOutcome(startedAt, 'unsupported', `transport ${target.transport} cannot be probed`)
}

async function probeStdio(target: ProbeTarget, startedAt: number, deadline: number): Promise<ProbeOutcome> {
  let session: StdioSession
  try {
    session = new StdioSession(target)
  } catch (error) {
    return failureFrom(error, startedAt, undefined)
  }
  try {
    const result = await handshake(session, deadline)
    return { connected: true, durationMs: Date.now() - startedAt, ...result }
  } catch (error) {
    return failureFrom(error, startedAt, session.stderrTail())
  } finally {
    await session.close()
  }
}

async function probeHttp(target: ProbeTarget, startedAt: number, deadline: number): Promise<ProbeOutcome> {
  const session = new HttpSession(target)
  try {
    const result = await handshake(session, deadline)
    return { connected: true, durationMs: Date.now() - startedAt, ...result }
  } catch (error) {
    return failureFrom(error, startedAt, undefined)
  } finally {
    await session.close()
  }
}

async function handshake(session: ProbeSession, deadline: number): Promise<HandshakeResult> {
  const initialized = await session.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  }, remaining(deadline))
  const result = asRecord(initialized)
  if (result === undefined) throw new ProbeError('protocol', 'initialize result is not an object')
  const protocolVersion = asString(result.protocolVersion)
  if (protocolVersion !== undefined) session.setProtocolVersion(protocolVersion)
  const serverInfo = asRecord(result.serverInfo)
  const capabilities = asRecord(result.capabilities)
  await session.notify('notifications/initialized', undefined, Math.min(remaining(deadline), 3_000))
    .catch(() => undefined)

  const output: {
    protocolVersion?: string
    serverName?: string
    serverVersion?: string
    toolCount?: number
    toolNames?: readonly string[]
    warning?: string
  } = {}
  if (protocolVersion !== undefined) output.protocolVersion = protocolVersion
  const serverName = serverInfo === undefined ? undefined : asString(serverInfo.name)
  const serverVersion = serverInfo === undefined ? undefined : asString(serverInfo.version)
  if (serverName !== undefined) output.serverName = serverName
  if (serverVersion !== undefined) output.serverVersion = serverVersion

  if (capabilities !== undefined && asRecord(capabilities.tools) !== undefined) {
    try {
      const listed = await listToolNames(session, deadline)
      output.toolCount = listed.count
      if (listed.names.length > 0) output.toolNames = listed.names
    } catch (error) {
      // 没有 tools/list 方法的服务仍算连接成功；其它错误作为非致命提示返回。
      if (!(error instanceof ProbeError && error.code === 'rpc-error' && error.rpcCode === -32601)) {
        output.warning = `tools/list failed: ${shorten(messageOf(error))}`
      }
    }
  }
  return output
}

/** 读取工具列表，最多翻 10 页；名称只保留前 50 个。 */
async function listToolNames(
  session: ProbeSession,
  deadline: number,
): Promise<{ count: number; names: string[] }> {
  const names: string[] = []
  let count = 0
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const params = cursor === undefined ? {} : { cursor }
    const listed = asRecord(await session.request('tools/list', params, remaining(deadline)))
    const tools = listed === undefined ? undefined : listed.tools
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        const record = asRecord(tool)
        const name = record === undefined ? undefined : asString(record.name)
        if (name === undefined) continue
        count++
        if (names.length < TOOL_NAME_LIMIT) names.push(name)
      }
    }
    const next = listed === undefined ? undefined : listed.nextCursor
    if (typeof next !== 'string' || next === '') break
    cursor = next
  }
  return { count, names }
}

/** stdio 传输：新起一个子进程，按行读写 JSON-RPC。 */
class StdioSession implements ProbeSession {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, PendingRequest>()
  private readonly exited: Promise<void>
  private buffer = ''
  private stderr = ''
  private closed = false
  private nextId = 1

  constructor(target: ProbeTarget) {
    const command = target.command ?? ''
    const args = target.args === undefined ? [] : [...target.args]
    this.child = spawn(command, args, {
      ...(target.cwd === undefined || target.cwd === '' ? {} : { cwd: target.cwd }),
      env: childEnvironment(target.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Windows 上的 npx 等命令是 .cmd 包装脚本，需要经由 shell 启动。
      shell: process.platform === 'win32',
    }) as ChildProcessWithoutNullStreams
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => { this.consume(chunk) })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => { this.stderr = appendLimited(this.stderr, chunk, STDERR_LIMIT) })
    this.child.stdin.on('error', () => undefined)
    this.child.on('error', (error: Error) => {
      this.failPending(new ProbeError('spawn-failed', `failed to start ${command}: ${error.message}`, errorDetail(error)))
    })
    this.child.on('exit', (code, signal) => {
      if (this.closed) return
      this.failPending(new ProbeError(
        'exited',
        `process exited before the handshake finished (code=${String(code)}, signal=${String(signal)})`,
        `code=${String(code)}, signal=${String(signal)}`,
      ))
    })
    this.exited = new Promise(resolve => { this.child.once('close', () => { resolve() }) })
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new ProbeError('closed', 'stdio session is closed'))
    const id = this.nextId++
    const message = params === undefined
      ? { jsonrpc: '2.0', id, method }
      : { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ProbeError('timeout', `no response to ${method} in time`))
      }, Math.max(1, timeoutMs))
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.child.stdin.write(`${JSON.stringify(message)}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new ProbeError('closed', `failed to write to the MCP process: ${messageOf(error)}`))
      }
    })
  }

  async notify(method: string, params: unknown, _timeoutMs: number): Promise<void> {
    if (this.closed) throw new ProbeError('closed', 'stdio session is closed')
    const message = params === undefined
      ? { jsonrpc: '2.0', method }
      : { jsonrpc: '2.0', method, params }
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  setProtocolVersion(_version: string): void {
    // stdio 不需要额外请求头。
  }

  stderrTail(): string | undefined {
    return tail(this.stderr, DETAIL_LIMIT)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.failPending(new ProbeError('closed', 'stdio session closed'))
    try {
      this.child.stdin.end()
    } catch {
      // 子进程可能已经退出，关闭 stdin 失败不影响后续清理。
    }
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM')
    const graceful = await Promise.race([
      this.exited.then(() => true),
      delay(CLOSE_TIMEOUT_MS).then(() => false),
    ])
    if (!graceful) {
      this.child.kill('SIGKILL')
      await Promise.race([this.exited, delay(CLOSE_TIMEOUT_MS)])
    }
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line !== '') this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > 1_000_000) this.buffer = this.buffer.slice(-10_000)
  }

  private handleLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const record = asRecord(message)
    if (record === undefined || typeof record.id !== 'number') return
    const pending = this.pending.get(record.id)
    if (pending === undefined) return
    this.pending.delete(record.id)
    clearTimeout(pending.timer)
    if (record.error !== undefined) {
      pending.reject(rpcErrorOf(record.error))
      return
    }
    pending.resolve(record.result)
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** Streamable HTTP 传输：POST JSON-RPC，支持 JSON 或 SSE 响应。 */
class HttpSession implements ProbeSession {
  private readonly url: string
  private readonly headers: Record<string, string>
  private sessionId: string | undefined
  private protocolVersion: string | undefined
  private nextId = 1

  constructor(target: ProbeTarget) {
    this.url = target.url ?? ''
    this.headers = { ...(target.headers ?? {}) }
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++
    const body = params === undefined
      ? { jsonrpc: '2.0', id, method }
      : { jsonrpc: '2.0', id, method, params }
    const message = await this.post(body, timeoutMs, id)
    if (message.error !== undefined) throw rpcErrorOf(message.error)
    if (message.id !== id) throw new ProbeError('protocol', `response id does not match ${method}`)
    return message.result
  }

  async notify(method: string, params: unknown, timeoutMs: number): Promise<void> {
    const body = params === undefined
      ? { jsonrpc: '2.0', method }
      : { jsonrpc: '2.0', method, params }
    await this.post(body, timeoutMs, undefined)
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version
  }

  async close(): Promise<void> {
    const sessionId = this.sessionId
    if (sessionId === undefined) return
    this.sessionId = undefined
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, CLOSE_TIMEOUT_MS)
    timer.unref()
    try {
      const response = await fetch(this.url, {
        method: 'DELETE',
        headers: this.requestHeaders(sessionId),
        signal: controller.signal,
      }).catch(() => undefined)
      await response?.body?.cancel().catch(() => undefined)
    } finally {
      clearTimeout(timer)
    }
  }

  private async post(body: unknown, timeoutMs: number, expectId: number | undefined): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(1, timeoutMs))
    timer.unref()
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'follow',
      })
      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId !== null && sessionId !== '') this.sessionId = sessionId
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new ProbeError(
          'http-status',
          `HTTP ${String(response.status)} ${response.statusText}`.trim(),
          text === '' ? undefined : shorten(text),
        )
      }
      if (expectId === undefined) {
        await response.body?.cancel().catch(() => undefined)
        return {}
      }
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
      if (contentType.includes('text/event-stream')) {
        return await readSseResponse(response, expectId)
      }
      const text = await response.text()
      if (text.trim() === '') throw new ProbeError('protocol', 'HTTP response body is empty')
      const parsed = parseJson(text)
      const message = findResponse(parsed, expectId)
      if (message === undefined) throw new ProbeError('protocol', 'HTTP response has no matching JSON-RPC message', shorten(text))
      return message
    } catch (error) {
      if (timedOut) throw new ProbeError('timeout', `MCP request timed out after ${String(timeoutMs)}ms`)
      if (error instanceof ProbeError) throw error
      throw new ProbeError('network', messageOf(error), errorDetail(error))
    } finally {
      clearTimeout(timer)
    }
  }

  private requestHeaders(sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.headers,
    }
    const session = sessionId ?? this.sessionId
    if (session !== undefined) headers['mcp-session-id'] = session
    if (this.protocolVersion !== undefined) headers['mcp-protocol-version'] = this.protocolVersion
    return headers
  }
}

async function readSseResponse(response: Response, id: number): Promise<Record<string, unknown>> {
  const body = response.body
  if (body === null) throw new ProbeError('protocol', 'SSE response has no body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = nextEventBoundary(buffer)
      while (boundary !== undefined) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const message = parseSseBlock(block)
        if (message !== undefined && message.id === id) return message
        boundary = nextEventBoundary(buffer)
      }
    }
    const message = parseSseBlock(buffer)
    if (message !== undefined && message.id === id) return message
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  throw new ProbeError('protocol', 'SSE stream ended without a matching JSON-RPC message')
}

/** 子进程环境：与 DSH 一样清掉敏感的环境变量，再合并配置里的值。 */
function childEnvironment(extra: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/KEY|PASSWORD|SECRET|TOKEN/iu.test(key)) continue
    if (key.startsWith('DSH_')) continue
    env[key] = value
  }
  if (extra !== undefined) Object.assign(env, extra)
  return env
}

function remaining(deadline: number): number {
  const left = deadline - Date.now()
  if (left <= 0) throw new ProbeError('timeout', 'MCP handshake timed out')
  return left
}

function failureOutcome(startedAt: number, code: TestFailureCode, message: string, detail?: string): ProbeOutcome {
  return {
    connected: false,
    durationMs: Date.now() - startedAt,
    error: { code, message, ...(detail === undefined ? {} : { detail }) },
  }
}

function failureFrom(error: unknown, startedAt: number, stderr: string | undefined): ProbeOutcome {
  if (error instanceof ProbeError) {
    const detail = joinDetail(error.detail, stderr)
    return failureOutcome(startedAt, error.code, error.message, detail)
  }
  return failureOutcome(startedAt, 'protocol', messageOf(error), stderr)
}

function joinDetail(detail: string | undefined, stderr: string | undefined): string | undefined {
  const parts: string[] = []
  if (detail !== undefined && detail !== '') parts.push(detail)
  if (stderr !== undefined && stderr !== '') parts.push(stderr)
  return parts.length === 0 ? undefined : parts.join('\n')
}

function rpcErrorOf(value: unknown): ProbeError {
  const record = asRecord(value)
  const code = record === undefined || typeof record.code !== 'number' ? undefined : record.code
  const message = record === undefined || typeof record.message !== 'string' ? 'MCP server returned a JSON-RPC error' : record.message
  const detail = code === undefined ? message : `code ${String(code)}: ${message}`
  return new ProbeError('rpc-error', message, detail, code)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new ProbeError('protocol', 'HTTP response is not JSON', shorten(text))
  }
}

function findResponse(value: unknown, id: number): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item)
      if (record !== undefined && record.id === id) return record
    }
    return undefined
  }
  const record = asRecord(value)
  return record === undefined || record.id !== id ? undefined : record
}

function nextEventBoundary(buffer: string): { index: number; length: number } | undefined {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return undefined
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

function parseSseBlock(block: string): Record<string, unknown> | undefined {
  const data: string[] = []
  for (const line of block.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue
    data.push(line.slice(5).replace(/^ /u, ''))
  }
  if (data.length === 0) return undefined
  const text = data.join('\n')
  if (text === '') return undefined
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return undefined
  }
}

function appendLimited(current: string, chunk: string, limit: number): string {
  const next = current + chunk
  return next.length > limit ? next.slice(next.length - limit) : next
}

function tail(text: string, limit: number): string | undefined {
  const cleaned = text.replace(/\u001B\[[0-9;]*[A-Za-z]/gu, '').trim()
  if (cleaned === '') return undefined
  return cleaned.length > limit ? cleaned.slice(cleaned.length - limit) : cleaned
}

function shorten(text: string, limit = DETAIL_LIMIT): string {
  const cleaned = text.replace(/\u001B\[[0-9;]*[A-Za-z]/gu, '').trim()
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned
}

function errorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error) return `${error.message}: ${cause.message}`
  if (cause === undefined) return undefined
  return `${error.message}: ${String(cause)}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, milliseconds) })
}
