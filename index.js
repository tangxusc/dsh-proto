/**
 * 试验方案工具插件：为 DeepSeek Harness 提供 model-facing 工具。
 *
 * - `get_test_plan_info`：按 planId 取数，完整 JSON 写入 dataDir，工具结果只回摘要与路径。
 * - `read_static_doc`：只读、按需分页查阅 doc/ 静态资料、章节模版与 dataDir 中的方案 JSON。
 * - `write_chapter`：按公文顺序写入各章全文，程序不改写内容；全部写完落盘为 HTML。
 *
 * 每个工具一个文件（tools/）；本入口只声明配置并注册。写章进度按 session 落盘。
 * tenantId、接口地址、输出目录、文档根、取数落盘目录来自部署配置。
 *
 * @module dsh-test-plan-tool
 */

import z from '@deepseek-ai/schemastery'

import { CHAPTERS } from './src/chapters.js'
import { registerPrompt } from './src/prompt.js'
import { ALLOWED_EXT, TEMPLATE_EXT, bundledTemplateDir, listRoots, resolveDataDir, resolveDocDir } from './src/static-docs.js'
import { resolveStateDir } from './src/session-state.js'
import { registerGetTestPlanInfo } from './tools/get_test_plan_info.js'
import { registerReadStaticDoc } from './tools/read_static_doc.js'
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
 * @property {string} docDir 静态参考文档根目录；空则使用插件自带的 doc/。相对路径相对进程 cwd。
 * @property {string} dataDir get_test_plan_info 落盘目录；默认 dsh-plan-data。相对路径相对进程 cwd。
 * @property {string} stateDir 按 session 隔离的写章进度目录；默认 dsh-plan-state。
 */

/** Schemastery 配置 schema；默认值直接写在 schema 中，未提供的字段由框架填充。 */
export const Config = z.object({
  tenantId: z.number().default(1),
  url: z.string().default(DEFAULT_URL),
  timeoutMs: z.number().default(30000),
  outDir: z.string().default('dsh-output'),
  docDir: z.string().default(''),
  dataDir: z.string().default('dsh-plan-data'),
  stateDir: z.string().default('dsh-plan-state'),
})

/**
 * 注册工具与提示词段。
 * @param ctx - 携带工具注册表与系统提示词的插件上下文。
 * @param config - 部署配置，已通过 schema 校验并填充默认值。
 */
export function apply(ctx, config) {
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
}
