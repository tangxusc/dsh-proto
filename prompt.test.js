/**
 * 提示词段单测：验证注册参数合法、内容含串联两个工具的关键指令。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from './index.js'
import { CHAPTERS } from './src/chapters.js'
import { buildPrompt, registerPrompt } from './src/prompt.js'

/** 捕获注册的提示词段。 */
function captureSection() {
  const sections = []
  const ctx = {
    tools: { register: () => {} },
    systemPrompt: { section: (s) => { sections.push(s) } },
  }
  apply(ctx, { tenantId: 1, url: 'http://x', timeoutMs: 1000, outDir: 'dsh-output-test' })
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
  // 顺序：get_test_plan_info 出现在 write_chapter 之前
  assert.ok(text.indexOf('get_test_plan_info') < text.indexOf('write_chapter'), '应先取数再写章')
  assert.match(text, /逐章/)
  assert.match(text, /documentPath/)
  assert.match(text, /12 章/)
})

test('提示词交代 blocks 结构、封面/05 特殊性与 09 章状态约束', () => {
  const text = buildPrompt(CHAPTERS)
  assert.match(text, /paragraph/)
  assert.match(text, /table/)
  assert.match(text, /不要写 HTML/)
  assert.match(text, /封面/)
  assert.match(text, /05 章由程序渲染/)
  assert.match(text, /待确认/)
  assert.match(text, /recommendation/)
})

test('提示词含全部章节编号（与目录一致）', () => {
  const text = buildPrompt(CHAPTERS)
  for (const c of CHAPTERS) {
    if (c.no === '05') continue
    assert.ok(text.includes(c.no), `缺少章节 ${c.no}`)
  }
})

test('registerPrompt 用假 ctx 不抛错', () => {
  let captured
  registerPrompt({ systemPrompt: { section: (s) => { captured = s } } }, CHAPTERS)
  assert.equal(captured.name, 'tool:test-plan-doc')
})
