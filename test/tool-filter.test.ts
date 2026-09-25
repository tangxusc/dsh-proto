/**
 * 工具白名单过滤插件：增量 deny、动态重算（tools/change）、告警分级、容错。
 *
 * 重点是**时序与自引用**：`restrict()` 装的是静态快照，而 `schemas()` 返回的是
 * 「已应用限制之后」的视图 —— 拿它做自引用的重算会让「挡住 → 消失 → 撤销 → 复现」
 * 震荡起来。这里用回归用例把这一点钉住。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'

import {
  Config,
  apply,
  computeDeny,
  createFilterState,
  inject,
  name,
  type ServerToolFilter,
} from '../src/base_plugin/tool-filter/tool_filter.ts'

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

/** 只有白名单里那个工具可见 —— 限制生效后的样子。 */
const AFTER_DENY = [{ name: 'mcp__test-plan__server_health' }]

const ONLY_HEALTH: ServerToolFilter[] = [{ server: 'test-plan', allow: ['server_health'] }]

interface RestrictCall {
  allow?: readonly string[]
  deny?: readonly string[]
}

/** 假 ctx：记录 restrict / lift / warn，effect 立刻求值，on 可手动触发。 */
function fakeCtx(initial: readonly { name: string }[], throwOnRestrict = false) {
  let schemas = [...initial]
  const restrictCalls: RestrictCall[] = []
  const lifted: number[] = []
  const warnings: string[] = []
  const listeners = new Set<() => void>()
  let effectDisposer: (() => void) | undefined

  const ctx = {
    tools: {
      schemas: () => schemas,
      restrict: (filter: RestrictCall) => {
        restrictCalls.push(filter)
        if (throwOnRestrict) throw new Error('restrict 只能在 agent scope 调用')
        const id = restrictCalls.length
        return () => { lifted.push(id) }
      },
    },
    logger: { warn: (msg: string) => { warnings.push(msg) } },
    on: (_event: string, fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    effect: (fn: () => unknown) => { effectDisposer = fn() as () => void; return () => {} },
  }

  return {
    ctx: ctx as unknown as Context,
    restrictCalls,
    lifted,
    warnings,
    /** 模拟 MCP 连上 / 重连 / 限制生效后工具集变化。 */
    setSchemas(next: readonly { name: string }[]) { schemas = [...next] },
    /** 模拟 tools/change 事件。 */
    emitChange() { for (const fn of [...listeners]) fn() },
    dispose() { effectDisposer?.() },
    listenerCount: () => listeners.size,
  }
}

test('声明 inject: [tools]，否则 cordis 严格模式拒绝挂载', () => {
  // 真实 profile 上缺这行会以 agent-preset/invalid 拒绝：
  // cannot get property "tools" without inject。
  assert.equal(name, 'tool-filter')
  assert.deepEqual([...inject], ['tools'])
})

test('computeDeny：只 deny 白名单之外的那些工具', () => {
  const { deny, pending, unknownAllow } = computeDeny(DISCOVERED, ONLY_HEALTH, createFilterState())
  assert.deepEqual(deny.sort(), [
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
  assert.deepEqual(pending, [])
  assert.deepEqual(unknownAllow, [])
})

test('computeDeny：不误伤非该 server 的工具与资源工具', () => {
  const { deny } = computeDeny(DISCOVERED, [{ server: 'test-plan', allow: ['echo'] }], createFilterState())
  for (const n of ['read_static_doc', 'write_chapter', 'read_mcp_resource']) {
    assert.ok(!deny.includes(n), `不应 deny ${n}`)
  }
})

test('computeDeny：未配置白名单或空数组都不限制', () => {
  const cases: ServerToolFilter[][] = [
    [],
    [{ server: 'test-plan' }],
    [{ server: 'test-plan', allow: [] }],
    [{ server: 'test-plan', allow: ['  '] }],
  ]
  for (const servers of cases) {
    const plan = computeDeny(DISCOVERED, servers, createFilterState())
    assert.deepEqual(plan.deny, [])
    assert.deepEqual(plan.pending, [])
    assert.deepEqual(plan.unknownAllow, [])
  }
})

test('computeDeny：一个工具都没发现 → pending（MCP 还没连上），不是配置错误', () => {
  const plan = computeDeny([], ONLY_HEALTH, createFilterState())
  assert.deepEqual(plan.deny, [])
  assert.deepEqual(plan.pending, ['test-plan'])
  assert.deepEqual(plan.unknownAllow, [], '未连上时不应报成「名字写错」')
})

test('computeDeny：已发现部分工具但白名单对不上 → unknownAllow', () => {
  const plan = computeDeny(DISCOVERED, [{ server: 'test-plan', allow: ['server_health', 'not_a_tool'] }], createFilterState())
  assert.deepEqual(plan.pending, [], '已经连上了，不算 pending')
  assert.deepEqual(plan.unknownAllow, ['test-plan:not_a_tool'])
  assert.deepEqual(plan.deny.sort(), ['mcp__test-plan__echo', 'mcp__test-plan__list_supported_tenants'])
  // 关键：deny 里全是已存在的名字，传给 restrict 不会触发未知工具错误。
  const known = new Set(DISCOVERED.map((d) => d.name))
  for (const n of plan.deny) assert.ok(known.has(n), `${n} 不在已发现集合里`)
})

test('computeDeny：多台 server 各自独立', () => {
  const schemas = [...DISCOVERED, { name: 'mcp__other__alpha' }, { name: 'mcp__other__beta' }]
  const { deny } = computeDeny(schemas, [
    { server: 'test-plan', allow: ['server_health'] },
    { server: 'other', allow: ['alpha'] },
  ], createFilterState())
  assert.deepEqual(deny.sort(), [
    'mcp__other__beta',
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
})

test('computeDeny：同一份输入再算一次是增量（deny 为空，不重复处理）', () => {
  const state = createFilterState()
  const first = computeDeny(DISCOVERED, ONLY_HEALTH, state)
  assert.equal(first.deny.length, 2)

  const second = computeDeny(DISCOVERED, ONLY_HEALTH, state)
  assert.deepEqual(second.deny, [], '已处理过的名字不应再次 deny')
  assert.equal(second.settled, true, '没有新名字 → 已稳定')
})

test('computeDeny：限制生效后被挡的工具从视图消失，也不会被当成「不存在」或重复 deny', () => {
  const state = createFilterState()
  computeDeny(DISCOVERED, ONLY_HEALTH, state)
  // 限制生效：被挡的两个工具从可见集里消失 —— 这正是之前引发震荡的输入。
  const after = computeDeny(AFTER_DENY, ONLY_HEALTH, state)
  assert.deepEqual(after.deny, [])
  assert.deepEqual(after.pending, [], 'server 已经发现过工具，不该退回 pending')
  assert.deepEqual(after.unknownAllow, [], 'server_health 只是被保留，不是写错')
})

test('computeDeny：重连后新增的工具会被补挡', () => {
  const state = createFilterState()
  computeDeny(DISCOVERED, ONLY_HEALTH, state)
  const { deny } = computeDeny([...DISCOVERED, { name: 'mcp__test-plan__new_tool' }], ONLY_HEALTH, state)
  assert.deepEqual(deny, ['mcp__test-plan__new_tool'])
})

test('apply：工具已就位时按 deny 装一次增量限制', () => {
  const f = fakeCtx(DISCOVERED)
  apply(f.ctx, { servers: ONLY_HEALTH })
  assert.equal(f.restrictCalls.length, 1)
  assert.equal(f.restrictCalls[0].allow, undefined)
  assert.deepEqual([...f.restrictCalls[0].deny ?? []].sort(), [
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
})

test('apply：MCP 尚未连上时不装限制、也不告警；连上后自动补上', () => {
  const f = fakeCtx([]) // 启动时 MCP 还没连上
  apply(f.ctx, { servers: ONLY_HEALTH })

  assert.equal(f.restrictCalls.length, 0, 'MCP 未连上时不应装限制')
  assert.deepEqual(f.warnings, [], '未连上属正常时序，不该告警')

  f.setSchemas(DISCOVERED)
  f.emitChange()

  assert.equal(f.restrictCalls.length, 1, 'tools/change 后应补上限制')
  assert.deepEqual([...f.restrictCalls[0].deny ?? []].sort(), [
    'mcp__test-plan__echo',
    'mcp__test-plan__list_supported_tenants',
  ])
})

test('apply：一台已连接、另一台还没连上时，已连接那台的 deny 仍要立刻装', () => {
  const schemas = [
    { name: 'mcp__a__keep' },
    { name: 'mcp__a__extra' },
    // server b 还没连上：没有任何 mcp__b__* 名字。
  ]
  const f = fakeCtx(schemas)
  apply(f.ctx, {
    servers: [
      { server: 'a', allow: ['keep'] },
      { server: 'b', allow: ['whatever'] },
    ],
  })

  assert.equal(f.restrictCalls.length, 1, '已连接的 a 不应因为 b 还没连上而被跳过')
  assert.deepEqual(f.restrictCalls[0].deny, ['mcp__a__extra'])
  assert.deepEqual(f.warnings, [], 'b 还没连上，属正常时序，不该告警')
})

test('apply：回归 —— 不会因「被挡的工具从 schemas 消失」而撤销限制（震荡）', () => {
  const f = fakeCtx(DISCOVERED)
  apply(f.ctx, { servers: ONLY_HEALTH })
  assert.equal(f.restrictCalls.length, 1)

  // 限制生效后，被挡掉的工具从可见集里消失 —— 之前的实现会据此重算成空并撤销限制，
  // 而撤销又触发 tools/change，形成「挡住 → 消失 → 撤销 → 复现」的震荡。
  f.setSchemas(AFTER_DENY)
  f.emitChange()

  assert.equal(f.restrictCalls.length, 1, '不应再装第二次')
  assert.deepEqual(f.lifted, [], '不应撤销任何限制，否则被挡的工具会复现')
})

test('apply：重连后新增的工具会被补挡', () => {
  const f = fakeCtx(DISCOVERED)
  apply(f.ctx, { servers: ONLY_HEALTH })
  f.setSchemas([...DISCOVERED, { name: 'mcp__test-plan__new_tool' }])
  f.emitChange()

  assert.equal(f.restrictCalls.length, 2)
  assert.deepEqual(f.restrictCalls[1].deny, ['mcp__test-plan__new_tool'])
})

test('apply：工具集稳定后才报「白名单名字对不上」，且只报一次', () => {
  const f = fakeCtx(DISCOVERED)
  apply(f.ctx, { servers: [{ server: 'test-plan', allow: ['server_health', 'ghost'] }] })
  assert.deepEqual(f.warnings, [], '本轮还有新名字，先不报（避免分批注册时误报）')

  f.setSchemas(AFTER_DENY)
  f.emitChange()
  assert.equal(f.warnings.length, 1)
  assert.match(f.warnings[0], /ghost/)

  f.emitChange()
  assert.equal(f.warnings.length, 1, '同一个未识别项不应重复告警')
})

test('apply：deny 为空时不调 restrict（空 filter 会抛错）', () => {
  const all = fakeCtx(DISCOVERED)
  apply(all.ctx, { servers: [{ server: 'test-plan', allow: ['server_health', 'echo', 'list_supported_tenants'] }] })
  assert.equal(all.restrictCalls.length, 0)

  const none = fakeCtx(DISCOVERED)
  apply(none.ctx, {})
  assert.equal(none.restrictCalls.length, 0)
})

test('apply：disposer 退订并撤销全部增量限制', () => {
  const f = fakeCtx(DISCOVERED)
  apply(f.ctx, { servers: ONLY_HEALTH })
  assert.equal(f.listenerCount(), 1, '应订阅 tools/change')

  f.setSchemas([...DISCOVERED, { name: 'mcp__test-plan__new_tool' }])
  f.emitChange()
  assert.equal(f.restrictCalls.length, 2)

  f.dispose()
  assert.equal(f.listenerCount(), 0, '应退订')
  assert.deepEqual(f.lifted.sort(), [1, 2], '两次增量都应被撤销')
})

test('apply：restrict 抛错时只记 warn，不向外抛', () => {
  const f = fakeCtx(DISCOVERED, true)
  assert.doesNotThrow(() => apply(f.ctx, { servers: ONLY_HEALTH }))
  assert.equal(f.warnings.length, 1)
  assert.match(f.warnings[0], /restrict 失败/)
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
