# base_plugin

与试验方案业务解耦的基础扩展，各自作为独立 cordis 插件行加载。

| 目录 | 插件 id | 职责 |
| --- | --- | --- |
| `ext-kv-store/` | `redis-kv-store` | 通用 KV 契约 + Redis Provider |
| `internal-auth/` | `internal-auth` | 内部来源访问 `/api` 的 401 放行 |

业务插件只消费这些扩展提供的能力，不内联实现。
