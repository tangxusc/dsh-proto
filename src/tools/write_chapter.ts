/**
 * write_chapter：按公文顺序写入一章，内容原样保存。
 *
 * 章节写什么由模型根据当前模版与方案数据决定，本工具不改写、不校验正文。
 * 必须按公文顺序一章接一章写；全部写完时把各章按顺序拼成一份 HTML。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { CHAPTERS, DOCUMENT_ORDER, findChapter, nextChapter } from '../chapters.ts'
import { sessionIdOf, type SessionState, type SessionStateStore } from '../session-state.ts'

/** 写章工具需要的部署配置子集。 */
export interface WriteChapterConfig {
  outDir: string
  stateDir: string
  /** 进度存储（redis 或文件 sidecar）。 */
  store: SessionStateStore
}

/** 章节编号列表，供工具说明。 */
function chapterBrief(): string {
  return CHAPTERS.map((c) => `${c.no} ${c.name}`).join(' → ')
}

/** 仅用于文档 <title>，不改章节正文。 */
function escTitle(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * 注册 write_chapter。
 * @param ctx - 携带工具注册表的插件上下文。
 * @param config - 部署配置（outDir、stateDir 等）。
 */
export function registerWriteChapter(ctx: Context, config: WriteChapterConfig): void {
  ctx.tools.register(defineTool({
    name: 'write_chapter',
    description:
      '写入试验方案的下一章。content 为该章全文（通常是对照模版写成的 HTML），程序原样保存，不改写内容。'
      + `必须按公文顺序逐章写入：${chapterBrief()}。不得跳章或乱序。`
      + '写该章前用 read_static_doc 读对应模版（cover.html / 01.html …），以当前读到的模版为准。',
    parameters: {
      chapterNo: {
        type: 'string',
        required: true,
        enum: DOCUMENT_ORDER,
        description: '章节编号，必须是当前尚未写入的下一章。',
      },
      content: {
        type: 'string',
        required: true,
        description: '该章全文。对照当前模版与方案数据生成，程序不修改。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapterNo: { type: 'string', required: true },
          done: { type: 'boolean', required: true, description: '全部章节是否已写完。' },
          next: { type: 'string', required: true, description: '下一章编号；全部写完时为空串。' },
          missing: { type: 'array', items: { type: 'string' }, required: true, description: '尚未写的章节编号（公文顺序）。' },
          documentPath: { type: 'string', description: '已写完时输出的 HTML 文件路径，否则为空串。' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.done
          ? `已写完第 ${value.chapterNo} 章，全部章节完成，文档已写入 ${value.documentPath}`
          : `已写入第 ${value.chapterNo} 章。下一章必须写 ${value.next}。未完成：${value.missing.join('、')}`,
      }],
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      const state = await config.store.load(sessionId)
      if (!state.planId) {
        throw new Error('请先调用 get_test_plan_info 获取方案数据')
      }
      const { chapterNo } = args
      const content = typeof args.content === 'string' ? args.content : ''
      if (content.trim().length === 0) {
        throw new Error('content 不能为空')
      }
      const chapter = findChapter(chapterNo)
      if (!chapter) {
        throw new Error(`未知章节: ${chapterNo}`)
      }
      const expected = nextChapter(state.chapters)
      if (!expected) {
        throw new Error('全部章节已写完，请重新调用 get_test_plan_info 后再生成')
      }
      if (chapterNo !== expected) {
        throw new Error(`须按公文顺序写入，下一章应为 ${expected}，收到 ${chapterNo}`)
      }
      state.chapters[chapterNo] = content
      await config.store.save(sessionId, state)

      const missing = DOCUMENT_ORDER.filter((no) => !state.chapters[no])
      const done = missing.length === 0
      const next = nextChapter(state.chapters) ?? ''
      let documentPath = ''
      if (done) {
        documentPath = writeDocument(config.outDir, state)
      }
      return { chapterNo, done, next, missing, documentPath }
    },
    presentCall: args => ({
      card: 'generic',
      title: `写入第 ${args.chapterNo} 章`,
      kind: 'other',
      rawInput: args.content,
    }),
  }))
}

/** 把已写章节按公文顺序拼成一份 HTML 并落盘，返回文件路径。 */
function writeDocument(outDir: string, state: SessionState): string {
  mkdirSync(outDir, { recursive: true })
  const planName = typeof state.basic?.planName === 'string' ? state.basic.planName : ''
  const title = planName ? `${planName} 试验方案` : '试验方案'
  const safeName = state.planId.replace(/[^A-Za-z0-9_-]/g, '') || 'plan'
  const path = join(outDir, `${safeName}.html`)
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escTitle(title)}</title>`,
    '</head><body>',
    DOCUMENT_ORDER.map((no) => state.chapters[no]).filter(Boolean).join('\n'),
    '</body></html>',
  ].join('\n')
  writeFileSync(path, html, 'utf8')
  return path
}
