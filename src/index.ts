/**
 * 试验方案工具插件：为 DeepSeek Harness 提供 model-facing 工具。
 *
 * - `get_test_plan_info`：按 planId 取数，完整 JSON 写入 dataDir，工具结果只回摘要与路径。
 * - `read_static_doc`：只读、按需分页查阅 resources/doc 静态资料、章节模版与 dataDir 中的方案 JSON。
 * - `write_chapter`：按公文顺序写入各章全文，程序不改写内容；全部写完落盘为 HTML。
 *
 * 每个工具一个文件（src/tools/）；本入口只声明配置并注册。写章进度按 session 落盘。
 * tenantId、接口地址、输出目录、文档根、取数落盘目录来自部署配置。
 *
 * @module dsh-test-plan-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-system-prompt'

import { CHAPTERS } from './chapters.ts'
import { registerPrompt } from './prompt.ts'
import { ALLOWED_EXT, TEMPLATE_EXT, bundledTemplateDir, listRoots, resolveDataDir, resolveDocDir } from './static-docs.ts'
import { resolveStateDir } from './session-state.ts'
import { registerGetTestPlanInfo } from './tools/get_test_plan_info.ts'
import { registerReadStaticDoc } from './tools/read_static_doc.ts'
import { registerWriteChapter } from './tools/write_chapter.ts'

export const name = 'test-plan-tool'
// 依赖工具注册表与系统提示词注册表：框架在两者就绪后才调用 apply。
export const inject = ['tools', 'systemPrompt']

/** 默认接口地址（部署可用 config.url 覆盖）。 */
const DEFAULT_URL = 'http://120.232.136.52:8095/admin-api/third/protocol/test-plan/getAiTestPlanData'

/**
 * 工具插件的部署配置。凡是不同部署可能取不同值的参数都放在这里，不写死在代码中。
 */
export interface Config {
  tenantId: number
  url: string
  timeoutMs: number
  outDir: string
  docDir: string
  dataDir: string
  stateDir: string
}

/** Schemastery 配置 schema；默认值直接写在 schema 中，未提供的字段由框架填充。 */
export const Config = Schema.object({
  tenantId: Schema.number().default(1),
  url: Schema.string().default(DEFAULT_URL),
  timeoutMs: Schema.number().default(30000),
  outDir: Schema.string().default('dsh-output'),
  docDir: Schema.string().default(''),
  dataDir: Schema.string().default('dsh-plan-data'),
  stateDir: Schema.string().default('dsh-plan-state'),
})

/** 包装 connection.requestRejection 所需的最小形状。 */
interface ConnectionAuth {
  requestRejection?(request: unknown): unknown
}

/**
 * 注册工具与提示词段。
 * @param ctx - 携带工具注册表与系统提示词的插件上下文。
 * @param config - 部署配置，已通过 schema 校验并填充默认值。
 */
export function apply(ctx: Context, config: Config): void {
  const docDir = resolveDocDir(config.docDir)
  const dataDir = resolveDataDir(config.dataDir)
  const stateDir = resolveStateDir(config.stateDir)
  const templateDir = bundledTemplateDir()
  registerGetTestPlanInfo(ctx, { ...config, dataDir, stateDir })
  registerReadStaticDoc(ctx, docDir, dataDir, templateDir)
  registerWriteChapter(ctx, { ...config, stateDir })
  registerPrompt(ctx, CHAPTERS, listRoots([
    { dir: docDir, kind: 'static', exts: ALLOWED_EXT },
    { dir: templateDir, kind: 'template', exts: TEMPLATE_EXT },
  ]))
  // 内部网络无 token 访问：在 connection 就绪后 patch 掉浏览器 cookie 鉴权。
  patchInternalAuth(ctx)
}

/**
 * 让来自 loopback 或 trustedHosts 的请求无需浏览器 cookie/token 即可访问 /api。
 *
 * 实现方式：包装 `connection.requestRejection`；当它因缺失 cookie 返回 401 时直接放行。
 * 403（Host/Origin 不信任）仍保留，因此不会把接口暴露给外网或跨站浏览器。
 *
 * 仅在真实 Cordis 上下文（有 ctx.inject）中生效；单测用的假 ctx不会走到这里。
 */
function patchInternalAuth(ctx: Context): void {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['connection'], (connCtx) => {
    const connection = (connCtx as Context & { connection?: ConnectionAuth }).connection
    if (!connection || typeof connection.requestRejection !== 'function') return
    const original = connection.requestRejection.bind(connection)
    connection.requestRejection = function (request: unknown) {
      const rejection = original(request)
      // 原逻辑已通过 Host/Origin 信任栅栏，只是没 cookie：对内部来源放行。
      if (rejection === 401) return undefined
      return rejection
    }
  })
}
