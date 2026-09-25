/**
 * 方案资源：目录 + 按功能点切片 + 原始兜底。
 *
 * 资源**只读、按需、纯函数**（方案数据作为入参传入），进程不写磁盘。
 * 返回的 JSON 一律**紧凑格式** —— 缩进对上下文是纯浪费（实测占 26%），
 * 需要按行分页的场景另有其人。
 */

import { projectIndex, projectPoint, projectTests, sizeKB } from './project.ts'

/** 资源模板声明，对应 MCP `resources/templates/list`。 */
export interface ResourceTemplate {
  /** 注册键（server 内部唯一）。 */
  name: string
  uriTemplate: string
  title: string
  description: string
  mimeType: string
}

/** 固定资源声明，对应 MCP `resources/list`。 */
export interface ResourceEntry {
  name: string
  uri: string
  title: string
  description: string
  mimeType: string
}

/** 一个 `resources/read` 结果项。 */
export interface ResourceContent {
  uri: string
  mimeType: string
  text: string
}

/** 方案资源的 MIME 类型。 */
export const PLAN_MIME = 'application/json'

/** 固定资源：本 server 已知的方案清单。 */
export const PLAN_LIST_RESOURCE: ResourceEntry = {
  name: 'plans-list',
  uri: 'plan://plans',
  title: '可用方案',
  description: '本服务已知的方案清单。',
  mimeType: PLAN_MIME,
}

/**
 * 全部资源模板。顺序即展示顺序：先目录，再切片，最后兜底。
 */
export const RESOURCE_TEMPLATES: readonly ResourceTemplate[] = [
  {
    name: 'plan-index',
    uriTemplate: 'plan://plans/{planId}',
    title: '方案目录',
    description: '方案概览：basicInfo、功能点与试验信息清单（含各自体量）。先读它，再决定读哪些切片。',
    mimeType: PLAN_MIME,
  },
  {
    name: 'plan-points',
    uriTemplate: 'plan://plans/{planId}/points/{index}',
    title: '功能点切片',
    description: '单个功能点的正文（pointName、adoptionStatus、fields[fieldName,fieldContent]）。序号从 0 计，取自目录。',
    mimeType: PLAN_MIME,
  },
  {
    name: 'plan-tests',
    uriTemplate: 'plan://plans/{planId}/tests',
    title: '试验信息',
    description: '全部试验信息的正文（contentName、content）。',
    mimeType: PLAN_MIME,
  },
  {
    name: 'plan-raw',
    uriTemplate: 'plan://plans/{planId}/raw',
    title: '原始方案 JSON',
    description: '未投影的完整原始数据（含全部元数据）。体量很大，仅在切片缺少所需字段时才读。',
    mimeType: PLAN_MIME,
  },
]

/** 解析后的资源意图。 */
export type PlanResourceRef =
  | { kind: 'list' }
  | { kind: 'index'; planId: string }
  | { kind: 'points'; planId: string; index: number }
  | { kind: 'tests'; planId: string }
  | { kind: 'raw'; planId: string }

/** `plan://plans` 与 `plan://plans/<planId>[/points/<i>|/tests|/raw]`。 */
const PLAN_URI_RE = /^plan:\/\/plans(?:\/([^/]+))?(?:\/(points|tests|raw)(?:\/([^/]*))?)?$/

/**
 * 解析方案资源 URI。
 * @param uri - 模型传入的资源 URI。
 * @returns 解析后的意图。
 * @throws URI 不符合约定、切片序号非整数时。
 */
export function parsePlanUri(uri: string): PlanResourceRef {
  const raw = String(uri ?? '').trim()
  const m = PLAN_URI_RE.exec(raw)
  if (!m) {
    throw new Error(`无法识别的资源 URI: ${raw}`)
  }
  const planId = m[1] ? decodeURIComponent(m[1]) : ''
  const section = m[2]
  if (!planId) return { kind: 'list' }
  if (!section) return { kind: 'index', planId }
  if (section === 'tests') return { kind: 'tests', planId }
  if (section === 'raw') return { kind: 'raw', planId }
  const indexText = m[3]
  if (indexText === undefined || !/^\d+$/.test(indexText)) {
    throw new Error(`功能点序号必须是整数: ${raw}`)
  }
  return { kind: 'points', planId, index: Number(indexText) }
}

/**
 * 读一个方案资源。
 * @param plan - 方案原始数据。
 * @param uri - 资源 URI。
 * @returns `resources/read` 的 contents 数组。
 * @throws URI 非法、planId 不符、序号越界时。
 */
export function readPlanResource(plan: unknown, uri: string): ResourceContent[] {
  const ref = parsePlanUri(uri)
  if (ref.kind === 'list') {
    return [wrap(uri, planList(plan))]
  }
  assertKnownPlan(plan, ref.planId)
  switch (ref.kind) {
    case 'index':
      return [wrap(uri, projectIndex(plan, ref.planId))]
    case 'points':
      return [wrap(uri, projectPoint(plan, ref.index))]
    case 'tests':
      return [wrap(uri, projectTests(plan))]
    default:
      return [wrap(uri, plan)]
  }
}

/**
 * `resources/list` 的固定条目。本 dev server 只内置一份 fixture，因此只有一条。
 * @param plan - 方案原始数据。
 * @returns 资源条目数组。
 */
export function listPlanResources(plan: unknown): ResourceEntry[] {
  const planId = planIdOf(plan)
  if (!planId) return []
  return [
    {
      name: 'plan-index-instance',
      uri: `plan://plans/${encodeURIComponent(planId)}`,
      title: '方案目录',
      description: '内置 fixture 的方案概览。',
      mimeType: PLAN_MIME,
    },
  ]
}

/** 内置 fixture 里声明的 planId。 */
export function planIdOf(plan: unknown): string {
  const info = (plan as { functionInfo?: { planId?: unknown } } | undefined)?.functionInfo
  const id = info?.planId
  return typeof id === 'string' ? id.trim() : ''
}

/** `plan://plans` 的载荷：本 server 已知的方案清单。 */
function planList(plan: unknown): { plans: { planId: string; planName: string; rawKB: number }[] } {
  const planId = planIdOf(plan)
  const basic = (plan as { basicInfo?: { planName?: unknown } } | undefined)?.basicInfo
  const planName = typeof basic?.planName === 'string' ? basic.planName : ''
  if (!planId) return { plans: [] }
  return { plans: [{ planId, planName, rawKB: sizeKB(plan) }] }
}

/** 只接受 fixture 里声明的那个 planId，其余视为不存在。 */
function assertKnownPlan(plan: unknown, planId: string): void {
  const known = planIdOf(plan)
  if (known && known !== planId) {
    throw new Error(`未知方案: ${planId}（本服务内置 ${known}）`)
  }
}

/** 包成 `resources/read` 的一项：紧凑 JSON。 */
function wrap(uri: string, value: unknown): ResourceContent {
  return { uri, mimeType: PLAN_MIME, text: JSON.stringify(value) }
}
