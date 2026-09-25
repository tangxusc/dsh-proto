/**
 * 基础扩展：按 server 过滤 MCP 工具的**白名单**插件。
 *
 * 官方 `@deepseek-ai/dsh-mcp-client` 的 Config 里**没有工具白名单字段** —— 一台 server
 * 声明的工具会全部注册成 `mcp__<serverName>__<rawName>`。所以「server 上有三个工具、
 * 只启用其中一部分」必须由 dsh 侧另做：用 `ctx.tools.restrict({ deny })` 把多余的挡掉。
 *
 * 两个关键点：
 *
 * 1. **只能用 deny 表达白名单。** `restrict()` 对 unknown names 会抛错，而直接写
 *    `allow: [白名单]` 会引用尚未发现的工具名。做法是先用 `ctx.tools.schemas()` 拿到
 *    **实际发现**的 `mcp__<server>__*`，再算出「不在白名单里的」用 deny 挡掉 ——
 *    集合里全是已存在的名字，永不触发未知工具错误，也不会误伤别的工具。
 * 2. **必须挂在 agent 预设作用域。** restriction 只约束「本 scope 继承来的」工具，
 *    host 层调用不会影响 agent；挂错层时本插件只记一条 warn，不拖垮 agent。
 *
 * 副作用范围刻意最小：deny 集合只含被配置 server 的多余工具，因此
 * `read_static_doc` / `write_chapter` 以及 `dsh-mcp-resources` 提供的资源工具
 * （`read_mcp_resource` 等，注册在调用方自身作用域、本就不受 allow/deny 过滤）都不受影响。
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/** 插件名（cordis 行 id 对应）。 */
export const name = 'tool-filter'

/**
 * 硬依赖工具注册表。
 *
 * cordis 的 `ctx.get` 是严格模式：**不声明 inject 就访问 `ctx.tools` 会直接抛错**
 * （`cannot get property "tools" without inject`）。所以这一行不能省 ——
 * 少了它插件在 agent 预设里会以 `agent-preset/invalid` 拒绝挂载。
 */
export const inject = ['tools']

/** 一台 MCP server 的工具白名单。 */
export interface ServerToolFilter {
  /** MCP serverName（与 `dsh-mcp-client` 行一致）。 */
  server: string
  /**
   * 该 server 允许使用的**原始工具名**（不含 `mcp__<server>__` 前缀）。
   * 非空时只保留这些，其余该 server 的工具全部 deny；省略或空数组时不限制。
   */
  allow?: string[]
}

/** 插件配置。 */
export interface Config {
  servers?: ServerToolFilter[]
}

/** Schemastery 配置 schema。 */
export const Config = Schema.object({
  servers: Schema.array(Schema.object({
    server: Schema.string().required(),
    allow: Schema.array(Schema.string()),
  })).default([]),
})

/** 工具注册表里本插件用到的最小接口。 */
export interface ToolsLike {
  schemas?(): readonly { name: string }[]
  restrict?(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
}

/** 一次过滤决策：要 deny 的名字，以及配了但没发现的工具名。 */
export interface DenyPlan {
  deny: string[]
  unknownAllow: string[]
}

/** 拼接 model-facing 工具名。 */
function qualified(server: string, raw: string): string {
  return `mcp__${server}__${raw}`
}

/**
 * 算出要 deny 的工具名。
 *
 * 只对**已发现**的名字产出 deny，因此结果永远可以安全传给 `restrict()`。
 * @param schemas - 当前可见的工具（`ctx.tools.schemas()`）。
 * @param servers - 白名单配置。
 * @returns deny 列表与未识别到的白名单项（供告警）。
 */
export function computeDeny(
  schemas: readonly { name: string }[],
  servers: readonly ServerToolFilter[],
): DenyPlan {
  const names = schemas.map((s) => s.name)
  const deny = new Set<string>()
  const unknownAllow: string[] = []

  for (const { server, allow } of servers) {
    const wanted = (allow ?? []).map((raw) => String(raw).trim()).filter(Boolean)
    if (wanted.length === 0) continue // 未配置白名单：该 server 不限制

    const discovered = names.filter((name) => name.startsWith(`mcp__${server}__`))
    const keep = new Set(wanted.map((raw) => qualified(server, raw)))

    for (const raw of wanted) {
      if (!discovered.includes(qualified(server, raw))) unknownAllow.push(`${server}:${raw}`)
    }
    for (const name of discovered) {
      if (!keep.has(name)) deny.add(name)
    }
  }

  return { deny: [...deny], unknownAllow }
}

/** 记一条 warn；拿不到 logger 时静默。 */
function warn(ctx: Context, message: string): void {
  const logger = (ctx as Context & { logger?: { warn?: (msg: string) => void } }).logger
  logger?.warn?.(`[tool-filter] ${message}`)
}

/**
 * 注册过滤：按配置把多余的 MCP 工具从本作用域挡掉。
 * @param ctx - 插件上下文（必须位于 agent 预设作用域）。
 * @param config - 白名单配置。
 */
export function apply(ctx: Context, config: Config): void {
  const tools = (ctx as Context & { tools?: ToolsLike }).tools
  if (!tools || typeof tools.restrict !== 'function') return

  const schemas = typeof tools.schemas === 'function' ? tools.schemas() : []
  const { deny, unknownAllow } = computeDeny(schemas, config.servers ?? [])

  if (unknownAllow.length > 0) {
    warn(ctx, `配置了 server 未提供的工具，已忽略: ${unknownAllow.join(', ')}`)
  }
  // 空 filter 会让 restrict 抛错，必须跳过。
  if (deny.length === 0) return

  try {
    ctx.effect(() => tools.restrict!({ deny }), 'tool-filter: restrict mcp tools')
  } catch (error) {
    warn(ctx, `restrict 失败（需挂在 agent 预设作用域）: ${String(error)}`)
  }
}
