/**
 * Redis 通用 KV 客户端：用开源 `ioredis` 实现 `ExtKvStore`。
 *
 * 只暴露 GET / SET（EX）/ DEL / close。连接参数的解析、构造与对外提供 `extKvStore`
 * 服务（Provider 插件行）都在 `redis_kv_store_provider.ts`。
 *
 * 键值都是 UTF-8 JSON。带密码时由 ioredis 连接后 AUTH；带库号时再 SELECT。
 * 固定 RESP2：真实 Redis 普遍支持，且与单测假服务器协议一致；ioredis 6 默认 RESP3。
 */

import { Redis } from 'ioredis'
import type { ExtKvStore } from './ext_kv_store.ts'

/** 解析后的 Redis 连接地址。 */
export interface RedisUrl {
  host: string
  port: number
  /** 密码（连接后 AUTH）；无则省略。 */
  password?: string
  /** 库号（连接后 SELECT）；无则省略。 */
  db?: number
}

const DEFAULT_PORT = 6379
const FALLBACK_HOST = '127.0.0.1'

/**
 * 解析 `redis://[user][:password]@host:port[/db]` 形式的地址。
 * 缺省 scheme 用 `redis://`，缺省端口用 6379，缺省主机用 127.0.0.1。
 * 带 `@` 时 `:` 前为用户名（本客户端忽略），`:` 后为密码；`/db` 为库号。
 * @param url - 如 `redis://:secret@127.0.0.1:6379/2`。
 * @returns host、端口，以及可选的 password / db。
 */
export function parseRedisUrl(url: string): RedisUrl {
  let rest = (url || '').trim()
  if (rest.startsWith('redis://')) {
    rest = rest.slice('redis://'.length)
  }

  let db: number | undefined
  const slash = rest.indexOf('/')
  if (slash >= 0) {
    const dbPart = rest.slice(slash + 1).trim()
    if (dbPart) {
      const n = Number(dbPart)
      if (Number.isInteger(n) && n >= 0) db = n
    }
    rest = rest.slice(0, slash)
  }

  // 鉴权段 [user][:password]@；用户名在这一侧被忽略。
  let password: string | undefined
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    const auth = rest.slice(0, at)
    rest = rest.slice(at + 1)
    const colon = auth.indexOf(':')
    password = colon >= 0 ? auth.slice(colon + 1) : auth
  }

  let port = DEFAULT_PORT
  const colon = rest.lastIndexOf(':')
  if (colon >= 0) {
    const p = Number(rest.slice(colon + 1))
    if (Number.isInteger(p) && p > 0 && p < 65536) {
      port = p
      rest = rest.slice(0, colon)
    }
  }

  const host = rest || FALLBACK_HOST
  return { host, port, ...(password ? { password } : {}), ...(db !== undefined ? { db } : {}) }
}

/**
 * RedisKvStore：`ExtKvStore` 的 ioredis 实现。只负责连接与命令往返，不感知 cordis 服务；
 * 构造、`ctx.provide` 与对外暴露读取接口（Provider 插件行）在 `redis_kv_store_provider.ts`。
 * `connect` 是幂等公开方法，连接按需建立。
 *
 * ```
 * const kv = new RedisKvStore(parseRedisUrl('redis://:pass@127.0.0.1:6379'))
 * await kv.set('k', 'v', 60)
 * const v = await kv.get('k')     // 'v'
 * await kv.close()
 * ```
 */
export class RedisKvStore implements ExtKvStore {
  private readonly client: Redis
  private connecting: Promise<void> | null = null

  constructor(url: RedisUrl) {
    this.client = new Redis({
      host: url.host,
      port: url.port,
      ...(url.password !== undefined ? { password: url.password } : {}),
      ...(url.db !== undefined ? { db: url.db } : {}),
      // 按需连接，与原先「第一条命令才建连」一致。
      lazyConnect: true,
      // ioredis 6 默认 RESP3（HELLO）；假 redis 与多数部署只需要 RESP2。
      protocol: 2,
      // 跳过 INFO / CLIENT SETINFO，避免握手命令干扰单测与最小 KV 路径。
      enableReadyCheck: false,
      disableClientInfo: true,
      maxRetriesPerRequest: 1,
    })
    // 命令失败走 Promise reject；这里只防止 EventEmitter 无监听时把进程打挂。
    this.client.on('error', () => {})
  }

  /** 建立连接（幂等），必要时由 ioredis 附带 AUTH / SELECT。 */
  connect(): Promise<void> {
    const { status } = this.client
    if (status === 'ready' || status === 'connect') {
      return Promise.resolve()
    }
    if (status === 'connecting') {
      return new Promise((resolve, reject) => {
        this.client.once('ready', () => resolve())
        this.client.once('close', () => reject(new Error('redis 连接已关闭')))
      })
    }
    if (this.connecting) {
      return this.connecting
    }
    this.connecting = this.client.connect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  /** GET key。 */
  async get(key: string): Promise<string | null> {
    const value = await this.client.get(key)
    return value === null || value === undefined ? null : String(value)
  }

  /** SET key value [EX seconds]；指定 exSeconds 时写入后自动过期。 */
  async set(key: string, value: string, exSeconds?: number): Promise<void> {
    if (exSeconds !== undefined && exSeconds !== null && Number.isFinite(exSeconds)) {
      await this.client.set(key, value, 'EX', Math.max(1, Math.floor(exSeconds)))
    } else {
      await this.client.set(key, value)
    }
  }

  /** DEL key。 */
  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    this.connecting = null
    this.client.disconnect()
  }
}
