/**
 * 按 session 隔离并落盘写章进度。真相在 {stateDir}/{sessionId}.json。
 *
 * 隔离键是 exec.agent.id（与 harness SessionId 相同）。没有 agent 时拒绝写入，
 * 避免退回进程级共享 state。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 一个 session 的写章进度。 */
export interface PlanSessionState {
  planId: string
  basic: Record<string, unknown> | null
  points: string[]
  chapters: Record<string, string>
  planFile: string
}

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
export function emptyState(): PlanSessionState {
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

function normalize(raw: unknown): PlanSessionState {
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
export function loadState(stateDir: string, sessionId: string): PlanSessionState {
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
export function saveState(stateDir: string, sessionId: string, state: PlanSessionState): void {
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
  state: PlanSessionState
} {
  const sessionId = sessionIdOf(exec)
  return { sessionId, state: loadState(stateDir, sessionId) }
}
