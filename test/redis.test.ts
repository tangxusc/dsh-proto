/**
 * redis 通用 KV：地址解析（含密码/库号）、RedisKvStore（ioredis）逐命令往返（含 AUTH/SELECT）、
 * sessionStore 在通用 KV 上的 plan 专属映射写读。
 *
 * 用 `net.createServer` 起一个内存式假 redis，只应答本插件用到的
 * AUTH / SELECT / GET / SET EX / DEL，验证存储语义，不依赖真实 redis。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseRedisUrl, RedisKvStore } from '../src/base_plugin/ext-kv-store/redis_kv_store_client.ts'
import { sessionStore } from '../src/session-state.ts'
import { startFakeRedis, type FakeRedis } from './fake-redis.ts'

/** ioredis 命令名是小写；断言时统一成大写，不绑死客户端实现细节。 */
function ops(received: string[][]): string[][] {
  return received.map(([op, ...args]) => [String(op).toUpperCase(), ...args])
}

test('parseRedisUrl 解析 host/port/scheme/db/auth', () => {
  assert.deepEqual(parseRedisUrl('redis://127.0.0.1:6379'), { host: '127.0.0.1', port: 6379 })
  assert.deepEqual(parseRedisUrl('redis://localhost:7000/3'), { host: 'localhost', port: 7000, db: 3 })
  // 带密码的 URL：`:` 前为用户名（忽略），`:` 后为密码。
  assert.deepEqual(parseRedisUrl('redis://:s3cret@example.com'), { host: 'example.com', port: 6379, password: 's3cret' })
  assert.deepEqual(parseRedisUrl('redis://user:pass@1.2.3.4:7000/2'), {
    host: '1.2.3.4',
    port: 7000,
    password: 'pass',
    db: 2,
  })
  assert.deepEqual(parseRedisUrl('host:9999'), { host: 'host', port: 9999 })
  assert.deepEqual(parseRedisUrl('redis://1.2.3.4'), { host: '1.2.3.4', port: 6379 })
  assert.deepEqual(parseRedisUrl(''), { host: '127.0.0.1', port: 6379 })
})

test('RedisKvStore 连上后先 AUTH 再 SELECT，再执行业务命令', async () => {
  const fake: FakeRedis = await startFakeRedis('secret')
  try {
    const client = new RedisKvStore(parseRedisUrl(`redis://:secret@127.0.0.1:${fake.port}/2`))
    await client.set('k', 'v', 60)
    assert.equal(fake.mem.get('k'), 'v')
    assert.equal(fake.authed, 'secret')
    await client.close()
    // AUTH 与 SELECT 必须先于业务命令，且按顺序。
    assert.deepEqual(ops(fake.received).slice(0, 3), [
      ['AUTH', 'secret'],
      ['SELECT', '2'],
      ['SET', 'k', 'v', 'EX', '60'],
    ])
  } finally {
    await fake.close()
  }
})

test('密码错误时 AUTH 转为异常', async () => {
  const fake: FakeRedis = await startFakeRedis('correct')
  try {
    const client = new RedisKvStore(parseRedisUrl(`redis://:wrong@127.0.0.1:${fake.port}`))
    await assert.rejects(() => client.set('k', 'v'), /invalid password/)
    await client.close()
  } finally {
    await fake.close()
  }
})

test('RedisKvStore SET/GET/DEL 逐命令往返并携带 EX', async () => {
  const fake: FakeRedis = await startFakeRedis()
  try {
    const client = new RedisKvStore({ host: '127.0.0.1', port: fake.port })
    await client.set('k', 'v', 60)
    assert.equal(fake.mem.get('k'), 'v')
    assert.equal(await client.get('k'), 'v')
    assert.equal(await client.get('missing'), null)
    await client.del('k')
    assert.equal(fake.mem.has('k'), false)
    assert.deepEqual(ops(fake.received), [
      ['SET', 'k', 'v', 'EX', '60'],
      ['GET', 'k'],
      ['GET', 'missing'],
      ['DEL', 'k'],
    ])
    await client.close()
  } finally {
    await fake.close()
  }
})

test('RedisKvStore 服务端错误应答转为异常', async () => {
  const fake: FakeRedis = await startFakeRedis()
  try {
    const client = new RedisKvStore({ host: '127.0.0.1', port: fake.port })
    await client.set('x', '1')
    await assert.rejects(() => client.get('boom'), /synthetic failure/)
    await client.close()
  } finally {
    await fake.close()
  }
})

test('sessionStore 在通用 KV 之上按 prefix+sessionId 写读，缺键为空进度', async () => {
  const fake: FakeRedis = await startFakeRedis()
  try {
    // RedisKvStore 结构上满足通用 ExtKvStore 契约，直接作为 KV 给 sessionStore。
    const kv = new RedisKvStore({ host: '127.0.0.1', port: fake.port })
    const store = sessionStore(kv, { prefix: 'plan:', ttlSeconds: 259200 })

    // 缺键 -> 空进度
    const empty = await store.load('s1')
    assert.equal(empty.planId, '')
    assert.deepEqual(empty.chapters, {})

    await store.save('s1', { planId: 'p1', basic: { a: 1 }, points: ['x'], chapters: { cover: '<p>hi</p>' }, planFile: '01.html' })
    const loaded = await store.load('s1')
    assert.equal(loaded.planId, 'p1')
    assert.equal(loaded.chapters.cover, '<p>hi</p>')
    assert.equal(loaded.basic && (loaded.basic as Record<string, unknown>).a, 1)

    // 键确实带前缀，且落到了 redis
    assert.equal(fake.mem.has('plan:s1'), true)
    assert.equal(fake.mem.has('s1'), false)

    // 关闭连接，避免阻塞假服务器关闭。
    await kv.close()
  } finally {
    await fake.close()
  }
})
