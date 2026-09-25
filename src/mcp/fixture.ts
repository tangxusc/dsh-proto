/**
 * 内置的**固定**方案数据（开发阶段不联网）。
 *
 * 内容取自真实 55 环境响应，已裁剪（3 个功能点 + 2 条试验信息）并脱敏，
 * 保留完整字段结构 —— 这样投影收益、切片体量都能按真实比例验证。
 *
 * 只有 MCP server 进程读它；资源 handler 本身是纯函数（见 `resources.ts`），
 * 接收方案数据作为入参，便于单测注入。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** fixture 相对包根的路径。 */
const FIXTURE_REL = ['resources', 'mcp-fixture', 'plan.json'] as const

/**
 * 随包 fixture 的绝对路径。
 * `src/mcp/` 与 `lib/mcp/` 都向上两级到包根。
 * @returns 绝对路径。
 */
export function fixturePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', ...FIXTURE_REL)
}

let cached: unknown

/**
 * 读取内置 fixture（进程内缓存）。
 * @returns 已解析的方案数据。
 * @throws fixture 缺失、非法 JSON 或结构不符时。
 */
export function planFixture(): unknown {
  if (cached === undefined) {
    const text = readFileSync(fixturePath(), 'utf8')
    const parsed: unknown = JSON.parse(text)
    assertFixtureShape(parsed)
    cached = parsed
  }
  return cached
}

/**
 * 轻量形状校验：结构不符时启动即失败，避免运行到一半才报错。
 * @param value - 已解析的 fixture。
 * @throws 缺少 basicInfo / functionInfo.functionPoints 时。
 */
function assertFixtureShape(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`MCP fixture 不是对象: ${fixturePath()}`)
  }
  const rec = value as Record<string, unknown>
  const info = rec.functionInfo
  if (typeof info !== 'object' || info === null) {
    throw new Error(`MCP fixture 缺少 functionInfo: ${fixturePath()}`)
  }
  if (!Array.isArray((info as Record<string, unknown>).functionPoints)) {
    throw new Error(`MCP fixture 缺少 functionInfo.functionPoints: ${fixturePath()}`)
  }
}
