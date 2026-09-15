/**
 * 章节渲染：模型只交结构化 blocks，HTML 由本模块生成，模型无法注入 HTML。
 *
 * 模版为 templates/<version>/<code>.html，含 {{body}} 与 {{sources}} 两个占位符。
 * 参照自 ontology-ai-runtime 的 plan_doc_generation/rendering.py，仅保留必要部分。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')

/** 资源状态的合法取值（09 章的「状态」列）。 */
const RESOURCE_STATUSES = new Set(['正常', '校准中', '维修中', '不可用', '待确认'])

/** HTML 转义；空值显示 —。 */
export function esc(value) {
  const s = value == null || String(value).trim() === '' ? '—' : String(value)
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '<br>')
}

/** 渲染一张表格；超 50 行分表保留全部行，不裁剪。 */
function renderTable(columns, rows) {
  if (columns.length === 0 || columns.length > 20) {
    throw new Error('表格列数须为 1～20')
  }
  const fragments = []
  for (let start = 0; start < rows.length; start += 50) {
    const chunk = rows.slice(start, start + 50)
    // 行列数必须与 columns 一致，否则渲染出的是错表。
    for (const row of chunk) {
      if (row.length !== columns.length) {
        throw new Error('表格每行列数必须等于列头数')
      }
    }
    const head = columns.map((c) => `<th>${esc(c)}</th>`).join('')
    const body = chunk.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    fragments.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
  }
  return fragments.join('')
}

/**
 * 把结构化 blocks 渲染为 HTML 正文。
 *
 * 支持的 kind：paragraph / heading / list / table。带 recommendation 的块前置「建议（待确认）」。
 * @param blocks - 模型给出的正文块数组。
 * @param chapterNo - 章节编号，用于 09 章的状态约束。
 * @returns 渲染后的 HTML。
 */
export function renderBlocks(blocks, chapterNo) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('正文块不能为空')
  }
  const parts = []
  for (const block of blocks) {
    const prefix = block.recommendation ? '<p><strong>建议（待确认）</strong></p>' : ''
    const kind = block.kind
    let body
    if (kind === 'table') {
      const cols = block.columns ?? []
      let rows = block.rows ?? []
      // 09 章的「状态」列只接受固定取值，非法值收敛为待确认并标记为建议。
      if (chapterNo === '09') {
        const index = cols.findIndex((c) => String(c).includes('状态'))
        if (index >= 0) {
          rows = rows.map((row) => {
            const next = [...row]
            const status = String(next[index] ?? '').trim()
            if (!RESOURCE_STATUSES.has(status)) {
              next[index] = '待确认'
            }
            return next
          })
        }
      }
      body = renderTable(cols, rows)
      if (block.text) {
        body = `<h3>${esc(block.text)}</h3>${body}`
      }
    } else if (kind === 'list') {
      const items = block.items ?? []
      if (items.length === 0) {
        throw new Error('列表块缺少 items')
      }
      body = (block.text ? `<p>${esc(block.text)}</p>` : '') + `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    } else if (kind === 'paragraph' || kind === 'heading') {
      if (!block.text || !String(block.text).trim()) {
        throw new Error(`${kind} 块缺少 text`)
      }
      const tag = kind === 'heading' ? 'h3' : 'p'
      body = `<${tag}>${esc(block.text)}</${tag}>`
    } else {
      throw new Error(`未知正文块类型: ${kind}`)
    }
    parts.push(prefix + body)
  }
  return parts.join('')
}

/**
 * 读取并填充章节模版。
 * @param chapterNo - 章节编号或 'cover'。
 * @param body - 已渲染的正文 HTML。
 * @param version - 模版版本目录名，默认 dynamic-v1。
 * @returns 填充后的完整章节 HTML。
 */
export function fillTemplate(chapterNo, body, version = 'dynamic-v1') {
  const code = chapterNo === '05' ? '05' : chapterNo
  const path = join(TEMPLATE_ROOT, version, `${code}.html`)
  let template
  try {
    template = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`读取章节模版失败: ${path}`, { cause: error })
  }
  if (!template.includes('{{body}}')) {
    throw new Error(`模版缺少 {{body}} 占位符: ${code}.html`)
  }
  // sources 留空：本插件不做逐块来源标注，占位符必须被替换以保证 HTML 完整。
  return template.replace('{{body}}', body).replace('{{sources}}', '')
}

/**
 * 渲染封面：只取基础字段，未知日期不补造。
 * @param basic - 方案 basicInfo。
 * @returns 封面 HTML。
 */
export function renderCover(basic) {
  const rows = [
    ['密级', basic.classification ?? basic.securityLevel ?? '内部'],
    ['方案编号', basic.planNo],
    ['产品型号', basic.productModelName],
    ['系统名称', basic.targetName],
  ]
  // 方案名称作为封面标题，其余字段进表格。
  const body = `<h2>${esc(basic.planName)}</h2>${renderTable(['项目', '内容'], rows)}`
  return fillTemplate('cover', body)
}

/**
 * 渲染第 05 章：只列功能点目录与数量，不含明细。
 * @param points - 功能点名称数组。
 * @returns 第 05 章 HTML。
 */
export function renderCatalogue(points) {
  const body = `<p>共 ${points.length} 个功能点。</p><ol>${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`
  return fillTemplate('05', body)
}
