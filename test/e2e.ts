/**
 * 端到端验证：真实取数落盘 → 分页读 JSON/模版 → 按序写入 content → 落盘 HTML。
 *
 * 运行：PLAN_ID=xxx npm run e2e
 * 不调用 LLM：用真实方案数据构造各章 HTML，验证工具链（取数、只读模版、原样落盘）。
 */

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'
import { DOCUMENT_ORDER } from '../src/chapters.ts'

const PLAN_ID = process.env.PLAN_ID ?? '62324f55920065cf56a88b8e132e88c2'
const OUT = process.env.OUT_DIR ?? 'dsh-output'
const DATA = process.env.DATA_DIR ?? 'dsh-plan-data'
const STATE = process.env.STATE_DIR ?? 'dsh-plan-state'
const EXEC = { agent: { id: process.env.SESSION_ID ?? 'e2e-session' } } as ToolRunContext

console.log(`[e2e] planId = ${PLAN_ID}`)
rmSync(OUT, { recursive: true, force: true })
rmSync(DATA, { recursive: true, force: true })
rmSync(STATE, { recursive: true, force: true })

const tools = new Map<string, ToolDefinition>()
apply({
  tools: { register: (t: ToolDefinition) => tools.set(t.name, t) },
  systemPrompt: { section: () => {} },
} as unknown as Context, {
  tenantId: 1,
  url: 'http://120.232.136.52:8095/admin-api/third/protocol/test-plan/getAiTestPlanData',
  timeoutMs: 30000,
  outDir: OUT,
  docDir: '',
  dataDir: DATA,
  stateDir: STATE,
})

const info = tools.get('get_test_plan_info')
if (!info) throw new Error('未注册 get_test_plan_info')
const got = await info.execute({ planId: PLAN_ID }, EXEC) as Record<string, unknown>
if (got.data !== undefined) {
  throw new Error('取数工具不应把完整 data 放进结果')
}
if (!existsSync(String(got.filePath))) {
  throw new Error(`方案 JSON 未落盘: ${got.filePath}`)
}
const data = JSON.parse(readFileSync(String(got.filePath), 'utf8')) as {
  basicInfo: { planName: string; planNo: string }
  functionInfo?: { functionPoints?: { pointName?: string; adoptionStatus?: string }[] }
}
const { basicInfo, functionInfo } = data
console.log(`[e2e] 取数成功: ${basicInfo.planName} / ${basicInfo.planNo}`)
console.log(`[e2e] 落盘 ${got.path}（${got.lines} 行 / ${got.bytes} 字节）`)
const points = (functionInfo?.functionPoints ?? []).filter((p) => (p.adoptionStatus ?? 'adopted') === 'adopted')
console.log(`[e2e] 已采纳功能点 ${points.length} 个: ${points.map((p) => p.pointName).join('、')}`)

const reader = tools.get('read_static_doc')
if (!reader) throw new Error('未注册 read_static_doc')
const page = await reader.execute({ path: got.path, offset: 1, limit: 20 }, {} as ToolRunContext) as { kind: string; content: string }
if (page.kind !== 'plan' || !page.content.includes('"basicInfo"')) {
  throw new Error('read_static_doc 未能分页读取落盘 JSON')
}
console.log('[e2e] ✓ 可用 read_static_doc 读取落盘 JSON')
const tpl = await reader.execute({ path: '01.html' }, {} as ToolRunContext) as { kind: string; content: string }
if (tpl.kind !== 'template' || !tpl.content.includes('范围')) {
  throw new Error('未能只读读取章节模版')
}
console.log('[e2e] ✓ 章节模版只读')

const write = tools.get('write_chapter')
if (!write) throw new Error('未注册 write_chapter')
let last: { done: boolean; next: string; missing: string[]; documentPath: string } | undefined
for (const no of DOCUMENT_ORDER) {
  const content = `<h1>${no}</h1><p>${no} ${basicInfo.planName}</p><p>本方案共 ${points.length} 个已采纳功能点</p>`
  last = await write.execute({ chapterNo: no, content }, EXEC) as typeof last
  console.log(`[e2e] ${no.padEnd(5)} → done=${last!.done} next=${last!.next || '-'} missing=${last!.missing.length}`)
}

if (!last?.done) {
  throw new Error(`未全部完成，仍缺: ${last?.missing.join('、')}`)
}
if (!existsSync(last.documentPath)) {
  throw new Error(`文档未落盘: ${last.documentPath}`)
}
const doc = readFileSync(last.documentPath, 'utf8')
const size = statSync(last.documentPath).size
console.log(`[e2e] 文档已落盘: ${last.documentPath} (${size} bytes)`)

const nameSlice = basicInfo.planName.slice(0, 8)
const checks: [string, RegExp][] = [
  ['封面 content 原样', /<h1>cover<\/h1>/],
  ['方案名进文档', new RegExp(nameSlice)],
  ['05 content 原样', /<h1>05<\/h1>/],
  ['功能点数量进文档', new RegExp(`本方案共 ${points.length} 个已采纳功能点`)],
  ['11 content 原样', /<h1>11<\/h1>/],
]
for (const [label, re] of checks) {
  if (!re.test(doc)) {
    throw new Error(`校验失败: ${label}`)
  }
  console.log(`[e2e] ✓ ${label}`)
}
const i04 = doc.indexOf('<h1>04</h1>')
const i05 = doc.indexOf('<h1>05</h1>')
const i06 = doc.indexOf('<h1>06</h1>')
if (!(i04 < i05 && i05 < i06)) {
  throw new Error('校验失败: 章节顺序应为 04 → 05 → 06')
}
console.log('[e2e] ✓ 章节顺序 04 → 05 → 06')
console.log('[e2e] 全部通过')
