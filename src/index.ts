/**
 * 试验方案工具插件（业务扩展）：为 DeepSeek Harness 提供 model-facing 工具。
 *
 * - `read_static_doc`：只读、按需分页查阅静态参考资料与章节模版。
 * - `write_chapter`：按公文顺序写入各章全文，程序不改写内容；全部写完落盘为 HTML。
 *
 * **方案数据不经过本插件**：它由独立进程的 MCP server 以**资源**形式按需提供
 * （见 `src/mcp/`），dsh 侧的 `@deepseek-ai/dsh-mcp-resources` 把
 * `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` 交给模型。
 * 因此本插件不再取数、不落盘方案 JSON、也不需要 `dataDir`。
 *
 * 与基础扩展解耦（`src/base_plugin/`）：
 * - 通用 KV 由基础插件 `redis-kv-store`（ExtKvStore 的 Redis Provider）提供
 *   `extKvStore` 服务，本插件 `ctx.get(EXT_KV_SERVICE)` 可选用之，在其上用
 *   `sessionStore` 做 plan 专属映射；未启用时回退文件 sidecar（stateDir）；
 * - 内部网络无 token 鉴权由基础插件 `internal-auth` 单独承担。
 *
 * 每个工具一个文件（src/tools/），本入口只声明配置并注册工具、提示词。
 *
 * @module dsh-test-plan-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-system-prompt'

import { CHAPTERS } from './chapters.ts'
import { EXT_KV_SERVICE, type ExtKvStore } from './base_plugin/ext-kv-store/ext_kv_store.ts'
import { registerPrompt } from './prompt.ts'
import { ALLOWED_EXT, TEMPLATE_EXT, bundledTemplateDir, listRoots, resolveDocDir } from './static-docs.ts'
import {
  DEFAULT_SESSION_KEY_PREFIX,
  DEFAULT_SESSION_TTL_SECONDS,
  fileStore,
  resolveStateDir,
  sessionStore,
} from './session-state.ts'
import { registerReadStaticDoc } from './tools/read_static_doc.ts'
import { registerWriteChapter } from './tools/write_chapter.ts'

export const name = 'test-plan-tool'
// 工具注册表与系统提示词注册表是硬依赖：两者就绪后框架才调用 apply。
export const inject = ['tools', 'systemPrompt']

/**
 * 工具插件的部署配置。redis 的*连接*配置已移入基础扩展 redis-kv-store；这里只留
 * 业务自身如何用 redis（键前缀、过期时间），以及输出与只读资料的位置。
 */
export interface Config {
  outDir: string
  docDir: string
  stateDir: string
  /** 写章进度存 redis 时的键前缀；默认 dsh:plan-state:。 */
  keyPrefix?: string
  /** 写章进度存 redis 时的键过期时间（秒）；默认 3 天。 */
  ttlSeconds?: number
}

/** Schemastery 配置 schema；默认值直接写在 schema 中，未提供的字段由框架填充。 */
export const Config = Schema.object({
  outDir: Schema.string().default('dsh-output'),
  docDir: Schema.string().default(''),
  stateDir: Schema.string().default('dsh-plan-state'),
  keyPrefix: Schema.string().default(DEFAULT_SESSION_KEY_PREFIX),
  ttlSeconds: Schema.number().default(DEFAULT_SESSION_TTL_SECONDS),
})

/**
 * 读取某个 KV Provider 提供的通用 KV 服务（可选）。
 * @param ctx - 插件上下文。
 * @returns 存在 `extKvStore` 服务时返回通用 KV，否则 undefined。
 */
function readExtKvStore(ctx: Context): ExtKvStore | undefined {
  if (typeof ctx.get !== 'function') return undefined
  return ctx.get(EXT_KV_SERVICE) as ExtKvStore | undefined
}

/**
 * 注册工具与提示词段。
 * @param ctx - 携带工具注册表与系统提示词的插件上下文。
 * @param config - 部署配置，已通过 schema 校验并填充默认值。
 */
export function apply(ctx: Context, config: Config): void {
  const docDir = resolveDocDir(config.docDir)
  const stateDir = resolveStateDir(config.stateDir)
  const templateDir = bundledTemplateDir()

  // 状态存储：优先用某个 KV Provider 提供的通用 KV，在其上做 plan 专属映射；否则回退文件 sidecar。
  const kv = readExtKvStore(ctx)
  const store = kv
    ? sessionStore(kv, {
        prefix: config.keyPrefix ?? DEFAULT_SESSION_KEY_PREFIX,
        ttlSeconds: config.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
      })
    : fileStore(stateDir)

  registerReadStaticDoc(ctx, docDir, templateDir)
  registerWriteChapter(ctx, { ...config, stateDir, store })
  registerPrompt(ctx, CHAPTERS, listRoots([
    { dir: docDir, kind: 'static', exts: ALLOWED_EXT },
    { dir: templateDir, kind: 'template', exts: TEMPLATE_EXT },
  ]))
}
