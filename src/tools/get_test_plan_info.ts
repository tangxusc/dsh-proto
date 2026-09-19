/**
 * get_test_plan_info：按 planId 向 Java 侧 admin-api 取回试验方案完整数据。
 *
 * 完整 JSON 写入固定目录（config.dataDir），工具结果只回摘要与相对路径，
 * 避免大载荷被 harness 截断。模型用 read_static_doc 按 path 分页读取该文件。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { sessionIdOf, type SessionStateStore } from '../session-state.ts'

/** 取数工具需要的部署配置子集。 */
export interface GetPlanConfig {
  tenantId: number
  url: string
  timeoutMs: number
  dataDir: string
  stateDir: string
  /** 进度存储（redis 或文件 sidecar）。 */
  store: SessionStateStore
}

/** 方案身份摘要。 */
interface PlanIdentity {
  planName: string
  planNo: string
  productModelName: string
  targetName: string
}

/**
 * 从接口响应信封中取出业务数据。后端约定 code=0 为成功，data 为载荷。
 * @param payload - 已解析的 JSON 响应体。
 * @returns 业务数据对象。
 * @throws 当响应不是对象、code 非 0、或缺少 data 时。
 */
function unwrap(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('试验方案接口返回的不是对象')
  }
  const envelope = payload as Record<string, unknown>
  if (envelope.code !== 0 && envelope.code != null) {
    throw new Error(String(envelope.msg ?? `试验方案接口 code=${envelope.code}`))
  }
  // 明确要求信封带 data：回退到整个信封会把 {code,msg} 当成方案数据喂给模型，属错误。
  const data = envelope.data
  if (typeof data !== 'object' || data === null) {
    throw new Error('试验方案接口缺少 data')
  }
  return data as Record<string, unknown>
}

/**
 * 从方案数据中提取已采纳的功能点名称。
 * @param data - 接口返回的方案数据。
 * @returns 功能点名称数组；无 functionInfo 时返回空数组。
 */
function adoptedPoints(data: Record<string, unknown>): string[] {
  const functionInfo = data.functionInfo
  if (typeof functionInfo !== 'object' || functionInfo === null) {
    return []
  }
  const infos = (functionInfo as { functionPoints?: unknown }).functionPoints
  if (!Array.isArray(infos)) {
    return []
  }
  return infos
    .filter((p) => {
      if (typeof p !== 'object' || p === null) return false
      return ((p as { adoptionStatus?: unknown }).adoptionStatus ?? 'adopted') === 'adopted'
    })
    .map((p) => String((p as { pointName?: unknown }).pointName ?? '').trim())
    .filter(Boolean)
}

/**
 * 把 planId 收成可做文件名的片段。
 * @param planId - 方案 id。
 * @returns 仅含字母数字下划线与短横线的名字。
 */
export function safePlanFileName(planId: string): string {
  return `${String(planId).replace(/[^A-Za-z0-9_-]/g, '') || 'plan'}.json`
}

/**
 * 把方案 JSON 美化写入 dataDir，便于按行分页读。
 * @param dataDir - 落盘根目录。
 * @param planId - 方案 id。
 * @param data - 接口 data 载荷。
 * @returns 相对路径、绝对路径、行数与字节数。
 */
