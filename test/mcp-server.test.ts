/**
 * MCP server：资源解析、载荷结构与体量、工具调用、启动参数。
 *
 * 这里全部是纯函数级断言（不起进程）；真起进程 + 走 HTTP 的验证在 `test/mcp-e2e.test.ts`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planFixture } from '../src/mcp/fixture.ts'
import {
  PLAN_LIST_RESOURCE,
  RESOURCE_TEMPLATES,
  listPlanResources,
  parsePlanUri,
  readPlanResource,
} from '../src/mcp/resources.ts'
import { parseConfig } from '../src/mcp/server.ts'
import { TOOL_DEFINITIONS, callTool, toolError } from '../src/mcp/tools.ts'

const PLAN = planFixture()
const ID = 'example-plan-001'
const base = `plan://plans/${ID}`

/** 资源文本的字节数。 */
function bytesOf(uri: string): number {
  const [first] = readPlanResource(PLAN, uri)
  return Buffer.byteLength(first.text, 'utf8')
}

test('资源模板：一条目录 + 三条切片/兜底，uriTemplate 与目录一致', () => {
  assert.deepEqual(
    RESOURCE_TEMPLATES.map((t) => t.uriTemplate),
    [
      'plan://plans/{planId}',
      'plan://plans/{planId}/points/{index}',
      'plan://plans/{planId}/tests',
      'plan://plans/{planId}/raw',
    ],
  )
  assert.equal(PLAN_LIST_RESOURCE.uri, 'plan://plans')
})

test('parsePlanUri：五种形态', () => {
  assert.deepEqual(parsePlanUri('plan://plans'), { kind: 'list' })
  assert.deepEqual(parsePlanUri(base), { kind: 'index', planId: ID })
  assert.deepEqual(parsePlanUri(`${base}/points/2`), { kind: 'points', planId: ID, index: 2 })
  assert.deepEqual(parsePlanUri(`${base}/tests`), { kind: 'tests', planId: ID })
  assert.deepEqual(parsePlanUri(`${base}/raw`), { kind: 'raw', planId: ID })
})

test('parsePlanUri：非法 URI 与非法序号抛错', () => {
  assert.throws(() => parsePlanUri('http://example.com/x'), /无法识别/)
  assert.throws(() => parsePlanUri('plan://plans/x/points/abc'), /整数/)
  assert.throws(() => parsePlanUri('plan://plans/x/points/'), /整数/)
})

test('目录：含 basicInfo 与功能点清单，体量小到可先行读取', () => {
  const [content] = readPlanResource(PLAN, base)
  assert.equal(content.mimeType, 'application/json')
  const index = JSON.parse(content.text) as {
    planId: string
    basicInfo: Record<string, unknown>
    points: { index: number; pointName: string; fields: string[]; sizeKB: number }[]
    tests: unknown[]
    totals: { pointCount: number; testCount: number; rawKB: number }
  }
  assert.equal(index.planId, ID)
  assert.equal(index.basicInfo.planName, '示例发电机设备通电检查试验方案')
  assert.equal(index.points.length, 3)
  assert.equal(index.tests.length, 2)
  assert.equal(index.totals.pointCount, 3)
  assert.ok(index.points[0].fields.length > 0, '目录应列出字段名')
  assert.ok(bytesOf(base) < 3 * 1024, `目录应 <3KB，实际 ${bytesOf(base)} 字节`)
})

test('切片：只含正文，不含元数据，体量远小于原始', () => {
  const [content] = readPlanResource(PLAN, `${base}/points/0`)
  const slice = JSON.parse(content.text) as {
    index: number
    pointName: string
    adoptionStatus: string
    fields: { fieldName: string; fieldContent: unknown }[]
  }
  assert.equal(slice.index, 0)
  assert.ok(slice.pointName.length > 0)
  assert.ok(slice.fields.length > 0)
  for (const f of slice.fields) {
    assert.deepEqual(Object.keys(f).sort(), ['fieldContent', 'fieldName'])
  }

  for (const dropped of ['sourceReferences', 'designFileCount', 'fieldOrigin', 'sortNo', 'suggestions', 'fieldType']) {
    assert.ok(!content.text.includes(dropped), `切片不应包含 ${dropped}`)
  }

  const rawBytes = bytesOf(`${base}/raw`)
  const sliceBytes = bytesOf(`${base}/points/0`)
  assert.ok(
    sliceBytes * 10 < rawBytes,
    `单切片 ${sliceBytes} 字节应远小于原始 ${rawBytes} 字节`,
  )
})

test('试验信息切片：含 contentName 与 content', () => {
  const [content] = readPlanResource(PLAN, `${base}/tests`)
  const list = JSON.parse(content.text) as { index: number; contentName: string; content: unknown }[]
  assert.equal(list.length, 2)
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['content', 'contentName', 'index'])
  }
})

test('兜底资源返回未投影的原始数据', () => {
  const [content] = readPlanResource(PLAN, `${base}/raw`)
  const raw = JSON.parse(content.text) as { functionInfo: { functionPoints: { sourceReferences?: unknown }[] } }
  assert.ok(raw.functionInfo.functionPoints[0].sourceReferences, '原始数据应保留元数据')
})

test('越界序号与未知方案抛错', () => {
  assert.throws(() => readPlanResource(PLAN, `${base}/points/999`), /越界/)
  assert.throws(() => readPlanResource(PLAN, 'plan://plans/other-plan/points/0'), /未知方案/)
})

test('resources/list 返回内置 fixture 的那一条', () => {
  const entries = listPlanResources(PLAN)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].uri, base)
})

test('工具：三个，且都能调用', () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((t) => t.name), ['server_health', 'list_supported_tenants', 'echo'])

  const health = JSON.parse(callTool('server_health', {}).content[0].text) as { ok: boolean }
  assert.equal(health.ok, true)

  const tenants = JSON.parse(callTool('list_supported_tenants', {}).content[0].text) as { tenants: unknown[] }
  assert.equal(tenants.tenants.length, 1)

  const echoed = JSON.parse(callTool('echo', { text: '你好' }).content[0].text) as { text: string }
  assert.equal(echoed.text, '你好')
})

test('工具：未知工具与非法入参抛错', () => {
  assert.throws(() => callTool('nope', {}), /未知工具/)
  assert.throws(() => callTool('echo', {}), /字符串入参/)
})

test('toolError 产出 isError 结果', () => {
  const result = toolError('boom')
  assert.equal(result.isError, true)
  assert.equal(result.content[0].text, 'boom')
})

test('启动参数：--port 优先于环境变量，其次默认值', () => {
  assert.deepEqual(parseConfig(['node', 'server.js'], {}), { port: 8096, host: '127.0.0.1' })
  assert.deepEqual(parseConfig(['node', 'server.js'], { MCP_HTTP_PORT: '0' }), { port: 0, host: '127.0.0.1' })
  assert.deepEqual(parseConfig(['node', 'server.js', '--port', '9001'], { MCP_HTTP_PORT: '0' }), {
    port: 9001,
    host: '127.0.0.1',
  })
  assert.deepEqual(parseConfig(['node', 'server.js', '--port', '0', '--host', '0.0.0.0'], {}), {
    port: 0,
    host: '0.0.0.0',
  })
  assert.throws(() => parseConfig(['node', 'server.js', '--port', 'abc'], {}), /端口非法/)
  assert.throws(() => parseConfig(['node', 'server.js', '--port', '70000'], {}), /端口非法/)
})
