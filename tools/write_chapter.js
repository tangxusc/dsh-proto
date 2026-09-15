/**
 * write_chapter 工具：按模版写入一章，并累积到会话文档。
 *
 * 模型只交结构化 blocks，HTML 由 src/render.js 生成，模型无法注入 HTML。
 * 每写一章更新会话内的章节表；全部写完时把整份文档写为 HTML 文件。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { CHAPTERS, GENERATED_NOS, findChapter } from '../src/chapters.js'
import { renderBlocks, fillTemplate, renderCatalogue } from '../src/render.js'

/** 正文块的 JSON schema（value schema DSL：必填写属性级 required，object 须声明 additionalProperties）。 */
const blockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['paragraph', 'heading', 'list', 'table'], description: '块类型。' },
    text: { type: 'string', description: '段落/小标题文本，或表格前的说明。未用时填空串。' },
    items: { type: 'array', items: { type: 'string' }, description: '列表项；kind=list 时必填，否则填空数组。' },
    columns: { type: 'array', items: { type: 'string' }, description: '表头；kind=table 时必填，否则填空数组。' },
    rows: {
      type: 'array',
      items: { type: 'array', items: { type: 'string' } },
      description: '表格行；kind=table 时必填，每行列数须等于表头列数，否则填空数组。',
    },
    recommendation: { type: 'boolean', description: '该块是否为无原文支持的「建议待确认」内容。' },
  },
}

/** 章节目录摘要，供模型了解可写哪些章及其要求。 */
function chapterBrief() {
  return CHAPTERS.map((c) => `${c.no} ${c.name}：${c.instructions}`).join('\n')
}

/**
 * 创建 write_chapter 工具。
 * @param ctx - 携带工具注册表的插件上下文。
 * @param config - 部署配置（outDir、tenantId 等）。
 * @param state - 会话内可变状态：chapters 记录已写章节，basic/points 来自方案数据。
 */
export function registerWriteChapter(ctx, config, state) {
  ctx.tools.register(defineTool({
    name: 'write_chapter',
    description:
      '按模版写入试验方案的某一章。只交结构化 blocks，不要写 HTML。'
      + '封面（cover）与第 05 章由程序渲染，可用 write_chapter 传入 chapterNo="cover"/"05" 触发。'
      + '章节要求：\n' + chapterBrief(),
    parameters: {
      chapterNo: {
        type: 'string',
        required: true,
        enum: ['cover', '05', ...GENERATED_NOS],
        description: '章节编号；cover 为封面，05 为试验项目目录。',
      },
      blocks: { type: 'array', items: blockSchema, required: true, description: '该章正文块，至少一块。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapterNo: { type: 'string', required: true },
          done: { type: 'boolean', required: true, description: '全部章节是否已写完。' },
          missing: { type: 'array', items: { type: 'string' }, required: true, description: '尚未写的章节编号。' },
          documentPath: { type: 'string', description: '已写完时输出的 HTML 文件路径，否则为空串。' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.done
          ? `已写完第 ${value.chapterNo} 章，全部章节完成，文档已写入 ${value.documentPath}`
          : `已写入第 ${value.chapterNo} 章。未完成：${value.missing.join('、')}`,
      }],
    },
    execute(args) {
      const { chapterNo, blocks } = args
      const chapter = chapterNo === 'cover' || chapterNo === '05' ? undefined : findChapter(chapterNo)
      if (chapterNo !== 'cover' && chapterNo !== '05' && !chapter) {
        throw new Error(`未知章节: ${chapterNo}`)
      }
      // 封面与 05 章由程序渲染，忽略模型给的 blocks，保证格式稳定。
      let html
      if (chapterNo === 'cover') {
        html = fillTemplate('cover', renderBlocks(blocks, chapterNo))
      } else if (chapterNo === '05') {
        html = renderCatalogue(state.points)
      } else {
        html = fillTemplate(chapterNo, renderBlocks(blocks, chapterNo))
      }
      state.chapters[chapterNo] = html

      const missing = wantedChapters().filter((no) => !state.chapters[no])
      const done = missing.length === 0
      let documentPath = ''
      if (done) {
        documentPath = writeDocument(config.outDir, state)
      }
      return { chapterNo, done, missing, documentPath }
    },
    presentCall: args => ({
      card: 'generic',
      title: `写入第 ${args.chapterNo} 章`,
      kind: 'other',
      rawInput: args.blocks,
    }),
  }))
}

/** 需全部写完才算完成的章节：封面 + 05 + 其余各章。 */
function wantedChapters() {
  return ['cover', '05', ...GENERATED_NOS]
}

/** 把已写章节按公文顺序拼成一份 HTML 并落盘，返回文件路径。 */
function writeDocument(outDir, state) {
  // 延迟到真正写盘时建目录，避免插件加载期产生副作用。
  mkdirSync(outDir, { recursive: true })
  const order = ['cover', '05', ...GENERATED_NOS]
  const title = state.basic?.planName ? `${state.basic.planName} 试验方案` : '试验方案'
  const safeName = state.planId.replace(/[^A-Za-z0-9_-]/g, '') || 'plan'
  const path = join(outDir, `${safeName}.html`)
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    '</head><body>',
    order.map((no) => state.chapters[no]).filter(Boolean).join('\n'),
    '</body></html>',
  ].join('\n')
  writeFileSync(path, html, 'utf8')
  return path
}
