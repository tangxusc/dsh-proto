/**
 * 端到端验证：真实取数 → 按模版逐章生成 → 落盘 HTML。
 *
 * 运行：PLAN_ID=xxx node e2e.mjs
 * 不调用 LLM：用真实方案数据构造各章 blocks，验证工具链（取数、渲染、模版、落盘）完整可用。
 */

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { apply } from './index.js'

const PLAN_ID = process.env.PLAN_ID ?? '62324f55920065cf56a88b8e132e88c2'
const OUT = process.env.OUT_DIR ?? 'dsh-output'

console.log(`[e2e] planId = ${PLAN_ID}`)
rmSync(OUT, { recursive: true, force: true })

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) } }, {
  tenantId: 1,
  url: 'http://120.232.136.52:8095/admin-api/third/protocol/test-plan/getAiTestPlanData',
  timeoutMs: 30000,
  outDir: OUT,
})

// 1) 真实取数
const info = tools.get('get_test_plan_info')
const got = await info.execute({ planId: PLAN_ID }, {})
const { basicInfo, functionInfo } = got.data
console.log(`[e2e] 取数成功: ${basicInfo.planName} / ${basicInfo.planNo}`)
const points = (functionInfo?.functionPoints ?? []).filter((p) => (p.adoptionStatus ?? 'adopted') === 'adopted')
console.log(`[e2e] 已采纳功能点 ${points.length} 个: ${points.map((p) => p.pointName).join('、')}`)

// 2) 逐章生成：内容取自真实方案数据
const P = (text) => ({ kind: 'paragraph', text })
const H = (text) => ({ kind: 'heading', text })
const L = (items) => ({ kind: 'list', text: '', items })
const T = (columns, rows, text = '') => ({ kind: 'table', columns, rows, text })

const chapterBlocks = {
  cover: [P(`${basicInfo.planName}（${basicInfo.planNo}）`)],
  '01': [
    P(`试验目的：${basicInfo.objectiveDescription ?? '—'}`),
    H('适用范围'),
    L([`产品型号：${basicInfo.productModelName ?? '—'}`, `试验对象：${basicInfo.targetName ?? '—'}`, `试验类型：${basicInfo.testType ?? '—'}`]),
  ],
  '02': [
    P('本方案引用的试验依据文件如下。'),
    T(['序号', '文件名称', '类型'],
      (basicInfo.sourceFiles ?? []).map((f, i) => [String(i + 1), f.fileName ?? '—', f.fileType ?? '—'])),
  ],
  '03': [T(['术语', '说明'], [['通电检查', '验证设备上电前连接与绝缘状态、上电时序及供电参数'], ['航电总线', '航空电子系统间数据通信总线']])],
  '04': [P(`系统名称：${basicInfo.targetName ?? '—'}；功能：${basicInfo.functionName ?? '—'}。`), P('系统由航电任务系统及配套设备组成，通过航电总线进行数据交互。')],
  '05': [],
  '06': [H('试验准备'), L(['确认供电电源参数符合要求', '检查接地与绝缘状态']), H('异常处置'), L(['出现告警立即中止试验并保留现场'])],
  '07': [{ ...P('试验接口与职责边界如下（推荐分工待确认）。'), recommendation: true }],
  '08': [T(['角色', '职责'], [['试验负责人', '组织试验实施与结果判定']]), { ...P('具体人员配置待确认。'), recommendation: true }],
  '09': [T(['设备/工装', '用途', '状态'], [['多用表', '测量供电参数', '正常'], ['绝缘电阻测试仪', '测量绝缘状态', '待确认']])],
  '10': [L(['上电前检查 → 绝缘测试', '上电 → 时序验证', '自检 → 状态指示与告警验证', '航电总线通信验证'])],
  '11': [
    P('依据试验要求，各功能点指标与试验方法如下。'),
    T(['功能点', '指标要求', '试验方法'],
      points.map((p) => [p.pointName ?? '—', '待确认', '按试验依据执行'])),
  ],
}

const write = tools.get('write_chapter')
const order = ['cover', '05', '01', '02', '03', '04', '06', '07', '08', '09', '10', '11']
let last
for (const no of order) {
  last = await write.execute({ chapterNo: no, blocks: chapterBlocks[no] ?? [P('—')] }, {})
  console.log(`[e2e] ${no.padEnd(5)} → done=${last.done} missing=${last.missing.length}`)
}

if (!last.done) {
  throw new Error(`未全部完成，仍缺: ${last.missing.join('、')}`)
}
if (!existsSync(last.documentPath)) {
  throw new Error(`文档未落盘: ${last.documentPath}`)
}
const doc = readFileSync(last.documentPath, 'utf8')
const size = statSync(last.documentPath).size
console.log(`[e2e] 文档已落盘: ${last.documentPath} (${size} bytes)`)

// 3) 校验产物
const checks = [
  ['封面标题', /<h1>封面<\/h1>/],
  ['方案名进封面', new RegExp(basicInfo.planName.slice(0, 8))],
  ['05 目录', /<h1>05 试验项目<\/h1>/],
  ['05 功能点数', new RegExp(`共 ${points.length} 个功能点`)],
  ['11 章标题', /<h1>11 试验指标要求及试验方法<\/h1>/],
  ['占位符已清', /^(?!.*\{\{).*$/s],
]
for (const [label, re] of checks) {
  if (!re.test(doc)) {
    throw new Error(`校验失败: ${label}`)
  }
  console.log(`[e2e] ✓ ${label}`)
}
console.log('[e2e] 全部通过')
