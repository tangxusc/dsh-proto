/**
 * redis-kv-store 基础插件：对外提供的是**通用 KV**（get/set/del），并按运行形态
 * （webServer / commands）注入读取接口，用 ctx.provide 把 `extKvStore` 服务提供给其它插件。
 *
 * 用假 redis 验证：不 mock 服务，真的经由 ioredis 读写假服务器；业务层如何映射
 * （前缀、序列化）属 `sessionStore` 的职责，不在这里测。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, type Config } from '../src/base_plugin/ext-kv-store/redis_kv_store_provider.ts'
import { startFakeRedis, type FakeRedis } from './fake-redis.ts'

interface Deregister {
  (): void
  called?: boolean
}

interface RouteReg {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => unknown
}

interface CmdReg {
  name: string
  description: string
  handler: (inv: { agent?: { id?: string }; rawInput?: string }) => unknown
}

interface KvLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
}

function makeCtx(services: { webServer?: { register(r: RouteReg): Deregister }; commands?: { register(c: CmdReg): Deregister } }) {
  const provided = new Map<string, unknown>()
  const effects: Array<() => unknown> = []
  const base = {
    get(name: string) {
      if (name === 'webServer') return services.webServer
      if (name === 'commands') return services.commands
      return undefined
    },
    provide(name: string, value: unknown) {
      provided.set(name, value)
      return () => {}
    },
    effect(fn: () => unknown) {
      // 与 Cordis 一致：注册时立即调用 registrar，得到 disposer；dispose 时再执行它。
      effects.push(fn() as () => unknown)
      return () => {}
    },
  }
  const ctx = {
    ...base,
    // 模拟可选注入：仅当 webServer 存在时触发回调，并把服务提供为上下文属性。
    inject(names: string[], cb: (webCtx: unknown) => void) {
      if (Array.isArray(names) && names.includes('webServer') && services.webServer !== undefined) {
        cb({ ...base, webServer: services.webServer })
      }
    },
    // 模拟插件卸载：执行注册的所有 effect，关闭 redis 连接、清理定时器。
    async dispose() {
      for (const fn of effects) {
        await fn()
      }
      effects.length = 0
    },
  }
  return { ctx, provided, effects, dispose: ctx.dispose }
}

/** 指向假 redis 的启用配置（连接相关，不含业务前缀/过期）。 */
function enabledConfig(fake: FakeRedis): Config {
  return {
    enabled: true,
    url: `redis://127.0.0.1:${fake.port}`,
    webPath: '/api/redis-kv-store',
  }
}

test('web 形态：注册按 key 取原始值的 exact 路由，并提供通用 extKvStore 服务', async () => {
  const fake = await startFakeRedis()
  const fakeCtx = makeCtx({ webServer: { register: () => (() => {}) as Deregister } })
  try {
    apply(fakeCtx.ctx as never, enabledConfig(fake))
    assert.ok(fakeCtx.provided.has('extKvStore'), '应提供 extKvStore 服务')
    const store = fakeCtx.provided.get('extKvStore') as KvLike
    assert.equal(typeof store.get, 'function')
    assert.equal(typeof store.set, 'function')
  } finally {
    await fakeCtx.dispose()
    await fake.close()
  }
})

test('web 形态：普通 GET 返回键对应的原始值（缺失为 null）', async () => {
  const fake = await startFakeRedis()
  let handler: ((req: unknown, res: unknown) => unknown) | undefined
  const fakeCtx = makeCtx({
    webServer: {
      register(r: RouteReg) {
        handler = r.handler
        return (() => {}) as Deregister
      },
    },
  })
  try {
    apply(fakeCtx.ctx as never, enabledConfig(fake))

    // 直接用通用 KV 写入原始值，再经路由读取，验证端到端。
    const store = fakeCtx.provided.get('extKvStore') as KvLike
    await store.set('p1', JSON.stringify({ planId: 'p1' }), 60)

    const res: any = {
      status: 0,
      body: '',
      writeHead(code: number) {
        this.status = code
      },
      end(b: string) {
        this.body = b
      },
      writableEnded: false,
      destroyed: false,
    }
    const req: any = { url: '/api/redis-kv-store?key=p1', headers: {} }
    await handler!(req, res)
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { planId: 'p1' })
    assert.equal(fake.mem.has('p1'), true)
  } finally {
    await fakeCtx.dispose()
    await fake.close()
  }
})

