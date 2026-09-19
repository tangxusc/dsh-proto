/**
 * 基础扩展：ExtKvStore 能力的 Redis Provider 插件。
 *
 * 与业务插件（test-plan-tool）解耦，作为独立的 cordis 行加载（`src/base_plugin/` 属于
 * 基础扩展，业务扩展在 `src/` 根）。职责：
 *
 * 1. 按部署配置 + 环境变量解析 redis 连接（host/port/password/db），构造 `ExtKvStore` 的
 *    Redis Provider——`RedisKvStore`（基于开源 ioredis，见
 *    `redis_kv_store_client.ts`）；
 * 2. 用 `ctx.provide(EXT_KV_SERVICE, kv)` 把**通用 KV** 作为服务提供给其它插件——它不感知
 *    任何业务语义，键值都是字符串。业务层（如写章进度的 `sessionStore`）在其上再做前缀、序列化；
 * 3. 按运行形态注入读取接口：web（存在 `webServer`）→ 按 key 取原始值 API（`Content-Type:
 *    text/event-stream` 时走 SSE 订阅）；tui（存在 `commands`）→ `/get-redis-kv-store` 指令。
 *
 * redis 连接的关闭挂到插件自身 dispose，行被 stop/update 即清理。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { EXT_KV_SERVICE, type ExtKvStore } from './ext_kv_store.ts'
import { RedisKvStore, parseRedisUrl, type RedisUrl } from './redis_kv_store_client.ts'

/** 插件名（cordis 行 id 对应）。 */
export const name = 'redis-kv-store'

/**
 * redis 存储插件的部署配置（连接相关），与业务配置分离，可被其它插件复用。
 *
 * 每一处都有「配置文件 → 环境变量」的覆盖关系：环境变量存在时优先于配置文件名。
 * 业务如何使用 redis（键前缀、过期时间）不在本行，而在业务插件的配置里。
 */
export interface Config {
  /** 是否启用并对外提供 extKvStore 服务；关闭时不提供。 */
  enabled?: boolean
  /** redis 地址（`redis://[user][:password]@host:port[/db]`）；可用环境变量 REDIS_URL 覆盖。 */
  url?: string
  /** redis 密码；可用 REDIS_PASSWORD 覆盖；未设时取 URL 里带的密码。 */
  password?: string
  /** redis 库号；可用 REDIS_DB 覆盖；未设时取 URL 里带的库号。 */
  db?: number
  /** 注入 webServer 的路由路径；默认 `/api/redis-kv-store`。 */
  webPath?: string
}

/** Schemastery 配置 schema；默认值直接写在 schema 中，未提供的字段由框架填充。 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(false),
  url: Schema.string().default('redis://127.0.0.1:6379'),
  password: Schema.string().default(''),
  db: Schema.number(),
  webPath: Schema.string().default('/api/redis-kv-store'),
})

/** 读取一个环境变量；空白视为未设置。 */
function env(name: string): string | undefined {
  const value = process.env[name]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function numEnv(name: string): number | undefined {
  const value = env(name)
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 汇总 redis 连接参数。优先级：环境变量 > 配置文件的显式字段 > URL 自带字段。
 */
function resolveConnection(config: Config): RedisUrl {
  const url = env('REDIS_URL') ?? (config.url || '')
  const parsed = parseRedisUrl(url)
  const password = env('REDIS_PASSWORD') ?? (config.password?.trim() || parsed.password)
  const db = numEnv('REDIS_DB') ?? (config.db !== undefined ? config.db : parsed.db)
  return {
    host: parsed.host,
    port: parsed.port,
    ...(password ? { password } : {}),
    ...(db !== undefined ? { db } : {}),
  }
}

/** webServer 路由的最小形状（结构兼容 dsh 的 WebRoute）。 */
interface WebRouteLike {
  kind: 'exact'
  path: string
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
}

interface WebServerLike {
  register(route: WebRouteLike): () => void
}

/** commands 指令的最小形状（结构兼容 dsh 的 CommandDefinition）。 */
interface CommandDefinitionLike {
  name: string
  description: string
  input?: { hint: string }
  handler(invocation: { agent?: { id?: string }; rawInput?: string }):
    | { kind: 'success'; text?: string }
    | { kind: 'error'; text: string }
    | Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }>
}

interface CommandsLike {
  register(definition: CommandDefinitionLike): () => void
}

/** 请求头 `Content-Type` 为标准 `text/event-stream` 时，表示调用方想要的是一次 SSE 订阅。 */
function isSubscribe(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType
  const lower = String(value ?? '').trim().toLowerCase()
  return lower === 'text/event-stream' || lower.startsWith('text/event-stream;')
}

/** 键的原始值（缺失为 null）序列化成 JSON，作为 GET / SSE 的载荷。 */
function valueBody(value: string | null): string {
  return value === null ? 'null' : value
}

/** 注册到 dsh-host-webserver 的按 key 取原始值的 API（通用 KV 读取）。 */
function registerWebApi(ctx: Context, webServer: WebServerLike, kv: ExtKvStore, path: string): void {
  // 记录所有进行中的 SSE 轮询定时器，插件卸载时统一清理。
  const timers = new Set<ReturnType<typeof setInterval>>()
  ctx.effect(() => () => {
    for (const timer of timers) clearInterval(timer)
    timers.clear()
  }, 'cleanup ext-kv-store SSE timers')

  const route: WebRouteLike = {
    kind: 'exact',
    path,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const key = url.searchParams.get('key') ?? ''
      if (!key) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('missing query param: key')
        return
      }
      try {
        if (isSubscribe(req.headers['content-type'] as string | string[] | undefined)) {
          // SSE 订阅：先发当前值，之后变化即推送。
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
          const value = await kv.get(key)
          const initial = valueBody(value)
          res.write(`retry: 2000\ndata: ${initial}\n\n`)
          let last = initial
          const timer = setInterval(() => {
            kv.get(key)
              .then((current) => {
                const body = valueBody(current)
                if (body !== last) {
                  last = body
                  res.write(`data: ${body}\n\n`)
                }
              })
              .catch(() => {
                /* 忽略瞬时读取错误，等待下一轮 */
              })
          }, 2000)
          timers.add(timer)
          req.on('close', () => {
            clearInterval(timer)
            timers.delete(timer)
          })
          return
        }
        // 普通 GET：返回 key 对应的原始值（缺失为 null）。
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        await kv.get(key).then((value) => res.end(valueBody(value)))
      } catch (error) {
        if (!res.writableEnded && !res.destroyed) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(error instanceof Error ? error.message : String(error))
        }
      }
    },
  }
  const dispose = webServer.register(route)
  ctx.effect(() => dispose, `register webServer route ${path}`)
}

