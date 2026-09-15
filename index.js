/**
 * 试验方案工具插件：为 DeepSeek Harness 提供两个 model-facing 工具。
 *
 * - `get_test_plan_info`：按 planId 向 Java 侧 admin-api 取回试验方案完整数据。
 * - `write_chapter`：按模版逐章写入试验方案文档，全部写完落盘为 HTML。
 *
 * 两个工具共享一份会话状态：取数工具把方案身份与功能点存进去，写章工具据此渲染封面与 05 章。
 * tenantId、接口地址、输出目录来自部署配置（cordis.yml / cordis.patch.yml）。
 *
 * @module dsh-test-plan-tool
 */

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { CHAPTERS } from './src/chapters.js'
import { registerPrompt } from './src/prompt.js'
import { registerWriteChapter } from './tools/write_chapter.js'

export const name = 'test-plan-tool'
// 依赖工具注册表与系统提示词注册表：框架在两者就绪后才调用 apply。
export const inject = ['tools', 'systemPrompt']

/** 默认接口地址（部署可用 config.url 覆盖）。 */
const DEFAULT_URL = 'http://120.232.136.52:8095/admin-api/third/protocol/test-plan/getAiTestPlanData'

/**
 * 工具插件的部署配置类型（JSDoc）。凡是不同部署可能取不同值的参数都放在这里，不写死在代码中。
 *
 * @typedef {object} Config
 * @property {number} tenantId 租户 id，随每次请求发送；默认 1。
 * @property {string} url 试验方案数据接口地址；默认指向 55 环境的 admin-api。
 * @property {number} timeoutMs 请求超时（毫秒）。方案数据可能较大，默认 30s。
 * @property {string} outDir 生成文档的输出目录；默认写到进程工作目录下的 dsh-output。
 */

/** Schemastery 配置 schema；默认值直接写在 schema 中，未提供的字段由框架填充。 */
export const Config = z.object({
  tenantId: z.number().default(1),
  url: z.string().default(DEFAULT_URL),
  timeoutMs: z.number().default(30000),
  outDir: z.string().default('dsh-output'),
})

/**
 * 从接口响应信封中取出业务数据。后端约定 code=0 为成功，data 为载荷。
 * @param payload - 已解析的 JSON 响应体。
 * @returns 业务数据对象。
 * @throws 当响应不是对象、code 非 0、或缺少 data 时。
 */
function unwrap(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('试验方案接口返回的不是对象')
  }
  if (payload.code !== 0 && payload.code != null) {
    throw new Error(String(payload.msg ?? `试验方案接口 code=${payload.code}`))
  }
  // 明确要求信封带 data：回退到整个信封会把 {code,msg} 当成方案数据喂给模型，属错误。
  const data = payload.data
  if (typeof data !== 'object' || data === null) {
    throw new Error('试验方案接口缺少 data')
  }
  return data
}

/**
 * 从方案数据中提取已采纳的功能点名称。
 * @param data - 接口返回的方案数据。
 * @returns 功能点名称数组；无 functionInfo 时返回空数组。
 */
function adoptedPoints(data) {
  const infos = data?.functionInfo?.functionPoints
  if (!Array.isArray(infos)) {
    return []
  }
  return infos
    .filter((p) => (p.adoptionStatus ?? 'adopted') === 'adopted')
    .map((p) => String(p.pointName ?? '').trim())
    .filter(Boolean)
}

/**
 * 注册两个工具。
 * @param ctx - 携带工具注册表的插件上下文。
 * @param config - 部署配置，已通过 schema 校验并填充默认值。
 */
export function apply(ctx, config) {
  // 会话状态：取数工具写入，写章工具读取。插件生命周期内有效。
  const state = { planId: '', basic: null, points: [], chapters: {} }

  ctx.tools.register(defineTool({
    name: 'get_test_plan_info',
    description:
      '获取试验方案信息。按 planId 取回该试验方案的完整数据（基本信息、功能项、功能点与试验依据等）。'
      + 'planId 必填；tenantId 由部署配置提供，无需传入。取数后可调用 write_chapter 逐章生成文档。',
    parameters: {
      planId: { type: 'string', required: true, description: '试验方案 id，必填。' },
    },
    output: {
      // 规范值：接口原始载荷原样透出，便于模型按字段名直接引用。
      // 注：object 节点必须显式声明 additionalProperties；必填是属性级 `required: true`。
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          planId: { type: 'string', required: true, description: '回显本次请求的 planId。' },
          tenantId: { type: 'integer', required: true, description: '本次请求使用的租户 id。' },
          data: { type: 'object', additionalProperties: true, required: true, description: '试验方案数据。' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已获取试验方案 ${value.planId}（租户 ${value.tenantId}）：\n${JSON.stringify(value.data)}`,
      }],
    },
    async execute(args, exec) {
      const planId = args.planId.trim()
      // 必填 + 非空：schema 保证类型与存在，非空由这里补足。
      if (planId.length === 0) {
        throw new Error('planId 不能为空')
      }
      const body = JSON.stringify({ tenantId: config.tenantId, planId })
      // 超时与调用方取消取其一：任何一方 abort 都终止请求。
      const signal = exec.signal
        ? AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
        : AbortSignal.timeout(config.timeoutMs)
      let response
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
      // 记入会话状态，供 write_chapter 渲染封面与 05 章。
      state.planId = planId
      state.basic = data.basicInfo ?? null
      state.points = adoptedPoints(data)
      state.chapters = {}
      return { planId, tenantId: config.tenantId, data }
    },
    presentCall: args => ({
      card: 'generic',
      title: `获取试验方案 ${args.planId}`,
      kind: 'read',
      rawInput: args,
    }),
  }))

  registerWriteChapter(ctx, config, state)
  // 用提示词把两个工具串成「取数 → 逐章生成 → 落盘」的固定流程。
  registerPrompt(ctx, CHAPTERS)
}

