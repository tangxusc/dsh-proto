# mcp

**独立进程的 MCP server**：与 dsh 各自启动，只监听 HTTP，dsh 按 URL 连过来。
两者之间唯一的耦合点就是那个 URL —— 本进程不写磁盘，也不知道 dsh 的任何目录。

```sh
node lib/mcp/server.js --port 8096     # 固定端口
MCP_HTTP_PORT=0 node lib/mcp/server.js # 随机端口，实际值打到 stdout
```

| 文件 | 职责 |
| --- | --- |
| `server.ts` | 独立进程入口：`McpServer` + 资源/工具注册 + `node:http` 桥接 Web 标准 transport |
| `fixture.ts` | 内置**固定**方案数据（从真实 55 响应裁剪并脱敏），只有本进程读它 |
| `project.ts` | **投影**纯函数：目录 / 功能点切片 / 试验信息切片 |
| `resources.ts` | 资源模板声明、URI 解析与读取 |
| `tools.ts` | 三个静态工具（供工具白名单演示） |

## 为什么投影

真实方案 JSON 约 84% 是写作无关的元数据（`id` / `fieldType` / `sortNo` / `suggestions`，
以及功能点级与字段级**重复出现**的 `sourceReferences`）。资源返回前先投影掉它们，
再按功能点切片：

| 资源 | 实测体量 |
| --- | --- |
| `plan://plans/{planId}` 目录 | ~1.5 KB |
| `.../points/{index}` 单切片 | ~1.4 KB |
| `.../raw` 原始兜底 | ~34 KB |

资源一律返回**紧凑 JSON**（缩进对上下文是纯浪费）。

## API 备注

`@modelcontextprotocol/server` 2.x 与 1.x 差别很大：

- 只有 Web 标准的 Streamable HTTP transport（`WebStandardStreamableHTTPServerTransport`，
  `handleRequest(req: Request)`），所以 `node:http` 要自己做一层桥接（本实现逐块转发，JSON 与 SSE 都能走）。
- 高层 `McpServer` + `registerResource` / `registerTool`；`inputSchema` 用
  **`fromJsonSchema(普通 JSON Schema)`**，不需要 zod。
- `new ResourceTemplate(uri, { list: undefined })` 里 `list` 必须显式给，哪怕值是 `undefined`。
