/**
 * 内部网络无 token 鉴权 patch 单测：验证包装后的 `connection.requestRejection`
 * 只对 401（信任栅栏已通过但缺 cookie）放行，403 仍保留。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from './index.js'

const DEFAULTS = {
  tenantId: 1,
  url: 'http://x',
  timeoutMs: 1000,
  outDir: 'dsh-output-test',
  docDir: '',
  dataDir: 'dsh-plan-data-test',
  stateDir: 'dsh-plan-state-test',
}

/** 构造一个带假 connection 的 Cordis-like 上下文。 */
function makeCtx(rejectFn) {
  const connection = { requestRejection: rejectFn }
  return {
    tools: { register: () => {} },
    systemPrompt: { section: () => {} },
    inject: (deps, callback) => {
      if (deps.includes('connection')) callback({ connection })
    },
    connection,
  }
}

test('内部来源缺 cookie 时放行（401 -> undefined）', () => {
  const ctx = makeCtx(() => 401)
  apply(ctx, DEFAULTS)
  assert.equal(ctx.connection.requestRejection({}), undefined)
})

test('不信任来源仍拒绝（403 不变）', () => {
  const ctx = makeCtx(() => 403)
  apply(ctx, DEFAULTS)
  assert.equal(ctx.connection.requestRejection({}), 403)
})

test('已认证请求保持原样（undefined -> undefined）', () => {
  const ctx = makeCtx(() => undefined)
  apply(ctx, DEFAULTS)
  assert.equal(ctx.connection.requestRejection({}), undefined)
})
