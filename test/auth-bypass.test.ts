/**
 * internal-auth 基础插件单测：验证包装后的 `connection.requestRejection`
 * 只对 401（信任栅栏已通过但缺 cookie）放行，403 仍保留。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/base_plugin/internal-auth/internal_auth.ts'

interface ConnectionLike {
  requestRejection: (request: unknown) => unknown
}

/** 构造一个带假 connection 的 Cordis-like 上下文。 */
function makeCtx(rejectFn: (request: unknown) => unknown): Context & { connection: ConnectionLike } {
  const connection: ConnectionLike = { requestRejection: rejectFn }
  return {
    inject: (deps: string[], callback: (c: { connection: ConnectionLike }) => void) => {
      if (deps.includes('connection')) callback({ connection })
    },
    connection,
  } as unknown as Context & { connection: ConnectionLike }
}

test('内部来源缺 cookie 时放行（401 -> undefined）', () => {
  const ctx = makeCtx(() => 401)
  apply(ctx)
  assert.equal(ctx.connection.requestRejection({}), undefined)
})

test('不信任来源仍拒绝（403 不变）', () => {
  const ctx = makeCtx(() => 403)
  apply(ctx)
  assert.equal(ctx.connection.requestRejection({}), 403)
})

test('已认证请求保持原样（undefined -> undefined）', () => {
  const ctx = makeCtx(() => undefined)
  apply(ctx)
  assert.equal(ctx.connection.requestRejection({}), undefined)
})
