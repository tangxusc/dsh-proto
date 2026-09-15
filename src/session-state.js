/**
 * 按 session 隔离并落盘写章进度。真相在 {stateDir}/{sessionId}.json。
 *
 * 隔离键是 exec.agent.id（与 harness SessionId 相同）。没有 agent 时拒绝写入，
 * 避免退回进程级共享 state。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * @typedef {object} PlanSessionState
 * @property {string} planId
 * @property {object | null} basic
 * @property {string[]} points
 * @property {Record<string, string>} chapters
 * @property {string} planFile
 */

/**
 * 解析进度落盘目录。空值用进程 cwd 下的 dsh-plan-state。
 * @param configured - config.stateDir。
 * @returns 绝对路径。
 */
export function resolveStateDir(configured) {
  const raw = typeof configured === 'string' ? configured.trim() : ''
  return resolve(raw || 'dsh-plan-state')
}

/** 空进度，表示尚未取数。 */
export function emptyState() {
  return { planId: '', basic: null, points: [], chapters: {}, planFile: '' }
}

/**
 * 从工具执行上下文取出 session id。
 * @param exec - ToolRunContext（至少含 agent.id）。
 * @returns 非空 session id。
 * @throws 没有 agent.id 时。
 */
export function sessionIdOf(exec) {
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
export function stateFileName(sessionId) {
  return `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_') || 'session'}.json`
}

function statePath(stateDir, sessionId) {
  return join(stateDir, stateFileName(sessionId))
}

function normalize(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return emptyState()
  }
  const chapters = raw.chapters
  return {
    planId: typeof raw.planId === 'string' ? raw.planId : '',
    basic: typeof raw.basic === 'object' && raw.basic !== null && !Array.isArray(raw.basic) ? raw.basic : null,
    points: Array.isArray(raw.points) ? raw.points.map((p) => String(p)) : [],
    chapters: typeof chapters === 'object' && chapters !== null && !Array.isArray(chapters)
      ? Object.fromEntries(Object.entries(chapters).map(([k, v]) => [k, String(v)]))
      : {},
    planFile: typeof raw.planFile === 'string' ? raw.planFile : '',
  }
}

/**
 * 读取某 session 的进度；文件不存在则返回空进度。
 * @param stateDir - 进度目录。
 * @param sessionId - 会话 id。
 * @returns 进度对象（新对象，可原地改）。
 */
export function loadState(stateDir, sessionId) {
  const path = statePath(stateDir, sessionId)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
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
export function saveState(stateDir, sessionId, state) {
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
 * @returns {{ sessionId: string, state: PlanSessionState }}
 */
export function loadSessionState(stateDir, exec) {
  const sessionId = sessionIdOf(exec)
  return { sessionId, state: loadState(stateDir, sessionId) }
}
