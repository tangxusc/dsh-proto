/**
 * 基础扩展：内部网络无 token 鉴权 patch。
 *
 * 作为独立 cordis 行加载（`src/base_plugin/` 属于基础扩展），把原来内联在业务插件里的
 * `patchInternalAuth` 拆出来：当 `connection` 服务就绪后，包装 `connection.requestRejection`，
 * 让来自 loopback / trustedHosts 的请求无需浏览器 cookie/token 即可访问 /api。
 *
 * 仅放行因缺失 cookie 返回的 401（信任栅栏已通过）；403（Host/Origin 不信任）仍保留，
 * 因此不会把接口暴露给外网或跨站浏览器。仅在真实 Cordis 上下文（有 ctx.inject）中生效。
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/** 插件名（cordis 行 id 对应）。 */
export const name = 'internal-auth'

/** Schema 配置（本插件目前无参数，保留空对象以符合载体插件约定）。 */
export const Config = Schema.object({})

/** 包装 connection.requestRejection 所需的最小形状。 */
interface ConnectionAuth {
  requestRejection?(request: unknown): unknown
}

/**
 * 让来自 loopback 或 trustedHosts 的请求无需浏览器 cookie/token 即可访问 /api。
 * @param ctx - 真实 Cordis 上下文（含注入能力）。
 */
export function apply(ctx: Context): void {
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
