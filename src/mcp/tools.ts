/**
 * MCP server 暴露的工具。
 *
 * 方案数据走**资源**（见 `resources.ts`），这里的工具刻意做成无副作用的静态/回显工具，
 * 用途是验证「同一台 server 上有多个工具、配置里只启用其中一部分」这条需求。
 */

/** server 标识，用于握手与健康检查。 */
export const SERVER_NAME = 'dsh-test-plan-mcp'

/** server 版本。 */
export const SERVER_VERSION = '0.1.0'

/** 一个工具的声明，对应 MCP `tools/list`。 */
export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** 空入参 schema。 */
const NO_ARGS: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

/** 全部工具。顺序即 `tools/list` 的返回顺序。 */
export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: 'server_health',
    description: '返回本服务自身的健康状态与版本。无副作用。',
    inputSchema: NO_ARGS,
  },
  {
    name: 'list_supported_tenants',
    description: '列出本服务支持的租户。无副作用。',
    inputSchema: NO_ARGS,
  },
  {
    name: 'echo',
    description: '原样回显传入的文本，用于验证工具确实可被调用。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本。' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
]

/** 一个文本内容块。 */
export interface McpTextContent {
  type: 'text'
  text: string
}

/** `tools/call` 的结果。索引签名用于满足 MCP SDK 的结果类型约束。 */
export interface McpToolResult {
  [key: string]: unknown
  content: McpTextContent[]
  isError?: boolean
}

/** 把结果收成紧凑 JSON 文本块。 */
function json(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/** 失败结果：MCP 约定 `isError: true`，模型会看到明确失败而非假成功。 */
export function toolError(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * 调用一个工具。
 * @param name - 工具原始名。
 * @param args - 模型传入的入参。
 * @returns `tools/call` 的结果。
 * @throws 未知工具或入参不合法时（由 server 转成失败结果）。
 */
export function callTool(name: string, args: unknown): McpToolResult {
  switch (name) {
    case 'server_health':
      return json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION })
    case 'list_supported_tenants':
      return json({ tenants: [{ tenantId: 1, name: '示例租户' }] })
    case 'echo': {
      const text = (args as { text?: unknown } | undefined)?.text
      if (typeof text !== 'string') {
        throw new Error('echo 需要字符串入参 text')
      }
      return json({ text })
    }
    default:
      throw new Error(`未知工具: ${name}`)
  }
}
