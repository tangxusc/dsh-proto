/**
 * 内存式假 redis：应答本插件用到的 AUTH / SELECT / GET / SET EX / DEL 命令。
 * 记录收到的命令序列与键值，供断言；不依赖真实 redis。
 */

import { createServer, type Server, type Socket } from 'node:net'
import { once } from 'node:events'

// ---- RESP 应答构造 ----

export function respSimple(s: string): Buffer {
  return Buffer.from(`+${s}\r\n`)
}

export function respBulk(s: string | null): Buffer {
  return Buffer.from(s === null ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n${s}\r\n`)
}

export function respInt(n: number): Buffer {
  return Buffer.from(`:${n}\r\n`)
}

export function respError(msg: string): Buffer {
  return Buffer.from(`-${msg}\r\n`)
}

function indexOfCrlf(buf: Buffer, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10) return i
  }
  return -1
}

/** 解析请求里的一个 RESP 数组（命令 = bulk 字符串数组）。 */
export function tryParseCommand(buf: Buffer): { cmd: string[]; len: number } | undefined {
  if (buf.length < 1 || buf[0] !== 0x2a) return undefined
  const n = indexOfCrlf(buf, 1)
  if (n === -1) return undefined
  const count = Number(buf.subarray(1, n).toString())
  if (!Number.isInteger(count) || count < 0) return undefined
  let pos = n + 2
  const cmd: string[] = []
  for (let i = 0; i < count; i++) {
    if (pos >= buf.length || buf[pos] !== 0x24) return undefined
    const sl = indexOfCrlf(buf, pos + 1)
    if (sl === -1) return undefined
    const len = Number(buf.subarray(pos + 1, sl).toString())
    const start = sl + 2
    if (buf.length < start + len + 2) return undefined
    cmd.push(buf.subarray(start, start + len).toString('utf8'))
    pos = start + len + 2
  }
  return { cmd, len: pos }
}

export type FakeRedis = {
  server: Server
  port: number
  /** 收到的命令序列。 */
  received: string[][]
  /** 当前键值（老版本 SET 不回写 EX）。 */
  mem: Map<string, string>
  /** 已 AUTH 的密码（若配置校验）。 */
  readonly authed: string | null
  close(): Promise<void>
}

/**
 * 启动假 redis 服务器。
 * @param requirePassword - 若提供，则 AUTH 必须带该密码，否则返回错误。
 */
export async function startFakeRedis(requirePassword?: string): Promise<FakeRedis> {
  const received: string[][] = []
  const mem = new Map<string, string>()
  let authed: string | null = null
  const server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0)
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      for (;;) {
        const parsed = tryParseCommand(buf)
        if (!parsed) break
        buf = buf.subarray(parsed.len)
        const cmd = parsed.cmd
        received.push(cmd)
        const op = (cmd[0] || '').toUpperCase()
        if (op === 'AUTH') {
          if (requirePassword !== undefined && cmd[1] !== requirePassword) {
            socket.write(respError('ERR invalid password'))
          } else {
            authed = cmd[1] ?? null
            socket.write(respSimple('OK'))
          }
        } else if (op === 'SELECT') {
          socket.write(respSimple('OK'))
        } else if (op === 'SET') {
          mem.set(cmd[1], cmd[2])
          socket.write(respSimple('OK'))
        } else if (op === 'GET' && cmd[1] === 'boom') {
          socket.write(respError('synthetic failure'))
        } else if (op === 'GET') {
          const v = mem.get(cmd[1])
          socket.write(respBulk(v ?? null))
        } else if (op === 'DEL') {
          socket.write(respInt(mem.delete(cmd[1]) ? 1 : 0))
        } else {
          socket.write(respSimple('OK'))
        }
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  return {
    server,
    port: address.port,
    received,
    mem,
    // 用 getter 暴露，避免对象字面量按值快照导致外部读到的永远是 null。
    get authed() {
      return authed
    },
    close: () =>
      new Promise((resolve) => {
        // 客户端（ioredis）可能仍持有连接，强制断开以免 server.close() 等待挂死进程。
        ;(server as unknown as { closeAllConnections?(): void }).closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
