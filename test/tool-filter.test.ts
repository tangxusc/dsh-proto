/**
 * 工具白名单过滤插件：deny-only 计算、restrict 调用时机、容错。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'

import { Config, apply, computeDeny, inject, name, type ServerToolFilter } from '../src/base_plugin/tool-filter/tool_filter.ts'

test('声明 inject: [tools]，否则 cordis 严格模式拒绝挂载', () => {
  // 真实 profile 上缺这行会以 agent-preset/invalid 拒绝：
  // cannot get property "tools" without inject。
  assert.equal(name, 'tool-filter')
  assert.deepEqual([...inject], ['tools'])
})

/** 一台 server 三个工具的常见场景。 */
const DISCOVERED = [
  { name: 'mcp__test-plan__server_health' },
  { name: 'mcp__test-plan__list_supported_tenants' },
  { name: 'mcp__test-plan__echo' },
  // 别的工具不该被误伤。
  { name: 'read_static_doc' },
  { name: 'write_chapter' },
  { name: 'read_mcp_resource' },
]

interface RestrictCall {
  allow?: readonly string[]
  deny?: readonly string[]
}

/** 假 ctx：记录 restrict 调用与 warn，effect 立刻求值（与 cordis 语义一致）。 */
function fakeCtx(schemas: readonly { name: string }[], throwOnRestrict = false) {
  const calls: RestrictCall[] = []
  const warnings: string[] = []
  const ctx = {
    tools: {
      schemas: () => schemas,
      restrict: (filter: RestrictCall) => {
        calls.push(filter)
        if (throwOnRestrict) throw new Error('restrict 只能在 agent scope 调用')
        return () => {}
      },
    },
    logger: { warn: (msg: string) => { warnings.push(msg) } },
    effect: (fn: () => unknown) => { fn(); return () => {} },
  }
  return { ctx: ctx as unknown as Context, calls, warnings }
}

test('computeDeny：只 deny 白名单之外的那些工具', () => {
  const servers: ServerToolFilter[] = [{ server: 'test-plan', allow: ['server_health'] }]
  const { deny, unknownAllow } = computeDeny(DISCOVERED, servers)
  assert.deepEqual(deny.sort(), [
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
  assert.deepEqual(unknownAllow, [])
})

test('computeDeny：不误伤非该 server 的工具与资源工具', () => {
  const { deny } = computeDeny(DISCOVERED, [{ server: 'test-plan', allow: ['echo'] }])
  for (const name of ['read_static_doc', 'write_chapter', 'read_mcp_resource']) {
    assert.ok(!deny.includes(name), `不应 deny ${name}`)
  }
})

test('computeDeny：未配置白名单或空数组都不限制', () => {
  assert.deepEqual(computeDeny(DISCOVERED, []).deny, [])
  assert.deepEqual(computeDeny(DISCOVERED, [{ server: 'test-plan' }]).deny, [])
  assert.deepEqual(computeDeny(DISCOVERED, [{ server: 'test-plan', allow: [] }]).deny, [])
  assert.deepEqual(computeDeny(DISCOVERED, [{ server: 'test-plan', allow: ['  '] }]).deny, [])
})

test('computeDeny：配了但没发现的工具只进 unknownAllow，不进 deny', () => {
  const { deny, unknownAllow } = computeDeny(DISCOVERED, [
    { server: 'test-plan', allow: ['server_health', 'not_a_tool'] },
  ])
  assert.deepEqual(unknownAllow, ['test-plan:not_a_tool'])
  assert.deepEqual(deny.sort(), ['mcp__test-plan__echo', 'mcp__test-plan__list_supported_tenants'])
  // 关键：deny 里全是已存在的名字，传给 restrict 不会触发未知工具错误。
  const known = new Set(DISCOVERED.map((d) => d.name))
  for (const name of deny) assert.ok(known.has(name), `${name} 不在已发现集合里`)
})

test('computeDeny：多台 server 各自独立', () => {
  const schemas = [
    ...DISCOVERED,
    { name: 'mcp__other__alpha' },
    { name: 'mcp__other__beta' },
  ]
  const { deny } = computeDeny(schemas, [
    { server: 'test-plan', allow: ['server_health'] },
    { server: 'other', allow: ['alpha'] },
  ])
  assert.deepEqual(deny.sort(), [
    'mcp__other__beta',
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
})

test('computeDeny：server 未发现任何工具时不产出 deny', () => {
  const { deny, unknownAllow } = computeDeny(DISCOVERED, [{ server: 'absent', allow: ['x'] }])
  assert.deepEqual(deny, [])
  assert.deepEqual(unknownAllow, ['absent:x'])
})

test('apply：按 deny 调一次 restrict', () => {
  const { ctx, calls, warnings } = fakeCtx(DISCOVERED)
  apply(ctx, { servers: [{ server: 'test-plan', allow: ['server_health'] }] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].allow, undefined)
  assert.deepEqual([...calls[0].deny ?? []].sort(), [
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
  assert.deepEqual(warnings, [])
})

test('apply：deny 为空时不调 restrict（空 filter 会抛错）', () => {
  const { ctx, calls } = fakeCtx(DISCOVERED)
  apply(ctx, { servers: [{ server: 'test-plan', allow: ['server_health', 'echo', 'list_supported_tenants'] }] })
  assert.equal(calls.length, 0)

  const empty = fakeCtx(DISCOVERED)
  apply(empty.ctx, {})
  assert.equal(empty.calls.length, 0)
})

test('apply：restrict 抛错时只记 warn，不向外抛', () => {
  const { ctx, warnings } = fakeCtx(DISCOVERED, true)
  assert.doesNotThrow(() => apply(ctx, { servers: [{ server: 'test-plan', allow: ['server_health'] }] }))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /restrict 失败/)
})

test('apply：配了未提供的工具时告警', () => {
  const { ctx, warnings } = fakeCtx(DISCOVERED)
  apply(ctx, { servers: [{ server: 'test-plan', allow: ['server_health', 'ghost'] }] })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /ghost/)
})

test('apply：拿不到 tools 服务时静默返回', () => {
  assert.doesNotThrow(() => apply({} as Context, { servers: [{ server: 'test-plan', allow: ['x'] }] }))
  assert.doesNotThrow(() => apply({ tools: {} } as unknown as Context, { servers: [] }))
})

test('Config schema：servers 默认空数组', () => {
  assert.deepEqual(Config({}).servers, [])
  const one = Config({ servers: [{ server: 'test-plan', allow: ['echo'] }] })
  assert.equal(one.servers?.[0].server, 'test-plan')
  assert.deepEqual(one.servers?.[0].allow, ['echo'])
})
