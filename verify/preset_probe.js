/**
 * verify/preset_probe.js —— 一次性的「agent 作用域」验证探针。
 *
 * 解决的问题：preset 里的插件与 restriction **只对 agent 作用域生效**，
 * 而 headless / `--dump-config` 都证明不了这一点（`--dump-config` 只能证明接线，
 * headless 根本不消费 preset）。这里用与 web app **完全相同**的路径建一个 test-plan 会话，
 * 直接读该 agent 可见的工具清单。
 *
 * 断言：
 *   1. `read_static_doc` / `write_chapter` 可见 —— 章节工具搬进 preset 后仍对该 agent 生效
 *   2. `mcp__test-plan__echo` / `list_supported_tenants` **不可见** —— preset 里的 tool-filter 真的生效
 *   3. `mcp__test-plan__server_health` 可见 —— 白名单保留项没被误挡
 *   4. `read_mcp_resource` 可见 —— 资源工具不受影响
 *
 * 不需要模型、不需要 API key、不需要浏览器。
 *
 * 用法（两个独立进程）：
 *   node lib/mcp/server.js --port 8096                                    # 进程 A
 *   node <dsh>/lib/bin.js --profile tptest --no-open --port 0 \
 *     --patch verify/probe.patch.yml                                      # 进程 B，exit 0 = PASS
 *
 * 由 verify/probe.patch.yml 以 host 行加载；patch 里写 `name: ./preset_probe.js`，
 * dsh 会把相对路径改写成锚定在 patch 文件旁的 file:// URL（无需装进 node_modules）。
 *
 * ⚠️ 副作用：会真建一个 agent，因此在 ~/.dsh/sessions 落一个会话（agents.create 无 opt-out）。
 */

import { randomUUID } from 'node:crypto'

export const name = 'verify-preset-probe'

/** 硬依赖只写必须的；fs / agentDefaultModel / loader / appExit 用 ctx.get() 取，缺了也不卡住本行。 */
export const inject = ['agents', 'agentPresets', 'tools']

const PRESET_ID = 'test-plan'
const MCP_PREFIX = 'mcp__test-plan__'

const MUST_PRESENT = [
  'read_static_doc',
  'write_chapter',
  'read_mcp_resource',
  `${MCP_PREFIX}server_health`,
]
const MUST_ABSENT = [`${MCP_PREFIX}echo`, `${MCP_PREFIX}list_supported_tenants`]

/** 等 MCP 工具就绪的上限；超时后仍会读一次并如实报告，而不是挂死。 */
const MCP_WAIT_MS = 20_000

/** 打一行到 stdout（探针输出要能被 grep）。 */
function log(line) {
  process.stdout.write(`[preset-probe] ${line}\n`)
}

export function apply(ctx) {
  const exit = ctx.get('appExit')
  const done = (code) => {
    if (typeof exit === 'function') exit(code)
    else process.exitCode = code
  }
  // 刻意不 await：像 dsh-headless 一样把异步任务踢出去，让组合树正常 boot 完再跑。
  run(ctx).then(
    (ok) => done(ok ? 0 : 1),
    (error) => {
      process.stderr.write(`[preset-probe] ERROR: ${error?.stack ?? String(error)}\n`)
      done(1)
    },
  )
}

async function run(ctx) {
  const agents = ctx.get('agents')
  const presets = ctx.get('agentPresets')
  const tools = ctx.get('tools')
  if (agents === undefined || presets === undefined || tools === undefined) {
    throw new Error('agents / agentPresets / tools 缺失 —— 这个组合没有 preset 机制')
  }

  // 等组合树稳定：preset 行已注册、mcp-client 的首轮工具同步已完成
  // （dsh-mcp-client 的 apply 是 async，会 await 连接就绪）。
  await ctx.get('loader')?.await()

  const resolved = await presets.resolve(PRESET_ID)
  log(`resolved preset: ${resolved.id}`)

  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  const agentOptions =
    selection === undefined ? {} : { provider: selection.provider, model: selection.model }

  const sessionId = `probe-${randomUUID()}`
  log(`creating agent "${sessionId}" (cwd=${cwd})`)

  // 与 dsh-api-session-controller.composeAgent 同一配方：
  // resolve 出 preset id → create 时写进 meta.agentPreset → setup 里 mount。
  const handle = await agents.create({
    sessionId,
    agentOptions,
    meta: { cwd, agentPreset: resolved.id },
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, resolved.id)
    },
  })

  try {
    const agent = handle.agent
    log(`agent published; composedPreset = ${presets.composedPreset(agent.ctx) ?? '(none)'}`)

    const names = await waitForEndState(ctx, tools, agent)
    log(`visible tools (${names.length}): ${names.join(', ')}`)

    const problems = [
      ...MUST_PRESENT.filter((n) => !names.includes(n)).map((n) => `MISSING ${n}`),
      ...MUST_ABSENT.filter((n) => names.includes(n)).map((n) => `LEAKED  ${n}`),
    ]
    if (problems.length > 0) {
      process.stderr.write(`[preset-probe] FAIL\n  ${problems.join('\n  ')}\n`)
      return false
    }
    log('PASS：章节工具可见，且 tool-filter 挡住了 echo / list_supported_tenants')
    return true
  } finally {
    await handle.dispose().catch(() => {})
  }
}

/**
 * 等「最终态」而不是「某个 mcp__ 工具出现了」。
 *
 * 原因：`restrict()` 本身又会触发一次 `tools/change`，所以「刚出现」时过滤可能还没装上 ——
 * 只看「出现了」会误判成 LEAKED。这里等的是终局条件（server_health 在 且 echo 不在）。
 * @param ctx - 探针上下文。
 * @param tools - 工具注册表服务。
 * @param agent - 要查询可见工具集的 agent（同时充当 scope key）。
 * @returns 最终读到的工具名列表。
 */
function waitForEndState(ctx, tools, agent) {
  const read = () => tools.schemas(agent).map((s) => s.name)
  const satisfied = (names) =>
    names.includes(`${MCP_PREFIX}server_health`) && !names.includes(`${MCP_PREFIX}echo`)

  if (satisfied(read())) return Promise.resolve(read())

  return new Promise((resolve) => {
    let off
    let settled = false
    const finish = () => {
      if (settled) return
      const names = read()
      if (!satisfied(names)) return
      settled = true
      off?.()
      clearTimeout(timer)
      resolve(names)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      off?.()
      const names = read()
      if (!names.some((n) => n.startsWith(MCP_PREFIX))) {
        process.stderr.write(
          `[preset-probe] ${MCP_WAIT_MS}ms 内没有出现任何 ${MCP_PREFIX}* 工具 —— MCP server 起了吗？（MCP_SERVER_URL）\n`,
        )
      }
      resolve(names)
    }, MCP_WAIT_MS)

    off = ctx.on('tools/change', finish)
    finish() // 订阅后再查一次，避免订阅前刚好错过
  })
}
