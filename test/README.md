# test

单测与端到端测试，不参与插件发布。

| 文件 | 职责 |
| --- | --- |
| `*.test.ts` | 工具、提示词、预设、MCP 资源与投影、KV、鉴权等测试 |
| `mcp-e2e.test.ts` | **独立进程**起 MCP server，用官方客户端走 Streamable HTTP 跑全链路（离线） |
| `fake-redis.ts` | 单测用假 Redis，不连真实实例 |

```sh
npm test              # 类型检查 + 全部单测 + MCP e2e（离线）
npm run e2e:mcp       # 只跑 MCP e2e
npm run mcp:serve     # 手工起 MCP server（需先 npm run build）
```

`mcp-e2e.test.ts` 自带起停 MCP server 进程，不访问任何外部接口。
