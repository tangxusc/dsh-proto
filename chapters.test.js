/**
 * 章节生成单测：渲染、模版填充、write_chapter 工具行为与落盘。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { apply } from './index.js'
import { GENERATED_NOS, CHAPTERS, findChapter } from './src/chapters.js'
import { renderBlocks, fillTemplate, renderCover, renderCatalogue, esc } from './src/render.js'

const OUT = 'dsh-output-test'

/** 取所有已注册工具。 */
function tools(config = {}) {
  const map = new Map()
  const ctx = {
    tools: { register: (t) => map.set(t.name, t) },
    systemPrompt: { section: () => {} },
  }
  apply(ctx, { tenantId: 1, url: 'http://x', timeoutMs: 1000, outDir: OUT, ...config })
  return map
}

/** 假 fetch，返回一份含功能点的方案数据。 */
function planPayload(points = ['通电检查', '绝缘测试']) {
  return {
    code: 0,
    data: {
      basicInfo: { id: 'p1', planName: '航电试验方案', planNo: 'SY-001', productModelName: 'X1', targetName: '航电系统' },
      functionInfo: { functionPoints: points.map((n) => ({ pointName: n, adoptionStatus: 'adopted' })) },
    },
  }
}

test('章节目录含 11 章，05 之外 10 章需模型生成', () => {
  assert.equal(CHAPTERS.length, 11)
  assert.equal(GENERATED_NOS.length, 10)
  assert.ok(!GENERATED_NOS.includes('05'), '05 章由程序渲染')
  assert.equal(findChapter('01').name, '范围')
  assert.equal(findChapter('99'), undefined)
})

test('esc 转义 HTML 且空值显示 —', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;')
  assert.equal(esc(''), '—')
  assert.equal(esc(null), '—')
  assert.equal(esc('a\nb'), 'a<br>b')
})

test('renderBlocks 渲染段落/小标题/列表/表格', () => {
  const html = renderBlocks([
    { kind: 'heading', text: '小标题' },
    { kind: 'paragraph', text: '一段话' },
    { kind: 'list', text: '', items: ['甲', '乙'] },
    { kind: 'table', text: '表标题', columns: ['列1', '列2'], rows: [['a', 'b']] },
  ], '01')
  assert.match(html, /<h3>小标题<\/h3>/)
  assert.match(html, /<p>一段话<\/p>/)
  assert.match(html, /<ul><li>甲<\/li><li>乙<\/li><\/ul>/)
  assert.match(html, /<table><thead><tr><th>列1<\/th><th>列2<\/th><\/tr><\/thead>/)
  assert.match(html, /<h3>表标题<\/h3>/)
})

test('renderBlocks 拒绝空块、空列表、行列不齐、未知类型', () => {
  assert.throws(() => renderBlocks([], '01'), /不能为空/)
  assert.throws(() => renderBlocks([{ kind: 'list', items: [] }], '01'), /缺少 items/)
  assert.throws(() => renderBlocks([{ kind: 'paragraph', text: '  ' }], '01'), /缺少 text/)
  assert.throws(
    () => renderBlocks([{ kind: 'table', columns: ['a', 'b'], rows: [['x']] }], '01'),
    /列数必须等于/,
  )
  assert.throws(() => renderBlocks([{ kind: 'video', text: 'x' }], '01'), /未知正文块类型/)
})

test('renderBlocks 的 recommendation 前置「建议（待确认）」', () => {
  const html = renderBlocks([{ kind: 'paragraph', text: '待定', recommendation: true }], '01')
  assert.match(html, /建议（待确认）/)
})

test('09 章状态列的非法值收敛为待确认', () => {
  const html = renderBlocks([
    { kind: 'table', columns: ['设备', '状态'], rows: [['示波器', '好的'], ['电源', '正常']] },
  ], '09')
  assert.match(html, /<td>待确认<\/td>/)
  assert.match(html, /<td>正常<\/td>/)
  assert.ok(!html.includes('好的'), '非法状态不应出现')
})

