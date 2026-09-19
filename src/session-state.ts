/**
 * 按 session 隔离并落盘的写章进度（业务专属存储层）。
 *
 * 真相在 {stateDir}/{sessionId}.json；启用 redis 时则在通用 KV（extKvStore 服务）之上
 * 用 `sessionStore` 做 plan 专属映射。两种后端都收敛到 `SessionStateStore` 接口，工具
 * 只依赖这一层，不关心底层落盘。
 *
 * 隔离键是 exec.agent.id（与 harness SessionId 相同）。没有 agent 时拒绝写入，
 * 避免退回进程级共享 state。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { ExtKvStore } from './base_plugin/ext-kv-store/ext_kv_store.ts'

/** 一个 session 的写章进度。 */
export interface SessionState {
  planId: string
  basic: Record<string, unknown> | null
  points: string[]
  chapters: Record<string, string>
  planFile: string
}

/** 写章进度存到 redis 时的键前缀与过期默认值。 */
export const DEFAULT_SESSION_KEY_PREFIX = 'dsh:plan-state:'
export const DEFAULT_SESSION_TTL_SECONDS = 3 * 24 * 60 * 60

/** 工具执行上下文里至少要有 agent.id。 */
export interface AgentIdHolder {
  agent?: { id?: string }
}

/**
 * 解析进度落盘目录。空值用进程 cwd 下的 dsh-plan-state。
 * @param configured - config.stateDir。
 * @returns 绝对路径。
 */
export function resolveStateDir(configured: string | undefined): string {
  const raw = typeof configured === 'string' ? configured.trim() : ''
  return resolve(raw || 'dsh-plan-state')
}

/** 空进度，表示尚未取数。 */
export function emptyState(): SessionState {
  return { planId: '', basic: null, points: [], chapters: {}, planFile: '' }
}

/**
 * 从工具执行上下文取出 session id。
 * @param exec - ToolRunContext（至少含 agent.id）。
 * @returns 非空 session id。
 * @throws 没有 agent.id 时。
 */
export function sessionIdOf(exec: AgentIdHolder | undefined): string {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('缺少会话（exec.agent.id），无法按 session 隔离进度')
  }
  return id.trim()
}

/**
 * session id 收成文件名。
 * @param sessionId - 会话 id。
 * @returns 仅含安全字符的 json 文件名。
 */
export function stateFileName(sessionId: string): string {
  return `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_') || 'session'}.json`
}

function statePath(stateDir: string, sessionId: string): string {
  return join(stateDir, stateFileName(sessionId))
}

function normalize(raw: unknown): SessionState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return emptyState()
  }
  const rec = raw as Record<string, unknown>
  const chapters = rec.chapters
  return {
    planId: typeof rec.planId === 'string' ? rec.planId : '',
    basic: typeof rec.basic === 'object' && rec.basic !== null && !Array.isArray(rec.basic)
      ? rec.basic as Record<string, unknown>
      : null,
    points: Array.isArray(rec.points) ? rec.points.map((p) => String(p)) : [],
    chapters: typeof chapters === 'object' && chapters !== null && !Array.isArray(chapters)
      ? Object.fromEntries(Object.entries(chapters as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {},
    planFile: typeof rec.planFile === 'string' ? rec.planFile : '',
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/**
 * 读取某 session 的进度；文件不存在则返回空进度。
 * @param stateDir - 进度目录。
 * @param sessionId - 会话 id。
 * @returns 进度对象（新对象，可原地改）。
 */
export function loadState(stateDir: string, sessionId: string): SessionState {
  const path = statePath(stateDir, sessionId)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) {
      return emptyState()
    }
    throw error
  }
  try {
    return normalize(JSON.parse(text))
  } catch (error) {
    throw new Error(`会话进度文件损坏: ${path}`, { cause: error })
  }
}

/**
 * 把进度原子写入 sidecar。
 * @param stateDir - 进度目录。
 * @param sessionId - 会话 id。
 * @param state - 进度。
 */
export function saveState(stateDir: string, sessionId: string, state: SessionState): void {
  mkdirSync(stateDir, { recursive: true })
  const path = statePath(stateDir, sessionId)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/**
 * 按 exec.agent.id 加载进度。
 * @param stateDir - 进度目录。
 * @param exec - 工具执行上下文。
 */
export function loadSessionState(stateDir: string, exec: AgentIdHolder): {
  sessionId: string
  state: SessionState
} {
  const sessionId = sessionIdOf(exec)
  return { sessionId, state: loadState(stateDir, sessionId) }
}

/** 对外开放的规范化入口（redis 存储复用同一套字段容错）。 */
export function normalizeState(raw: unknown): SessionState {
  return normalize(raw)
}

/**
 * 按 session 隔离的写章进度存储接口。工具只依赖这一层，不关心底层是文件 sidecar
 * 还是 redis：`key = sessionId`，`value = SessionState 的 JSON 序列化`。
 */
export interface SessionStateStore {
  /** 读取一个 session 的进度；缺失时返回空进度。 */
  load(sessionId: string): Promise<SessionState>
  /** 保存一个 session 的进度（覆盖写）。 */
  save(sessionId: string, state: SessionState): Promise<void>
}

/**
 * 在通用 KV（`extKvStore` 服务）之上做 plan 专属映射：`key = prefix + sessionId`，
 * `value = SessionState 的 JSON 序列化`，写入时带 `ttlSeconds` 过期。缺失/损坏回退空进度。
 * @param kv - 某个 KV Provider 提供的通用 KV（如 `RedisKvStore`）。
 * @param options - 前缀与过期时间。
 * @returns 适配成 plan 专属的存储。
 */
export function sessionStore(kv: ExtKvStore, options: { prefix: string; ttlSeconds: number }): SessionStateStore {
  const { prefix, ttlSeconds } = options
  const key = (sessionId: string) => `${prefix}${sessionId}`
  return {
    async load(sessionId: string): Promise<SessionState> {
      const raw = await kv.get(key(sessionId))
      if (raw === null || raw === undefined || raw.length === 0) {
        return emptyState()
      }
      try {
        return normalize(JSON.parse(raw))
      } catch {
        // 单个键损坏不影响其它 session，回退空进度。
        return emptyState()
      }
    },
    async save(sessionId: string, state: SessionState): Promise<void> {
      await kv.set(key(sessionId), JSON.stringify(state), ttlSeconds)
    },
  }
}

/**
 * 基于本地文件 sidecar 的存储实现（redis 未启用时的回退）。
 * @param stateDir - 进度落盘目录。
 * @returns 存储实现。
 */
export function fileStore(stateDir: string): SessionStateStore {
  return {
    async load(sessionId: string): Promise<SessionState> {
      return loadState(stateDir, sessionId)
    },
    async save(sessionId: string, state: SessionState): Promise<void> {
      saveState(stateDir, sessionId, state)
    },
  }
}
