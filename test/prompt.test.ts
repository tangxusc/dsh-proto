/**
 * 提示词段单测：串联工具、模版为准、不规定各章写什么。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'

import { apply } from '../src/index.ts'
import { CHAPTERS } from '../src/chapters.ts'
import { buildPrompt, registerPrompt } from '../src/prompt.ts'

interface PromptSection {
  name: string
  order: number
  text: string
}

/** 捕获注册的提示词段。 */
function captureSection(): PromptSection[] {
  const sections: PromptSection[] = []
  const ctx = {
    tools: { register: () => {} },
    systemPrompt: { section: (s: PromptSection) => { sections.push(s) } },
  }
  apply(ctx as unknown as Context, { tenantId: 1, url: 'http://x', timeoutMs: 1000, outDir: 'dsh-output-test', docDir: '', dataDir: 'dsh-plan-data', stateDir: 'dsh-plan-state' })
  return sections
}

test('apply 注册恰好一个提示词段', () => {
  const sections = captureSection()
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'tool:test-plan-doc')
})

test('提示词段的 order 是有限数（外部插件不能用预定义键）', () => {
  const [s] = captureSection()
  assert.ok(Number.isFinite(s.order), `order 必须是有限数，实得 ${s.order}`)
  assert.equal(typeof s.text, 'string')
  assert.ok(s.text.length > 0)
})

test('提示词串联两个工具：先取数、再逐章、最后落盘', () => {
  const text = buildPrompt(CHAPTERS)
  assert.ok(text.indexOf('get_test_plan_info') < text.indexOf('write_chapter'), '应先取数再写章')
  assert.match(text, /逐章/)
  assert.match(text, /documentPath/)
  assert.match(text, /12 章/)
})

test('提示词交代只读资料目录，不把正文写进提示词', () => {
  const text = buildPrompt(CHAPTERS, [{ path: '业务术语解释.md', title: '术语', lines: 112, bytes: 1, kind: 'static' }])
  assert.match(text, /read_static_doc/)
  assert.match(text, /业务术语解释\.md/)
  assert.match(text, /只读/)
  assert.doesNotMatch(text, /功能\/性能边界/)
})

test('提示词交代取数落盘后分页读，不把全文塞进工具结果', () => {
  const text = buildPrompt(CHAPTERS)
  assert.match(text, /完整 JSON 写入固定目录/)
  assert.match(text, /\.json 是方案数据/)
})

test('提示词以当前模版为准，不规定章节内容', () => {
  const text = buildPrompt(CHAPTERS, [{ path: '01.html', title: '01 范围', lines: 3, bytes: 1, kind: 'template' }])
  assert.match(text, /01\.html/)
  assert.match(text, /以你当前读到的为准/)
  assert.match(text, /不规定/)
  assert.doesNotMatch(text, /paragraph/)
  assert.doesNotMatch(text, /recommendation/)
  assert.doesNotMatch(text, /待确认/)
  assert.doesNotMatch(text, /\{\{body\}\}/)
})

test('apply 注册的提示词含章节模版目录', () => {
  const [s] = captureSection()
  assert.match(s.text, /cover\.html/)
  assert.match(s.text, /01\.html/)
  assert.match(s.text, /template/)
})

test('提示词含全部章节编号（与目录一致）', () => {
  const text = buildPrompt(CHAPTERS)
  for (const c of CHAPTERS) {
    assert.ok(text.includes(c.no), `缺少章节 ${c.no}`)
  }
})

test('registerPrompt 用假 ctx 不抛错', () => {
  let captured: PromptSection | undefined
  registerPrompt({ systemPrompt: { section: (s: PromptSection) => { captured = s } } }, CHAPTERS)
  assert.equal(captured?.name, 'tool:test-plan-doc')
})