test('fillTemplate 填充真实模版并清空 sources 占位符', () => {
  const html = fillTemplate('01', '<p>正文</p>')
  assert.match(html, /<h1>01 范围<\/h1>/)
  assert.match(html, /<div class="chapter-body"><p>正文<\/p><\/div>/)
  assert.ok(!html.includes('{{body}}') && !html.includes('{{sources}}'), '占位符必须全部替换')
})

test('fillTemplate 对未知章节报错', () => {
  assert.throws(() => fillTemplate('99', '<p>x</p>'), /读取章节模版失败/)
})

test('renderCover 与 renderCatalogue 用模版产出', () => {
  const cover = renderCover({ planName: '方案A', planNo: 'SY-1', productModelName: 'M', targetName: 'T' })
  assert.match(cover, /<h1>封面<\/h1>/)
  assert.match(cover, /方案A/)
  const cat = renderCatalogue(['点1', '点2'])
  assert.match(cat, /<h1>05 试验项目<\/h1>/)
  assert.match(cat, /共 2 个功能点/)
})

test('write_chapter 逐章写入并在全部完成后落盘', async () => {
  const t = tools()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload(['点A', '点B']) })
  const info = t.get('get_test_plan_info')
  await info.execute({ planId: 'p1' }, {})

  const write = t.get('write_chapter')
  assert.ok(write, '未注册 write_chapter')

  const order = ['cover', '05', ...GENERATED_NOS]
  let last
  for (const no of order) {
    last = await write.execute({
      chapterNo: no,
      blocks: [{ kind: 'paragraph', text: `${no} 的内容` }],
    }, {})
  }

  assert.equal(last.done, true)
  assert.deepEqual(last.missing, [])
  assert.ok(last.documentPath.endsWith('p1.html'), `路径异常: ${last.documentPath}`)
  assert.ok(existsSync(last.documentPath), '文档未落盘')

  const doc = readFileSync(last.documentPath, 'utf8')
  assert.match(doc, /<h1>封面<\/h1>/)
  assert.match(doc, /<h1>05 试验项目<\/h1>/)
  assert.match(doc, /共 2 个功能点/)
  assert.match(doc, /<h1>11 试验指标要求及试验方法<\/h1>/)
  // 05 章由程序渲染，模型给的 blocks 被忽略。
  assert.ok(!doc.includes('05 的内容'), '05 章不应采用模型 blocks')
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 未写完时返回 missing 且不落盘', async () => {
  const t = tools()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() })
  await t.get('get_test_plan_info').execute({ planId: 'p2' }, {})

  const r = await t.get('write_chapter').execute({ chapterNo: '01', blocks: [{ kind: 'paragraph', text: 'x' }] }, {})
  assert.equal(r.done, false)
  assert.equal(r.documentPath, '')
  assert.ok(r.missing.includes('cover'))
  assert.ok(r.missing.includes('11'))
  assert.ok(!r.missing.includes('01'))
})

test('write_chapter 拒绝未知章节（schema enum 先拦）', async () => {
  const t = tools()
  await assert.rejects(
    () => t.get('write_chapter').execute({ chapterNo: '99', blocks: [{ kind: 'paragraph', text: 'x' }] }, {}),
    /must be one of/,
  )
})

test('重新取数会清空已写章节', async () => {
  const t = tools()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() })
  const info = t.get('get_test_plan_info')
  const write = t.get('write_chapter')
  await info.execute({ planId: 'p3' }, {})
  await write.execute({ chapterNo: '01', blocks: [{ kind: 'paragraph', text: 'x' }] }, {})
  await info.execute({ planId: 'p3' }, {})
  const r = await write.execute({ chapterNo: '02', blocks: [{ kind: 'paragraph', text: 'y' }] }, {})
  assert.ok(r.missing.includes('01'), '重新取数后 01 章应回到未写状态')
})
