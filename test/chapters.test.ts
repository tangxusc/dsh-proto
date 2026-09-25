/**
 * 章节顺序与 write_chapter：内容原样落盘；进度按 session 隔离并落盘。
 *
 * write_chapter 现在带显式 planId（取自 MCP 资源 URI），因此本测试不再涉及任何取数。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { apply, type Config } from '../src/index.ts'
import { DOCUMENT_ORDER, CHAPTERS, findChapter, nextChapter } from '../src/chapters.ts'
import { loadState, stateFileName } from '../src/session-state.ts'

const OUT = 'dsh-output-test'
const STATE = join(OUT, 'plan-state')
const PLAN = 'p1'

function asCtx(value: object): Context {
  return value as Context
}

/** 模拟 harness 填入的 exec.agent.id。 */
function exec(id = 'sess-a'): ToolRunContext {
  return { agent: { id } } as ToolRunContext
}

/** 取所有已注册工具。 */
function tools(config: Partial<Config> = {}): Map<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>()
  const ctx = {
    tools: { register: (t: ToolDefinition) => map.set(t.name, t) },
    systemPrompt: { section: () => {} },
  }
  apply(asCtx(ctx), {
    outDir: OUT,
    docDir: '',
    stateDir: STATE,
    ...config,
  })
  return map
}

/** 取 write_chapter。 */
function writer(config: Partial<Config> = {}): ToolDefinition {
  const tool = tools(config).get('write_chapter')
  assert.ok(tool, '未注册 write_chapter')
  return tool
}

/** 写一章的简写。 */
function write(tool: ToolDefinition, ctx: ToolRunContext, chapterNo: string, extra: Record<string, unknown> = {}) {
  return tool.execute({ planId: PLAN, chapterNo, content: `<h1>${chapterNo}</h1><p>${chapterNo} 的内容</p>`, ...extra }, ctx)
}

test('章节目录含 12 章（封面+01–11），公文顺序固定', () => {
  assert.equal(CHAPTERS.length, 12)
  assert.deepEqual(DOCUMENT_ORDER, ['cover', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'])
  assert.equal(findChapter('cover')?.name, '封面')
  assert.equal(findChapter('01')?.name, '范围')
  assert.equal(findChapter('05')?.name, '试验项目')
  assert.equal(findChapter('99'), undefined)
  assert.equal(nextChapter({}), 'cover')
  assert.equal(nextChapter({ cover: true }), '01')
  assert.equal(nextChapter({ cover: true, '01': true }), '02')
  assert.equal(nextChapter(Object.fromEntries(DOCUMENT_ORDER.map((no) => [no, true]))), undefined)
  for (const c of CHAPTERS) {
    assert.equal((c as { instructions?: unknown }).instructions, undefined)
  }
})

test('write_chapter 按公文顺序逐章写入，content 原样落盘', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const ctx = exec()

  let last: { done: boolean; next: string; missing: string[]; documentPath: string } | undefined
  for (const no of DOCUMENT_ORDER) {
    last = await write(tool, ctx, no) as typeof last
  }

  assert.equal(last!.done, true)
  assert.equal(last!.next, '')
  assert.deepEqual(last!.missing, [])
  assert.ok(last!.documentPath.endsWith('p1.html'), `路径异常: ${last!.documentPath}`)
  assert.ok(existsSync(last!.documentPath), '文档未落盘')

  const doc = readFileSync(last!.documentPath, 'utf8')
  assert.match(doc, /<h1>cover<\/h1>/)
  assert.match(doc, /cover 的内容/)
  assert.match(doc, /<h1>05<\/h1>/)
  assert.match(doc, /05 的内容/)
  assert.match(doc, /<h1>11<\/h1>/)
  assert.ok(doc.indexOf('cover 的内容') < doc.indexOf('01 的内容'))
  assert.ok(doc.indexOf('04 的内容') < doc.indexOf('05 的内容'))
  assert.ok(doc.indexOf('05 的内容') < doc.indexOf('06 的内容'))
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 不改写 content（含模版态 HTML）', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const ctx = exec()
  const raw = '<h1>封面</h1><table><tr><td>可用</td></tr></table>'
  await tool.execute({ planId: 'p-raw', chapterNo: 'cover', content: raw }, ctx)
  for (const no of DOCUMENT_ORDER.slice(1)) {
    await tool.execute({ planId: 'p-raw', chapterNo: no, content: `<section>${no}</section>` }, ctx)
  }
  const doc = readFileSync(join(OUT, 'p-raw.html'), 'utf8')
  assert.ok(doc.includes(raw), '封面 content 应原样出现在落盘文档中')
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 未写完时返回 missing 且不落盘', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const r = await write(writer(), exec(), 'cover') as {
    done: boolean
    next: string
    documentPath: string
    missing: string[]
  }
  assert.equal(r.done, false)
  assert.equal(r.next, '01')
  assert.equal(r.documentPath, '')
  assert.ok(r.missing.includes('01'))
  assert.ok(r.missing.includes('11'))
  assert.ok(!r.missing.includes('cover'))
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 缺 planId / 乱序 / 空 content 时拒绝', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const ctx = exec()

  await assert.rejects(
    () => tool.execute({ planId: PLAN, chapterNo: 'cover', content: '<p>x</p>' }, {} as ToolRunContext),
    /缺少会话/,
  )
  await assert.rejects(
    () => tool.execute({ planId: '  ', chapterNo: 'cover', content: '<p>x</p>' }, ctx),
    /planId 不能为空/,
  )
  await assert.rejects(
    () => tool.execute({ planId: PLAN, chapterNo: '01', content: '<p>x</p>' }, ctx),
    /下一章应为 cover/,
  )
  await write(tool, ctx, 'cover')
  await assert.rejects(
    () => tool.execute({ planId: PLAN, chapterNo: '02', content: '<p>x</p>' }, ctx),
    /下一章应为 01/,
  )
  await assert.rejects(
    () => tool.execute({ planId: PLAN, chapterNo: '01', content: '   ' }, ctx),
    /不能为空/,
  )
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 拒绝未知章节（schema enum 先拦）', async () => {
  await assert.rejects(
    () => write(writer(), exec(), '99'),
    /must be one of/,
  )
})