export function writePlanFile(dataDir: string, planId: string, data: unknown): {
  path: string
  filePath: string
  lines: number
  bytes: number
} {
  mkdirSync(dataDir, { recursive: true })
  const path = safePlanFileName(planId)
  const filePath = join(dataDir, path)
  const text = `${JSON.stringify(data, null, 2)}\n`
  writeFileSync(filePath, text, 'utf8')
  return {
    path,
    filePath,
    lines: text.split('\n').length,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

/** 封面等只需要的身份字段，避免把整个 basicInfo 再塞进工具结果。 */
function identity(basic: unknown): PlanIdentity {
  if (typeof basic !== 'object' || basic === null) {
    return { planName: '', planNo: '', productModelName: '', targetName: '' }
  }
  const rec = basic as Record<string, unknown>
  return {
    planName: String(rec.planName ?? ''),
    planNo: String(rec.planNo ?? ''),
    productModelName: String(rec.productModelName ?? ''),
    targetName: String(rec.targetName ?? ''),
  }
}

/**
 * 注册 get_test_plan_info。
 * @param ctx - 携带工具注册表的插件上下文。
 * @param config - 部署配置（tenantId、url、timeoutMs、dataDir、stateDir）。
 */
export function registerGetTestPlanInfo(ctx: Context, config: GetPlanConfig): void {
  ctx.tools.register(defineTool({
    name: 'get_test_plan_info',
    description:
      '获取试验方案信息。按 planId 请求接口，把完整 JSON 写入固定目录，工具结果只返回摘要和相对路径。'
      + '完整数据请用 read_static_doc 传入返回的 path，按 offset/limit 分页读取，不要指望本工具一次吐出全文。'
      + 'planId 必填；tenantId 由部署配置提供。取数后按公文顺序调用 write_chapter。',
    parameters: {
      planId: { type: 'string', required: true, description: '试验方案 id，必填。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          planId: { type: 'string', required: true, description: '回显本次请求的 planId。' },
          tenantId: { type: 'integer', required: true, description: '本次请求使用的租户 id。' },
          path: { type: 'string', required: true, description: '落盘文件相对路径，交给 read_static_doc。' },
          filePath: { type: 'string', required: true, description: '落盘文件绝对路径。' },
          lines: { type: 'integer', required: true, description: 'JSON 文件行数。' },
          bytes: { type: 'integer', required: true, description: 'JSON 文件字节数。' },
          topKeys: { type: 'array', items: { type: 'string' }, required: true, description: 'data 的顶层字段名。' },
          basic: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              planName: { type: 'string', required: true },
              planNo: { type: 'string', required: true },
              productModelName: { type: 'string', required: true },
              targetName: { type: 'string', required: true },
            },
            description: '方案身份摘要。',
          },
          adoptedPoints: { type: 'array', items: { type: 'string' }, required: true, description: '已采纳功能点名称。' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已获取试验方案 ${value.planId}（${value.basic.planName || '未命名'}），完整 JSON 已写入 ${value.path}（${value.lines} 行 / ${value.bytes} 字节）。`
          + `请用 read_static_doc 读取 path="${value.path}"，按需分页，不要一次读完整本。`
          + `\n顶层字段：${value.topKeys.join('、') || '（无）'}`,
      }],
    },
    async execute(args, exec) {
      const planId = args.planId.trim()
      if (planId.length === 0) {
        throw new Error('planId 不能为空')
      }
      const body = JSON.stringify({ tenantId: config.tenantId, planId })
      const signal = exec.signal
        ? AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
        : AbortSignal.timeout(config.timeoutMs)
      let response: Response
      try {
        response = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        })
      } catch (error) {
        const kind = error instanceof Error ? error.constructor.name : 'Error'
        throw new Error(`获取试验方案失败: ${kind}`, { cause: error })
      }
      if (response.status >= 400) {
        throw new Error(`获取试验方案 HTTP ${response.status}`)
      }
      const data = unwrap(await response.json())
      const points = adoptedPoints(data)
      const saved = writePlanFile(config.dataDir, planId, data)
      const sessionId = sessionIdOf(exec)
      const basic = data.basicInfo
      await config.store.save(sessionId, {
        planId,
        basic: typeof basic === 'object' && basic !== null && !Array.isArray(basic)
          ? basic as Record<string, unknown>
          : null,
        points,
        chapters: {},
        planFile: saved.path,
      })
      return {
        planId,
        tenantId: config.tenantId,
        ...saved,
        topKeys: Object.keys(data),
        basic: identity(data.basicInfo),
        adoptedPoints: points,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `获取试验方案 ${args.planId}`,
      kind: 'read',
      rawInput: args,
    }),
  }))
}
