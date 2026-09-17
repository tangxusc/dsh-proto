/**
 * 提示词段：取数落盘 → 读当前模版与方案数据 → 按序把各章全文交给 write_chapter。
 *
 * 章节写什么以 resources/templates/dynamic-v1 当前文件为准，提示词不规定各章内容。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Chapter } from './chapters.ts'
import type { DocEntry } from './static-docs.ts'

/** 本插件提示词段的顺序（外部插件用自定义有限数）。 */
const SECTION_ORDER = 5100

/** 注册提示词段所需的最小 ctx。 */
export interface PromptContext {
  systemPrompt: {
    section(spec: { name: string; order: number; text: string }): unknown
  }
}

/**
 * 组装提示词文本。
 * @param chapters - 章节目录。
 * @param documents - 可读文件目录摘要（不含正文）。
 * @returns 提示词段文本。
 */
export function buildPrompt(chapters: readonly Chapter[], documents: readonly DocEntry[] = []): string {
  const brief = chapters.map((c) => `${c.no} ${c.name}`).join(' → ')
  const catalog = documents.length
    ? documents.map((d) => `- ${d.path}（${d.kind ? `${d.kind}，` : ''}${d.lines} 行）`).join('\n')
    : '（无）'
  return `【试验方案文档生成】
当用户要求生成试验方案文档时，按以下顺序使用工具：

1. 用 get_test_plan_info 取数，传入用户给出的 planId。完整 JSON 写入固定目录，工具结果
   只有摘要和 path；用 read_static_doc 按该 path 分页读方案数据。取数会清空此前已写章节。
2. 按公文顺序逐章写入，共 ${chapters.length} 章：${brief}。
   每一章：先 read_static_doc 读对应模版（cover.html / 01.html …），再结合方案数据生成
   该章全文，调用 write_chapter（chapterNo 必须等于返回值 next，第一次为 cover；
   content 为该章全文）。模版会更新，以你当前读到的为准。程序不改写 content，也不规定
   这一章必须写什么。不得跳章、倒序或并行写多章。
3. 全部写完后，write_chapter 给出 documentPath，告知用户。

只读资料（按需分页读，不要一次灌完整本）：
${catalog}
.html 是章节模版；.json 是方案数据；.md/.txt 是静态资料。不传 path 可列出目录。

harness中多轮对话交互,使用中文`
}

/**
 * 注册提示词段。
 * @param ctx - 携带 systemPrompt 服务的插件上下文。
 * @param chapters - 章节目录。
 * @param documents - 可读文件目录摘要。
 */
export function registerPrompt(ctx: PromptContext | Context, chapters: readonly Chapter[], documents: readonly DocEntry[] = []): void {
  ctx.systemPrompt.section({
    name: 'tool:test-plan-doc',
    order: SECTION_ORDER,
    text: buildPrompt(chapters, documents),
  })
}
