/**
 * read_static_doc：只读查阅静态参考资料、章节模版，以及 get_test_plan_info 落盘的方案 JSON。
 *
 * 不带 path 列出目录；带 path 按行分页读取。路径锁在对应根目录内，不能写入。
 * .md/.txt 走 docDir；.json 走 dataDir；.html 走章节模版目录（只参照，不渲染）。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import {
  ALLOWED_EXT,
  DEFAULT_PAGE_LINES,
  MAX_PAGE_LINES,
  PLAN_EXT,
  TEMPLATE_EXT,
  catalogBrief,
  listRoots,
  readFromRoots,
} from '../src/static-docs.js'

const emptyRead = {
  path: '',
  kind: '',
  offset: 0,
  limit: 0,
  totalLines: 0,
  hasMore: false,
  nextOffset: 0,
  content: '',
}

/**
 * 注册 read_static_doc。
 * @param ctx - 携带工具注册表的插件上下文。
 * @param docDir - 静态文档根目录。
 * @param dataDir - get_test_plan_info 落盘目录。
 * @param templateDir - 章节模版目录（只读参照）。
 */
export function registerReadStaticDoc(ctx, docDir, dataDir, templateDir) {
  const roots = [
    { dir: docDir, kind: 'static', exts: ALLOWED_EXT },
    { dir: dataDir, kind: 'plan', exts: PLAN_EXT },
    { dir: templateDir, kind: 'template', exts: TEMPLATE_EXT },
  ]
  const documents = listRoots(roots)
  ctx.tools.register(defineTool({
    name: 'read_static_doc',
    description:
      '只读查阅文件，不能修改。不传 path 列出目录；传入 path 按行分页读取正文。'
      + `单次最多 ${MAX_PAGE_LINES} 行，默认 ${DEFAULT_PAGE_LINES} 行；hasMore 为 true 时用 nextOffset 继续读。`
      + '.md/.txt 是静态参考资料；.json 是 get_test_plan_info 写入的方案数据；.html 是章节模版（会更新，以当前文件为准）。'
      + '当前目录：\n' + catalogBrief(documents),
    parameters: {
      path: {
        type: 'string',
        description: '相对路径，如 业务术语解释.md、cover.html 或取数返回的 xxx.json。省略或空串则只列出目录。',
      },
      offset: {
        type: 'number',
        description: '起始行号，从 1 计；默认 1。',
      },
      limit: {
        type: 'number',
        description: `本页行数；默认 ${DEFAULT_PAGE_LINES}，最大 ${MAX_PAGE_LINES}。`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, description: 'list 或 read。' },
          documents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                lines: { type: 'integer', required: true },
                bytes: { type: 'integer', required: true },
                kind: { type: 'string', required: true, description: 'static、plan 或 template。' },
              },
            },
            description: '目录；read 时为空数组。',
          },
          path: { type: 'string', required: true },
          kind: { type: 'string', required: true, description: 'static、plan、template，或列出时为空。' },
          offset: { type: 'integer', required: true },
          limit: { type: 'integer', required: true },
          totalLines: { type: 'integer', required: true },
          hasMore: { type: 'boolean', required: true },
          nextOffset: { type: 'integer', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'list'
          ? (value.documents.length
            ? `可读文件目录：\n${value.documents.map((d) => `- ${d.path}（${d.kind}，${d.lines} 行）`).join('\n')}`
            : '可读文件目录为空')
          : `【只读】${value.path} 第 ${value.offset}–${value.offset + value.limit - 1} 行 / 共 ${value.totalLines} 行`
            + (value.hasMore ? `；还有后续，nextOffset=${value.nextOffset}` : '；已到文末')
            + `\n${value.content}`,
      }],
    },
    execute(args) {
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      if (path.length === 0) {
        return { action: 'list', documents: listRoots(roots), ...emptyRead }
      }
      const page = readFromRoots(roots, path, args.offset, args.limit)
      return { action: 'read', documents: [], ...page }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.path ? `阅读 ${args.path}` : '列出可读文件',
      kind: 'read',
      rawInput: args,
    }),
  }))
}
