# ext-kv-store

通用键值存储：定义层、Redis 实现、Provider 插件行。不感知试验方案语义。

| 文件 | 职责 |
| --- | --- |
| `ext_kv_store.ts` | `ExtKvStore` 契约与服务名 `extKvStore` |
| `redis_kv_store_client.ts` | 用 ioredis 实现该契约 |
| `redis_kv_store_provider.ts` | 独立插件行：连 Redis、提供服务、可选 web/tui 读取接口 |

未启用时不提供服务，业务侧回退 `stateDir` 文件 sidecar。连接参数可用 `REDIS_URL` / `REDIS_PASSWORD` / `REDIS_DB` 覆盖。

## web中订阅方法
```shell
# SSE 订阅某个 key 的状态（key = 存储键）
curl -N -H 'Content-Type: text/event-stream' \
  'http://127.0.0.1:3080/api/redis-kv-store?key=<xxx>'
```

## tui中获取某个key的状态
```shell
/get-redis-kv-store <key>
```