test('换 planId 会清空已写章节（新方案 = 新文档）', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const ctx = exec()
  await write(tool, ctx, 'cover')
  await write(tool, ctx, '01')

  // 换 planId 后必须从封面重新按序写。
  await assert.rejects(
    () => tool.execute({ planId: 'p-other', chapterNo: '02', content: '<p>x</p>' }, ctx),
    /下一章应为 cover/,
  )
  const r = await tool.execute({ planId: 'p-other', chapterNo: 'cover', content: '<p>新封面</p>' }, ctx) as { next: string }
  assert.equal(r.next, '01')
  const saved = loadState(STATE, 'sess-a')
  assert.equal(saved.planId, 'p-other')
  assert.deepEqual(Object.keys(saved.chapters), ['cover'])
  rmSync(OUT, { recursive: true, force: true })
})

test('写 cover 会清空已写章节（显式重新生成）', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const ctx = exec()
  for (const no of DOCUMENT_ORDER.slice(0, 4)) {
    await write(tool, ctx, no)
  }
  const before = loadState(STATE, 'sess-a')
  assert.equal(Object.keys(before.chapters).length, 4)

  const r = await write(tool, ctx, 'cover') as { next: string; missing: string[] }
  assert.equal(r.next, '01')
  assert.equal(r.missing.length, 11)
  const after = loadState(STATE, 'sess-a')
  assert.deepEqual(Object.keys(after.chapters), ['cover'])
  rmSync(OUT, { recursive: true, force: true })
})

test('文档标题用 planName（封面传入）', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const ctx = exec()
  await tool.execute({ planId: 'p-title', chapterNo: 'cover', content: '<p>x</p>', planName: '发电机通电检查试验方案' }, ctx)
  for (const no of DOCUMENT_ORDER.slice(1)) {
    await tool.execute({ planId: 'p-title', chapterNo: no, content: `<p>${no}</p>` }, ctx)
  }
  const doc = readFileSync(join(OUT, 'p-title.html'), 'utf8')
  assert.match(doc, /<title>发电机通电检查试验方案 试验方案<\/title>/)
  rmSync(OUT, { recursive: true, force: true })
})

test('不同 session 的写章进度互不影响', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const tool = writer()
  const a = exec('sess-a')
  const b = exec('sess-b')
  await tool.execute({ planId: PLAN, chapterNo: 'cover', content: '<p>A封面</p>' }, a)
  const rb = await tool.execute({ planId: PLAN, chapterNo: 'cover', content: '<p>B封面</p>' }, b) as { next: string }
  assert.equal(rb.next, '01')
  const ra = await tool.execute({ planId: PLAN, chapterNo: '01', content: '<p>A01</p>' }, a) as { next: string }
  assert.equal(ra.next, '02')
  const againB = await tool.execute({ planId: PLAN, chapterNo: '01', content: '<p>B01</p>' }, b) as { next: string }
  assert.equal(againB.next, '02')
  const savedA = loadState(STATE, 'sess-a')
  const savedB = loadState(STATE, 'sess-b')
  assert.match(savedA.chapters.cover, /A封面/)
  assert.match(savedB.chapters.cover, /B封面/)
  assert.ok(!savedA.chapters.cover.includes('B封面'))
  rmSync(OUT, { recursive: true, force: true })
})

test('进度 sidecar 在重新 apply 后仍可续写', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const ctx = exec('sess-resume')
  const first = writer()
  await first.execute({ planId: PLAN, chapterNo: 'cover', content: '<p>续封面</p>' }, ctx)
  assert.ok(existsSync(join(STATE, stateFileName('sess-resume'))))

  const second = writer()
  const r = await second.execute({ planId: PLAN, chapterNo: '01', content: '<p>续01</p>' }, ctx) as { next: string }
  assert.equal(r.next, '02')
  const saved = loadState(STATE, 'sess-resume')
  assert.match(saved.chapters.cover, /续封面/)
  assert.match(saved.chapters['01'], /续01/)
  rmSync(OUT, { recursive: true, force: true })
})
