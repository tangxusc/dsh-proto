# src

业务插件源码。入口 `index.ts` 声明配置，注册工具与提示词；可选消费 `extKvStore`，拿不到则回退文件 sidecar。

方案数据**不经过本插件** —— 它由 `mcp/` 那个独立进程以资源形式提供。

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 插件入口：Config、注册工具与提示词 |
| `chapters.ts` | 章节目录与公文顺序（cover → 01–11） |
| `prompt.ts` | 系统提示：读 MCP 资源 → 按需切片 → 带 planId 逐章写 |
| `session-state.ts` | 按 session 隔离的写章进度 |
| `static-docs.ts` | 静态资料与章节模版的目录、分页与路径沙箱 |

| 目录 | 职责 |
| --- | --- |
| `mcp/` | **独立进程的 MCP server**：fixture、投影、资源、工具、入口 |
| `tools/` | 两个 model-facing 工具（`read_static_doc` / `write_chapter`） |
| `base_plugin/` | 与业务解耦的基础扩展（Redis KV、内网鉴权、工具白名单过滤） |

改源码后需 `npm run build`，运行时加载 `lib/`。
