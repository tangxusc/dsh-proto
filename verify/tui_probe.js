/**
 * verify/tui_probe.js —— 验证 **TUI** 路径下 preset 是否真的生效。
 *
 * 与 `preset_probe.js`（web 路径）的区别：
 * - web 探针**自己建** agent（复刻 api-session-controller 的配方）；
 * - TUI 探针**不建** agent —— TUI 在运行时自己创建它，探针只等它出现，然后读**它**的可见工具。
 *   这样验证的是 TUI 自己的预设选择（`DSH_TUI_PRESET`）与它自己的 mount 路径。
 *
 * 断言与 web 探针相同：
 *   read_static_doc / write_chapter / read_mcp_resource / mcp__test-plan__server_health 在；
 *   mcp__test-plan__echo / list_supported_tenants 不在。
 *
 * 用法（容器内，需要 TTY）：
 *   docker run -t --rm -e CHENGFEI_API_KEY=... \
 *     -e MCP_SERVER_URL=http://host.docker.internal:8096/mcp \
 *     -v /tmp/tui-probe.js:/tmp/tui-probe.js:ro \
 *     -v /tmp/tui-probe.patch.yml:/tmp/p.yml:ro \
 *     -v /tmp/tui-verify:/out \
 *     dsh-test-plan-tool:0.1.0 tui --patch /tmp/p.yml
 *
 * 结果同时写 stdout 与 /out/result.txt（TUI 会刷屏，文件更可靠）。
 */

import { writeFileSync } from 'node:fs'

export const name = 'verify-tui-probe'

/** 硬依赖；agentPresets 用 ctx.get() 取（TUI 上不一定在，取不到就跳过该项诊断）。 */
export const inject = ['agents', 'tools']

const MCP_PREFIX = 'mcp__test-plan__'
const MUST_PRESENT = ['read_static_doc', 'write_chapter', 'read_mcp_resource', `${MCP_PREFIX}server_health`]
const MUST_ABSENT = [`${MCP_PREFIX}echo`, `${MCP_PREFIX}list_supported_tenants`]

/** TUI 建 agent 的上限。 */
const AGENT_WAIT_MS = 30_000
/** 等工具集稳定的上限。 */
const TOOL_WAIT_MS = 20_000

const OUT_FILE = '/out/result.txt'
const lines = []

/** 记一行：同时进内存（最后写文件）与 stdout。 */
function log(line) {
  const text = `[tui-probe] ${line}`
  lines.push(text)
  process.stdout.write(`${text}\n`)
}

/** 把累积的结果落盘（TUI 刷屏时 stdout 不可靠）。 */
function flush() {
  try {
    writeFileSync(OUT_FILE, `${lines.join('\n')}\n`)
  } catch (error) {
    process.stderr.write(`[tui-probe] 写 ${OUT_FILE} 失败: ${String(error)}\n`)
  }
}

export function apply(ctx) {
  const exit = ctx.get('appExit')
  const done = (code) => {
    flush()
    if (typeof exit === 'function') exit(code)
    else process.exitCode = code
  }
  run(ctx).then(
    (ok) => done(ok ? 0 : 1),
    (error) => {
      process.stderr.write(`[tui-probe] ERROR: ${error?.stack ?? String(error)}\n`)
      log(`ERROR ${error?.message ?? String(error)}`)
      done(1)
    },
  )
}

async function run(ctx) {
  const agents = ctx.get('agents')
  const tools = ctx.get('tools')
  if (agents === undefined || tools === undefined) throw new Error('agents / tools 缺失')

  log(`DSH_TUI_PRESET=${process.env.DSH_TUI_PRESET ?? '(未设)'}`)
  await ctx.get('loader')?.await()

  // 等 TUI 在运行时建出它自己的 agent —— 这是与 web 探针最大的区别。
  const agent = await waitForAgent(agents, AGENT_WAIT_MS)
  if (agent === undefined) throw new Error(`${AGENT_WAIT_MS}ms 内 TUI 没有创建任何 agent`)
  log(`agent 出现: ${agent.id}`)

  const presets = ctx.get('agentPresets')
  if (presets !== undefined) log(`composedPreset = ${presets.composedPreset(agent.ctx) ?? '(none)'}`)

  const names = await waitForTools(ctx, tools, agent)
  log(`visible tools (${names.length}): ${names.join(', ')}`)

  const problems = [
    ...MUST_PRESENT.filter((n) => !names.includes(n)).map((n) => `MISSING ${n}`),
    ...MUST_ABSENT.filter((n) => names.includes(n)).map((n) => `LEAKED  ${n}`),
  ]
  if (problems.length > 0) {
    log(`FAIL\n  ${problems.join('\n  ')}`)
    return false
  }
  log('PASS：TUI 会话的章节工具可见，且 tool-filter 挡住了 echo / list_supported_tenants')
  return true
}

/**
 * 轮询 `agents.list()` 直到出现 agent（TUI 在启动后创建它）。
 * @param agents - agent 注册表服务。
 * @param timeoutMs - 上限。
 * @returns 第一个 live agent，超时则 undefined。
 */
async function waitForAgent(agents, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const live = agents.list()
    if (live.length > 0) return live[0]
    if (Date.now() > deadline) return undefined
    await new Promise((r) => setTimeout(r, 250))
  }
}

/**
 * 等该 agent 的工具集到达「最终态」。
 * 与 web 探针同理：`restrict()` 自己又触发一次 `tools/change`，只看「出现了」会误判成漏挡。
 * @param ctx - 上下文。
 * @param tools - 工具注册表。
 * @param agent - TUI 自己的 agent。
 * @returns 最终读到的工具名列表。
 */
function waitForTools(ctx, tools, agent) {
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
        log(`${TOOL_WAIT_MS}ms 内没有出现任何 ${MCP_PREFIX}* 工具 —— MCP server 可达吗？`)
      }
      resolve(names)
    }, TOOL_WAIT_MS)

    off = ctx.on('tools/change', finish)
    finish()
  })
}
