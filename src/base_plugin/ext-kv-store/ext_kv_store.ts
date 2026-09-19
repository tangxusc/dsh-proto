/**
 * Service Definition：通用键值存储（ExtKvStore）能力。
 *
 * 对应官方「Service Definition / Service Provider / Consumer」三层拆分的**定义层**
 * （类比 `dsh-shell`）：只声明服务名与能力契约（请求/结果的形状），不含任何实现，
 * 不感知 redis、文件或试验方案。Provider（如 `RedisKvStore`，见
 * `redis_kv_store_client.ts`）和
 * Consumer（如 `session-state.ts#sessionStore`、业务工具）都只依赖本模块。
 *
 * 服务名 `extKvStore` 是任何插件 `ctx.get('extKvStore')` 取到的键；取不到时说明当前
 * 部署没有启用任何 KV Provider，Consumer 自行回退。
 */

/** 对外提供的 KV 服务名（Provider 用 `ctx.provide` 注册，Consumer 用 `ctx.get` 获取）。 */
export const EXT_KV_SERVICE = 'extKvStore'

/**
 * 通用键值存储契约：不感知业务语义，键值都是字符串。
 * 业务层（如 `session-state.ts` 的 `sessionStore`）在它之上再做键前缀、序列化等映射。
 */
export interface ExtKvStore {
  /** 读取一个键；缺失返回 null。 */
  get(key: string): Promise<string | null>
  /** 写入一个键；指定 `ttlSeconds` 时自动过期。 */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  /** 删除一个键。 */
  del(key: string): Promise<void>
  /** 关闭底层连接。 */
  close(): Promise<void>
}
