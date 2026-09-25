/**
 * 基础扩展：按 server 过滤 MCP 工具的**白名单**插件。
 *
 * 官方 `@deepseek-ai/dsh-mcp-client` 的 Config 里**没有工具白名单字段** —— 一台 server
 * 声明的工具会全部注册成 `mcp__<serverName>__<rawName>`。所以「server 上有三个工具、
 * 只启用其中一部分」必须由 dsh 侧另做：用 `ctx.tools.restrict()` 把多余的挡掉。
 *
 * ## 四个必须绕开的坑（都在真实 profile 上踩过）
 *
 * **1. `restrict()` 装的是静态快照，而 MCP 是异步连接的。**
 * 若本插件先加载，`schemas()` 里还没有 `mcp__*` 工具；`reconnect` 重连后重新注册的工具
 * 也不在旧集合里。所以订阅 `tools/change`（dsh-tools 明确保证该事件**不做作用域过滤**，
 * 预设作用域里的监听者也能看到全局注册变化），每次变化都重算。
 *
 * **2. `schemas()` 返回的是「已应用限制之后」的视图 —— 不能拿它做自引用的重算。**
 * 若「重算 → 撤销旧限制 → 按新集合重装」，会形成震荡：
 *
 * ```
 * 挡住 echo → echo 从 schemas 消失 → 重算 deny=[] → 撤销限制 → echo 复现
 *    ↑                                                          ↓
 *    └──────────── restrict() 本身又会触发 tools/change ──────────┘
 * ```
 *
 * 实测会在一秒内滚出几十次 sync。所以这里改成**单调增量**：
 * 用 `handled` 记住处理过的名字，只对**本轮新出现**的多余工具追加 deny，
 * **永不撤销、永不重算**。`restrict` 之间是交集语义（文档：Restrictions intersect），
 * 增量安装天然等价于并集 deny，且天然收敛 —— 处理完就没有新名字，不再触发事件。
 *
 * **3. `restrict()` 只接受已存在的名字。**
 * 文档写明 "Empty filters, unknown names, scope-local names, and reserved transport names fail"。
 * 所以只能 deny **已发现**的名字（这也是不用 `allow` 的原因：白名单里的名字在 MCP 连上之前
 * 并不存在，`allow` 会直接抛错），且空 filter 必须跳过。
 *
 * **4. 必须挂在 agent 预设作用域 —— 放在 host 层会「静默无效」。**
 * `restrict()` 的语义是 "Restrict global tools for the **calling agent scope**"。
 * 实测把本插件当 host 行加载时，限制只作用于它自己所在的层：插件自己读 `schemas()`
 * 能看到工具确实被挡掉了，但 **agent 侧完全不受影响**（模型仍能调用被 deny 的工具）。
 * 所以配置必须写在 `presets/*.patch.yml` 的 `plugins` 里（见 `presets/test-plan.patch.yml`）。
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

/**
 * 跨轮状态。因为 `schemas()` 是「应用限制之后」的视图（已 deny 的名字会消失），
 * 必须自己记住处理过哪些名字，否则会把「被我挡掉」误判成「不存在」。
 */
export interface FilterState {
  /** 已经处理过的工具名（保留的与 deny 的都记）。 */
  handled: Set<string>
  /** 已经发现过工具的 server。 */
  discoveredServers: Set<string>
}

/** 建一份空状态。 */
export function createFilterState(): FilterState {
  return { handled: new Set(), discoveredServers: new Set() }
}

/** 一次过滤决策。 */
export interface DenyPlan {
  /** 本轮**新增**需要 deny 的名字（增量，可直接交给 `restrict()`）。 */
  deny: string[]
  /** 至今一个工具都没发现的 server —— 通常是 MCP 还没连上，不是配置错误。 */
  pending: string[]
  /** 已发现工具、但白名单里有对不上的名字 —— 大概率是名字写错了。 */
  unknownAllow: string[]
  /** 本轮没有任何新名字出现，说明工具集已经稳定（可据此决定是否报 unknownAllow）。 */
  settled: boolean
}

/** 拼接 model-facing 工具名。 */
function qualified(server: string, raw: string): string {
  return `mcp__${server}__${raw}`
}

/** 规范化白名单：去空白、去空项。 */
function normalizeAllow(allow: readonly string[] | undefined): string[] {
  return (allow ?? []).map((raw) => String(raw).trim()).filter(Boolean)
}

/**
 * 算出**本轮新增**要 deny 的工具名。
 *
 * 只对已发现、且尚未处理过的名字产出 deny，因此结果永远可以安全传给 `restrict()`。
 * 会就地更新 `state`（记下处理过的名字与已发现的 server）。
 * @param schemas - 当前可见的工具（`ctx.tools.schemas()`）。
 * @param servers - 白名单配置。
 * @param state - 跨轮状态。
 * @returns deny 增量、待连接列表、白名单未识别项与「本轮是否已稳定」。
 */
