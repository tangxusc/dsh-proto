/**
 * 章节顺序与 write_chapter：内容原样落盘；进度按 session 隔离并落盘。
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
    tenantId: 1,
    url: 'http://x',
    timeoutMs: 1000,
    outDir: OUT,
    docDir: '',
    dataDir: join(OUT, 'plan-data'),
    stateDir: STATE,
    ...config,
  })
  return map
}

/** 假 fetch，返回一份含功能点的方案数据。 */
function planPayload(points: string[] = ['通电检查', '绝缘测试']) {
  return {
    code: 0,
    data: {
      basicInfo: { id: 'p1', planName: '航电试验方案', planNo: 'SY-001', productModelName: 'X1', targetName: '航电系统' },
      functionInfo: { functionPoints: points.map((n) => ({ pointName: n, adoptionStatus: 'adopted' })) },
    },
  }
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
  const t = tools()
  const ctx = exec()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload(['点A', '点B']) }) as Response
  await t.get('get_test_plan_info')!.execute({ planId: 'p1' }, ctx)

  const write = t.get('write_chapter')
  assert.ok(write, '未注册 write_chapter')

  let last: { done: boolean; next: string; missing: string[]; documentPath: string } | undefined
  for (const no of DOCUMENT_ORDER) {
    last = await write.execute({
      chapterNo: no,
      content: `<h1>${no}</h1><p>${no} 的内容</p>`,
    }, ctx) as typeof last
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
  const t = tools()
  const ctx = exec()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  await t.get('get_test_plan_info')!.execute({ planId: 'p-raw' }, ctx)
  const raw = '<h1>封面</h1><table><tr><td>可用</td></tr></table>'
  await t.get('write_chapter')!.execute({ chapterNo: 'cover', content: raw }, ctx)
  const write = t.get('write_chapter')!
  for (const no of DOCUMENT_ORDER.slice(1)) {
    await write.execute({ chapterNo: no, content: `<section>${no}</section>` }, ctx)
  }
  const doc = readFileSync(join(OUT, 'p-raw.html'), 'utf8')
  assert.ok(doc.includes(raw), '封面 content 应原样出现在落盘文档中')
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 未写完时返回 missing 且不落盘', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const t = tools()
  const ctx = exec()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  await t.get('get_test_plan_info')!.execute({ planId: 'p2' }, ctx)

  const r = await t.get('write_chapter')!.execute({ chapterNo: 'cover', content: '<p>x</p>' }, ctx) as {
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

test('write_chapter 未取数或乱序时拒绝', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const t = tools()
  const write = t.get('write_chapter')!
  const ctx = exec()
  await assert.rejects(
    () => write.execute({ chapterNo: 'cover', content: '<p>x</p>' }, {} as ToolRunContext),
    /缺少会话/,
  )
  await assert.rejects(
    () => write.execute({ chapterNo: 'cover', content: '<p>x</p>' }, ctx),
    /get_test_plan_info/,
  )

  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  await t.get('get_test_plan_info')!.execute({ planId: 'p-order' }, ctx)

  await assert.rejects(
    () => write.execute({ chapterNo: '01', content: '<p>x</p>' }, ctx),
    /下一章应为 cover/,
  )
  await write.execute({ chapterNo: 'cover', content: '<p>封面</p>' }, ctx)
  await assert.rejects(
    () => write.execute({ chapterNo: '02', content: '<p>x</p>' }, ctx),
    /下一章应为 01/,
  )
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 拒绝空 content', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const t = tools()
  const ctx = exec()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  await t.get('get_test_plan_info')!.execute({ planId: 'p-empty' }, ctx)
  await assert.rejects(
    () => t.get('write_chapter')!.execute({ chapterNo: 'cover', content: '   ' }, ctx),
    /不能为空/,
  )
  rmSync(OUT, { recursive: true, force: true })
})

test('write_chapter 拒绝未知章节（schema enum 先拦）', async () => {
  const t = tools()
  await assert.rejects(
    () => t.get('write_chapter')!.execute({ chapterNo: '99', content: '<p>x</p>' }, exec()),
    /must be one of/,
  )
})

test('重新取数会清空已写章节', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const t = tools()
  const ctx = exec()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  const info = t.get('get_test_plan_info')!
  const write = t.get('write_chapter')!
  await info.execute({ planId: 'p3' }, ctx)
  await write.execute({ chapterNo: 'cover', content: '<p>x</p>' }, ctx)
  await info.execute({ planId: 'p3' }, ctx)
  await assert.rejects(
    () => write.execute({ chapterNo: '01', content: '<p>y</p>' }, ctx),
    /下一章应为 cover/,
    '重新取数后必须从封面重新按序写',
  )
  rmSync(OUT, { recursive: true, force: true })
})

test('不同 session 的写章进度互不影响', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const t = tools()
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  const a = exec('sess-a')
  const b = exec('sess-b')
  await t.get('get_test_plan_info')!.execute({ planId: 'p1' }, a)
  await t.get('get_test_plan_info')!.execute({ planId: 'p1' }, b)
  await t.get('write_chapter')!.execute({ chapterNo: 'cover', content: '<p>A封面</p>' }, a)
  const rb = await t.get('write_chapter')!.execute({ chapterNo: 'cover', content: '<p>B封面</p>' }, b) as { next: string }
  assert.equal(rb.next, '01')
  const ra = await t.get('write_chapter')!.execute({ chapterNo: '01', content: '<p>A01</p>' }, a) as { next: string }
  assert.equal(ra.next, '02')
  const againB = await t.get('write_chapter')!.execute({ chapterNo: '01', content: '<p>B01</p>' }, b) as { next: string }
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
  globalThis.fetch = async () => ({ status: 200, json: async () => planPayload() }) as Response
  const first = tools()
  await first.get('get_test_plan_info')!.execute({ planId: 'p1' }, ctx)
  await first.get('write_chapter')!.execute({ chapterNo: 'cover', content: '<p>续封面</p>' }, ctx)
  assert.ok(existsSync(join(STATE, stateFileName('sess-resume'))))

  const second = tools()
  const r = await second.get('write_chapter')!.execute({ chapterNo: '01', content: '<p>续01</p>' }, ctx) as { next: string }
  assert.equal(r.next, '02')
  const saved = loadState(STATE, 'sess-resume')
  assert.match(saved.chapters.cover, /续封面/)
  assert.match(saved.chapters['01'], /续01/)
  rmSync(OUT, { recursive: true, force: true })
})