/** 注册 tui 的 `/get-redis-kv-store` 指令：返回当前 session 为 key 的原始值。 */
function registerTuiCommand(ctx: Context, commands: CommandsLike, kv: ExtKvStore): void {
  const definition: CommandDefinitionLike = {
    name: 'get-redis-kv-store',
    description: '获取当前 session 在 redis 状态存储中的原始值（键为 session id）。',
    input: { hint: '打印当前会话的 redis 状态存储原始值' },
    async handler(invocation) {
      const sessionId = String(invocation?.agent?.id ?? '').trim()
      if (!sessionId) {
        return { kind: 'error', text: '缺少当前 session id' }
      }
      try {
        const value = await kv.get(sessionId)
        return { kind: 'success', text: `session=${sessionId}\n${valueBody(value)}` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }
  const dispose = commands.register(definition)
  ctx.effect(() => dispose, 'register /get-redis-kv-store command')
}

/**
 * ExtKvStore 的 Redis Provider 插件。作为独立 cordis 行加载，`apply` 仅在启用时提供
 * `extKvStore` 服务（通用 KV），并按运行形态注入 web API 或 tui 指令。
 */
export function apply(ctx: Context, config: Config): void {
  if (!(config.enabled ?? false)) {
    // 未启用：不提供 extKvStore 服务，业务插件回退文件 sidecar。
    return
  }

  const conn = resolveConnection(config)
  const webPath = config.webPath ?? '/api/redis-kv-store'

  const kv: ExtKvStore = new RedisKvStore(conn)

  // 提供给其它插件消费的通用 KV。ctx.provide 的移除随本插件 dispose 自动发生。
  ctx.provide(EXT_KV_SERVICE, kv)

  // commands 是同步可用的 tui 服务，直接注册（headless/tui 下的读取入口）。
  const commands = ctx.get('commands') as CommandsLike | undefined
  if (commands !== undefined) {
    registerTuiCommand(ctx, commands, kv)
  }

  // webServer 是可选依赖：用嵌套 ctx.inject 访问，仅当服务实际存在时才注册 HTTP API。
  // 这与 dsh-client-connection / api-gateway 的做法一致，且不会阻塞插件 apply。
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = (webCtx as Context & { webServer?: WebServerLike }).webServer
    if (webServer === undefined) return
    registerWebApi(webCtx, webServer, kv, webPath)
  })

  // redis 连接的生命周期跟随本插件：卸载时一并关闭。
  ctx.effect(() => () => kv.close().catch(() => {}), 'close ext-kv-store connection')
}