export function computeDeny(
  schemas: readonly { name: string }[],
  servers: readonly ServerToolFilter[],
  state: FilterState = createFilterState(),
): DenyPlan {
  const names = schemas.map((s) => s.name)
  const deny: string[] = []
  const pending: string[] = []
  const unknownAllow: string[] = []
  let discoveredAny = false

  for (const { server, allow } of servers) {
    const wanted = normalizeAllow(allow)
    if (wanted.length === 0) continue // 未配置白名单：该 server 不限制

    const prefix = `mcp__${server}__`
    const discovered = names.filter((name) => name.startsWith(prefix))

    if (discovered.length === 0) {
      // 从未发现过 → MCP 还没连上；发现过又全没了 → 属于异常，都不当作配置错误。
      if (!state.discoveredServers.has(server)) pending.push(server)
      continue
    }
    discoveredAny = true
    state.discoveredServers.add(server)

    const keep = new Set(wanted.map((raw) => qualified(server, raw)))
    for (const raw of wanted) {
      const full = qualified(server, raw)
      // 已经处理过的名字即使现在不可见（被挡掉了），也不算「写错」。
      if (!discovered.includes(full) && !state.handled.has(full)) {
        unknownAllow.push(`${server}:${raw}`)
      }
    }
    for (const full of discovered) {
      if (state.handled.has(full)) continue
      state.handled.add(full)
      if (!keep.has(full)) deny.push(full)
    }
  }

  return { deny, pending, unknownAllow, settled: discoveredAny && deny.length === 0 }
}

/** 记一条 warn：优先用 ctx.logger，拿不到就退回 stderr。 */
function warn(ctx: Context, message: string): void {
  const line = `[tool-filter] ${message}`
  const logger = (ctx as Context & { logger?: { warn?: (msg: string) => void } }).logger
  if (typeof logger?.warn === 'function') {
    logger.warn(line)
    return
  }
  // headless 等形态下 ctx.logger 可能不存在；不退回 stderr 的话告警会静默消失。
  process.stderr.write(`${line}\n`)
}

/** 本插件用到的 ctx 扩展（`on` 是 cordis 的事件订阅）。 */
type FilterContext = Context & {
  tools?: ToolsLike
  on?: (event: string, listener: () => void) => () => void
}

/**
 * 注册过滤：按配置把多余的 MCP 工具从本作用域挡掉，并在工具集变化时**增量**补齐。
 * @param ctx - 插件上下文（必须位于 agent 预设作用域）。
 * @param config - 白名单配置。
 */
export function apply(ctx: Context, config: Config): void {
  const scoped = ctx as FilterContext
  const tools = scoped.tools
  if (!tools || typeof tools.restrict !== 'function') return

  const servers = config.servers ?? []
  if (servers.length === 0) return

  const state = createFilterState()
  /** 已安装的增量限制的撤销函数；只在插件销毁时统一撤销。 */
  const installs: (() => void)[] = []
  /** 已告警过的白名单未识别项，避免每次变化都刷屏。 */
  const reported = new Set<string>()

  /** 按当前可见工具补齐限制。只增不减，避免与 restrict() 触发的事件形成震荡。 */
  const sync = (): void => {
    const schemas = typeof tools.schemas === 'function' ? tools.schemas() : []
    const { deny, pending, unknownAllow, settled } = computeDeny(schemas, servers, state)

    // 先装 deny：即使还有别的 server 没连上，已连上的那些也该立刻生效。
    if (deny.length > 0) {
      try {
        // restrict 之间是交集：增量安装即可，等价于并集 deny。
        installs.push(tools.restrict!({ deny }))
      } catch (error) {
        warn(ctx, `restrict 失败（需挂在 agent 预设作用域）: ${String(error)}`)
      }
      return
    }

    // 还有 server 没连上：属正常时序，不报「白名单名字对不上」。
    if (pending.length > 0) return

    // 本轮没有新名字 → 工具集已稳定，此时再报「白名单名字对不上」才可靠
    // （否则 MCP 分批注册的过程中会误报）。
    if (settled) {
      const fresh = unknownAllow.filter((item) => !reported.has(item))
      if (fresh.length > 0) {
        for (const item of fresh) reported.add(item)
        warn(ctx, `配置了 server 未提供的工具，已忽略: ${fresh.join(', ')}`)
      }
    }
  }

  try {
    ctx.effect(() => {
      sync()
      const off = typeof scoped.on === 'function' ? scoped.on('tools/change', sync) : undefined
      return () => {
        off?.()
        for (const dispose of installs) dispose()
        installs.length = 0
      }
    }, 'tool-filter: keep mcp tools filtered')
  } catch (error) {
    warn(ctx, `注册过滤失败: ${String(error)}`)
  }
}
