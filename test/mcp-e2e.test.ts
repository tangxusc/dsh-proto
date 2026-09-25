/**
 * MCP e2e：**独立进程**起 server → 官方客户端走 Streamable HTTP → 资源 / 工具 / 写章全链路。
 *
 * 完全离线：server 内置 fixture，不访问任何外部接口。
 * 优先用编译产物 `lib/mcp/server.js`（`npm test` 会先跑 tsc）；没有则回退到 `src/` + strip-types。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { apply, type Config } from '../src/index.ts'
import { DOCUMENT_ORDER } from '../src/chapters.ts'
import { computeDeny } from '../src/base_plugin/tool-filter/tool_filter.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILT_SERVER = join(ROOT, 'lib', 'mcp', 'server.js')
const SOURCE_SERVER = join(ROOT, 'src', 'mcp', 'server.ts')
const PLAN_ID = 'example-plan-001'
const BASE = `plan://plans/${PLAN_ID}`
const WORK = mkdtempSync(join(tmpdir(), 'dsh-mcp-e2e-'))
const OUT = join(WORK, 'out')
const STATE = join(WORK, 'state')

interface ServerHandle {
  port: number
  stop(): Promise<void>
}

let server: ServerHandle
let client: Client

/** 起一个**独立进程**的 MCP server，从 stdout 解析实际端口。 */
async function startMcpServer(): Promise<ServerHandle> {
  const args = existsSync(BUILT_SERVER)
    ? [BUILT_SERVER]
    : ['--experimental-strip-types', SOURCE_SERVER]
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, MCP_HTTP_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP server 启动超时:\n${output}`)), 20000)
    const settle = (fn: () => void) => {
      clearTimeout(timer)
      fn()
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      const matched = /MCP_HTTP_PORT=(\d+)/.exec(output)
      if (matched) settle(() => resolve(Number(matched[1])))
    })
    child.stderr.on('data', (chunk: string) => { output += chunk })
    child.once('exit', (code) => settle(() => reject(new Error(`MCP server 提前退出 code=${code}\n${output}`))))
    child.once('error', (error) => settle(() => reject(error)))
  })

  return {
    port,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await once(child, 'exit').catch(() => undefined)
    },
  }
}

/** 取资源文本。 */
async function readText(uri: string): Promise<{ text: string; bytes: number }> {
  const result = await client.readResource({ uri }) as { contents: { text?: string }[] }
  const text = result.contents[0]?.text ?? ''
  return { text, bytes: Buffer.byteLength(text, 'utf8') }
}

/** 假 ctx 捕获插件注册的工具。 */
function pluginTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool) } },
    systemPrompt: { section: () => {} },
    get: () => undefined,
  }
  apply(ctx as unknown as Context, { outDir: OUT, docDir: '', stateDir: STATE } as Config)
  return tools
}

before(async () => {
  server = await startMcpServer()
  client = new Client({ name: 'mcp-e2e', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)))
})

after(async () => {
  await client?.close().catch(() => undefined)
  await server?.stop()
  rmSync(WORK, { recursive: true, force: true })
})

test('资源模板：目录 + 三种切片/兜底', async () => {
  const result = await client.listResourceTemplates() as { resourceTemplates: { uriTemplate: string }[] }
  assert.deepEqual(
    result.resourceTemplates.map((t) => t.uriTemplate),
    [
      'plan://plans/{planId}',
      'plan://plans/{planId}/points/{index}',
      'plan://plans/{planId}/tests',
      'plan://plans/{planId}/raw',
    ],
  )
})

test('目录：含 basicInfo 与功能点清单，体量小到可先行读取', async () => {
  const { text, bytes } = await readText(BASE)
  const index = JSON.parse(text) as {
    planId: string
    basicInfo: { planName: string }
    points: { index: number; pointName: string; fields: string[] }[]
    totals: { pointCount: number; rawKB: number }
  }
  assert.equal(index.planId, PLAN_ID)
  assert.match(index.basicInfo.planName, /试验方案/)
  assert.equal(index.points.length, 3)
  assert.ok(index.points[0].fields.length > 0)
  assert.ok(bytes < 3 * 1024, `目录应 <3KB，实际 ${bytes} 字节`)
})

test('切片：只有正文，不含元数据，体量远小于 raw', async () => {
  const slice = await readText(`${BASE}/points/0`)
  const parsed = JSON.parse(slice.text) as {
    pointName: string
    fields: { fieldName: string; fieldContent: unknown }[]
  }
  assert.ok(parsed.pointName.length > 0)
  for (const field of parsed.fields) {
    assert.deepEqual(Object.keys(field).sort(), ['fieldContent', 'fieldName'])
  }
  for (const dropped of ['sourceReferences', 'designFileCount', 'fieldOrigin', 'sortNo', 'suggestions']) {
    assert.ok(!slice.text.includes(dropped), `切片不应包含 ${dropped}`)
  }

  const raw = await readText(`${BASE}/raw`)
  assert.ok(
    slice.bytes * 10 < raw.bytes,
    `单切片 ${slice.bytes} 字节应远小于原始 ${raw.bytes} 字节`,
  )
})

test('越界序号与未知方案都报错', async () => {
  await assert.rejects(() => client.readResource({ uri: `${BASE}/points/999` }), /越界/)
  await assert.rejects(() => client.readResource({ uri: 'plan://plans/other-plan' }), /未知方案/)
})

test('工具：三个；白名单算出恰好 deny 另两个', async () => {
  const result = await client.listTools() as { tools: { name: string }[] }
  const names = result.tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['echo', 'list_supported_tenants', 'server_health'])

  // 把 server 上的工具名拼成 dsh 侧的公开名，喂给过滤插件。
  const schemas = names.map((name) => ({ name: `mcp__test-plan__${name}` }))
  const { deny, unknownAllow } = computeDeny(schemas, [{ server: 'test-plan', allow: ['server_health'] }])
  assert.deepEqual(unknownAllow, [])
  assert.deepEqual(deny.sort(), ['mcp__test-plan__echo', 'mcp__test-plan__list_supported_tenants'])
})

test('工具可被真正调用', async () => {
  const result = await client.callTool({ name: 'server_health', arguments: {} }) as {
    content: { type: string; text?: string }[]
  }
  const payload = JSON.parse(result.content[0].text ?? '{}') as { ok?: boolean }
  assert.equal(payload.ok, true)
})

test('全链路：读资源取 planId 与 planName → 12 章写完 → HTML 落盘', async () => {
  const index = JSON.parse((await readText(BASE)).text) as {
    planId: string
    basicInfo: { planName: string }
  }
  const slice = JSON.parse((await readText(`${BASE}/points/0`)).text) as { pointName: string }
  assert.ok(slice.pointName.length > 0, '切片应可用作章节素材')

  const tools = pluginTools()
  const write = tools.get('write_chapter')
  assert.ok(write, '未注册 write_chapter')
  const ctx = { agent: { id: 'e2e-session' } } as ToolRunContext

  let last: { done: boolean; documentPath: string } | undefined
  for (const chapterNo of DOCUMENT_ORDER) {
    last = await write.execute({
      planId: index.planId,
      chapterNo,
      content: `<h1>${chapterNo}</h1><p>${slice.pointName}</p>`,
      ...(chapterNo === 'cover' ? { planName: index.basicInfo.planName } : {}),
    }, ctx) as typeof last
  }

  assert.equal(last!.done, true)
  assert.ok(existsSync(last!.documentPath), `文档未落盘: ${last!.documentPath}`)
  const html = readFileSync(last!.documentPath, 'utf8')
  assert.match(html, new RegExp(`<title>${index.basicInfo.planName} 试验方案</title>`))
  assert.match(html, /<h1>cover<\/h1>/)
  assert.match(html, /<h1>11<\/h1>/)
  assert.ok(html.indexOf('<h1>cover</h1>') < html.indexOf('<h1>01</h1>'))
})

test('换 planId 触发重置，必须从封面重新写', async () => {
  const tools = pluginTools()
  const write = tools.get('write_chapter')
  assert.ok(write)
  const ctx = { agent: { id: 'e2e-session' } } as ToolRunContext

  // 上一个用例已写满 12 章；换 planId 后应清空并允许从 cover 重来。
  const r = await write.execute({
    planId: 'another-plan',
    chapterNo: 'cover',
    content: '<p>新方案封面</p>',
  }, ctx) as { next: string; missing: string[] }
  assert.equal(r.next, '01')
  assert.equal(r.missing.length, 11)

  await assert.rejects(
    () => write.execute({ planId: 'another-plan', chapterNo: '05', content: '<p>x</p>' }, ctx),
    /下一章应为 01/,
  )
})