test('web 形态：标准 Content-Type: text/event-stream 请求走 SSE 订阅', async () => {
  const fake = await startFakeRedis()
  let handler: ((req: unknown, res: unknown) => unknown) | undefined
  const fakeCtx = makeCtx({
    webServer: {
      register(r: RouteReg) {
        handler = r.handler
        return (() => {}) as Deregister
      },
    },
  })
  try {
    apply(fakeCtx.ctx as never, enabledConfig(fake))

    const chunks: string[] = []
    const res: any = {
      status: 0,
      headers: {},
      writeHead(code: number, headers: Record<string, string>) {
        this.status = code
        this.headers = headers
      },
      write(c: string | Buffer) {
        chunks.push(String(c))
      },
      end() {},
      writableEnded: false,
      destroyed: false,
    }
    const reqHandlers: Record<string, (() => void) | undefined> = {}
    const req: any = {
      url: '/api/redis-kv-store?key=s1',
      headers: { 'content-type': 'text/event-stream' },
      on(ev: string, cb: () => void) {
        reqHandlers[ev] = cb
      },
      close() {
        reqHandlers.close?.()
      },
    }
    await handler!(req, res)
    assert.equal(res.status, 200)
    assert.match(String(res.headers['content-type']), /^text\/event-stream/)
    // 先写当前值（缺键为 null）为一帧 data（同一 chunk 内含 `retry:` 与 `data:`）
    assert.ok(chunks.some((c) => c.includes('data: ')))
    // 关闭请求清掉轮询定时器，避免测试进程挂住
    req.close()
  } finally {
    await fakeCtx.dispose()
    await fake.close()
  }
})

test('tui 形态：注册 /get-redis-kv-store 指令并返回当前 session 的原始值', async () => {
  const fake = await startFakeRedis()
  const cmds: CmdReg[] = []
  const fakeCtx = makeCtx({
    commands: {
      register(c: CmdReg) {
        cmds.push(c)
        return (() => {}) as Deregister
      },
    },
  })
  try {
    apply(fakeCtx.ctx as never, enabledConfig(fake))
    assert.ok(fakeCtx.provided.has('extKvStore'))
    assert.equal(cmds.length, 1)
    assert.equal(cmds[0].name, 'get-redis-kv-store')

    const store = fakeCtx.provided.get('extKvStore') as KvLike
    await store.set('sess-1', JSON.stringify({ planId: 'p-sess-1', points: ['a'] }))

    const result: any = await cmds[0].handler({ agent: { id: 'sess-1' } })
    assert.equal(result.kind, 'success')
    assert.ok(result.text.includes('sess-1'))
    assert.ok(result.text.includes('p-sess-1'))
    assert.ok(result.text.includes('a'))
  } finally {
    await fakeCtx.dispose()
    await fake.close()
  }
})

test('tui 形态：缺 session id 时返回 error', async () => {
  const fake = await startFakeRedis()
  const cmds: CmdReg[] = []
  const fakeCtx = makeCtx({
    commands: {
      register(c: CmdReg) {
        cmds.push(c)
        return (() => {}) as Deregister
      },
    },
  })
  try {
    apply(fakeCtx.ctx as never, enabledConfig(fake))
    const result: any = await cmds[0].handler({ rawInput: 'x' })
    assert.equal(result.kind, 'error')
  } finally {
    await fakeCtx.dispose()
    await fake.close()
  }
})

test('未启用时不提供 extKvStore 服务（业务插件回退文件）', () => {
  const fakeCtx = makeCtx({})
  apply(fakeCtx.ctx as never, { enabled: false, url: 'redis://127.0.0.1:6379' })
  assert.equal(fakeCtx.provided.has('extKvStore'), false)
})
