/**
 * get_test_plan_info 工具单测：捕获注册的定义，用假 fetch 验证请求体、信封拆解与错误路径。
 * 依赖 @deepseek-ai/dsh-tools 与 @deepseek-ai/schemastery 需已安装（见 README）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, Config } from './index.js'

/** 用假 ctx 捕获全部注册的工具，按名字取用。传入 config 覆盖默认值。 */
function captureAll(config) {
  const tools = new Map()
  const ctx = {
    tools: { register: (tool) => { tools.set(tool.name, tool) } },
    systemPrompt: { section: () => {} },
  }
  apply(ctx, config)
  return tools
}

/** 取 get_test_plan_info 工具定义。 */
function capture(config) {
  const tool = captureAll({ outDir: 'dsh-output', ...config }).get('get_test_plan_info')
  assert.ok(tool, '未注册 get_test_plan_info')
  return tool
}

/** 假 fetch：记录调用参数，返回指定 JSON 与状态码。 */
function fakeFetch(payload, status = 200) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return {
      status,
      json: async () => payload,
    }
  }
  return { impl, calls }
}

test('注册的工具名与参数 schema 符合约定', () => {
  const tool = capture({ tenantId: 1, url: 'http://x', timeoutMs: 1000 })
  assert.equal(tool.name, 'get_test_plan_info')
  assert.equal(tool.parameters.properties.planId.type, 'string')
  // 必填在编译后的 JSON Schema 中体现为 required 数组。
  assert.deepEqual(tool.parameters.required, ['planId'])
})

test('execute 用配置的 tenantId 与 url 发起 POST，planId 来自参数', async () => {
  const tool = capture({ tenantId: 7, url: 'http://example/plan', timeoutMs: 1000 })
  const seen = fakeFetch({ code: 0, data: { basicInfo: { planName: 'X' } } })
  globalThis.fetch = seen.impl

  const value = await tool.execute({ planId: 'p1' }, {})

  assert.equal(seen.calls.length, 1)
  assert.equal(seen.calls[0].url, 'http://example/plan')
  assert.equal(seen.calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(seen.calls[0].init.body), { tenantId: 7, planId: 'p1' })
  assert.deepEqual(value, { planId: 'p1', tenantId: 7, data: { basicInfo: { planName: 'X' } } })
})

test('响应缺少 data 时抛出，不回退成整个信封', async () => {
  const tool = capture({ tenantId: 1, url: 'http://x', timeoutMs: 1000 })
  globalThis.fetch = fakeFetch({ code: 0, data: null, msg: '无此方案' }).impl
  await assert.rejects(() => tool.execute({ planId: 'p1' }, {}), /缺少 data/)
})

test('code 非 0 时抛出并带上后端 msg', async () => {
  const tool = capture({ tenantId: 1, url: 'http://x', timeoutMs: 1000 })
  globalThis.fetch = fakeFetch({ code: 500, msg: '方案不存在' }).impl
  await assert.rejects(() => tool.execute({ planId: 'p1' }, {}), /方案不存在/)
})

test('HTTP 4xx/5xx 抛出', async () => {
  const tool = capture({ tenantId: 1, url: 'http://x', timeoutMs: 1000 })
  globalThis.fetch = fakeFetch({}, 502).impl
  await assert.rejects(() => tool.execute({ planId: 'p1' }, {}), /HTTP 502/)
})

test('planId 为空字符串时抛出', async () => {
  const tool = capture({ tenantId: 1, url: 'http://x', timeoutMs: 1000 })
  await assert.rejects(() => tool.execute({ planId: '   ' }, {}), /不能为空/)
})

test('Config schema 默认值：tenantId=1、接口 URL 指向 55 环境', () => {
  const resolved = Config({})
  assert.equal(resolved.tenantId, 1)
  assert.equal(resolved.timeoutMs, 30000)
  assert.match(resolved.url, /getAiTestPlanData$/)
})

test('Config schema 允许覆盖 tenantId', () => {
  assert.equal(Config({ tenantId: 9 }).tenantId, 9)
})

test('render 产出含 planId 与数据的文本', () => {
  const tool = capture({ tenantId: 1, url: 'http://x', timeoutMs: 1000 })
  const blocks = tool.output.render({}, { planId: 'p1', tenantId: 1, data: { a: 1 } })
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /p1/)
  assert.match(blocks[0].text, /"a":1/)
})
