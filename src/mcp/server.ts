/**
 * 独立运行的 MCP server 进程。
 *
 * 与 dsh 是**两个独立进程**：本进程只监听 HTTP，dsh 按 URL 连过来，两者之间唯一的
 * 耦合点就是那个 URL。只提供 Streamable HTTP 一种传输。
 *
 * 方案数据以**资源**形式按需提供（见 `resources.ts`），进程本身不写磁盘。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import {
  McpServer,
  ResourceTemplate,
  WebStandardStreamableHTTPServerTransport,
  fromJsonSchema,
} from '@modelcontextprotocol/server'

import { planFixture } from './fixture.ts'
import {
  PLAN_LIST_RESOURCE,
  RESOURCE_TEMPLATES,
  listPlanResources,
  readPlanResource,
} from './resources.ts'
import { SERVER_NAME, SERVER_VERSION, TOOL_DEFINITIONS, callTool, toolError } from './tools.ts'

/** 默认监听端口。 */
export const DEFAULT_PORT = 8096

/** 默认监听地址（只绑本机）。 */
export const DEFAULT_HOST = '127.0.0.1'

/** 启动参数。 */
export interface ServerConfig {
  port: number
  host: string
}

/**
 * 解析启动参数：`--port` > 环境变量 `MCP_HTTP_PORT` > 默认 8096；`--host` > 默认 127.0.0.1。
 * @param argv - 进程参数（含 node 与脚本路径）。
 * @param env - 环境变量。
 * @returns 监听配置。
 * @throws 端口非法时。
 */
export function parseConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): ServerConfig {
  const args = argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
  const rawPort = flag('port') ?? env.MCP_HTTP_PORT ?? String(DEFAULT_PORT)
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口非法: ${rawPort}`)
  }
  return { port, host: flag('host') ?? DEFAULT_HOST }
}

/**
 * 组装 MCP server：一个固定资源 + 4 个资源模板 + 3 个工具。
 * @param plan - 方案数据（生产传 fixture，测试可注入）。
 * @returns 未连接的 McpServer。
 */
export function buildServer(plan: unknown): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  // 固定资源：方案清单。
  server.registerResource(
    PLAN_LIST_RESOURCE.name,
    PLAN_LIST_RESOURCE.uri,
    {
      title: PLAN_LIST_RESOURCE.title,
      description: PLAN_LIST_RESOURCE.description,
      mimeType: PLAN_LIST_RESOURCE.mimeType,
    },
    (uri: URL) => ({ contents: readPlanResource(plan, uri.href) }),
  )

  // 资源模板：目录 + 切片 + 兜底。
  for (const spec of RESOURCE_TEMPLATES) {
    server.registerResource(
      spec.name,
      new ResourceTemplate(spec.uriTemplate, { list: undefined }),
      { title: spec.title, description: spec.description, mimeType: spec.mimeType },
      (uri: URL) => ({ contents: readPlanResource(plan, uri.href) }),
    )
  }

  // 工具：静态/回显，用于验证「只启用部分工具」的过滤。
  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
      },
      async (args: unknown) => {
        try {
          return callTool(tool.name, args)
        } catch (error) {
          return toolError(error instanceof Error ? error.message : String(error))
        }
      },
    )
  }

  return server
}

/** node:http 请求体收成 Buffer。 */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

/** 把 node:http 请求转成 Web 标准 Request。 */
async function toWebRequest(req: IncomingMessage, host: string): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${host}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  const method = (req.method ?? 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
  return new Request(url, { method, headers, body, duplex: 'half' } as RequestInit)
}

/** 把 Web 标准 Response 写回 node:http 响应（逐块转发，SSE 与 JSON 都能走）。 */
async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const body = response.body
  if (!body) {
    res.end()
    return
  }
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) res.write(value)
  }
  res.end()
}

/** 已启动的 server 句柄。 */
export interface RunningServer {
  port: number
  host: string
  close(): Promise<void>
}

/**
 * 启动 HTTP 服务。
 * @param config - 监听配置。
 * @param plan - 方案数据。
 * @returns 实际端口与关闭函数（端口传 0 时由系统分配）。
 */
export async function startServer(config: ServerConfig, plan: unknown): Promise<RunningServer> {
  const server = buildServer(plan)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)

  const http = createServer((req, res) => {
    void (async () => {
      try {
        const request = await toWebRequest(req, `${config.host}:${config.port}`)
        const response = await transport.handleRequest(request)
        await writeWebResponse(response, res)
      } catch (error) {
        res.statusCode = 500
        res.end(error instanceof Error ? error.message : String(error))
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(config.port, config.host, () => {
      http.off('error', reject)
      resolve()
    })
  })

  const address = http.address()
  const port = typeof address === 'object' && address !== null ? address.port : config.port

  return {
    port,
    host: config.host,
    async close() {
      await new Promise<void>((resolve) => http.close(() => resolve()))
      await server.close().catch(() => undefined)
    },
  }
}

/** 直接执行时启动并打印生效配置（供 e2e 解析端口）。 */
async function main(): Promise<void> {
  const config = parseConfig(process.argv, process.env)
  const running = await startServer(config, planFixture())
  process.stdout.write(`MCP_HTTP_PORT=${running.port}\n`)
  process.stdout.write(`MCP_ENDPOINT=http://${running.host}:${running.port}/mcp\n`)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry && import.meta.url === entry) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
