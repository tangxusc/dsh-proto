/**
 * 试验方案 preset：文件齐全、不挂 coding 工具、不压掉插件提示词。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = dirname(fileURLToPath(import.meta.url))
const presetDir = join(root, 'presets', 'test-plan')

/** 读仓库内文本文件。 */
function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

test('test-plan 预设含元数据与组合文件', () => {
  const meta = read('presets/test-plan/preset.yml')
  assert.match(meta, /^name:\s*试验方案/m)
  assert.match(meta, /只读静态资料|取数/)

  const composition = read('presets/test-plan/agent.cordis.yml')
  assert.match(composition, /id:\s*persona/)
  assert.match(composition, /@deepseek-ai\/dsh-persona/)
})

test('persona 不设 complete，以免压掉 tool:test-plan-doc', () => {
  const composition = read('presets/test-plan/agent.cordis.yml')
  // 只拦配置键，避免误伤注释里的「不要设 complete: true」。
  assert.doesNotMatch(composition, /^\s+complete:\s*true/m)
  assert.match(composition, /get_test_plan_info/)
  assert.match(composition, /write_chapter/)
  assert.match(composition, /read_static_doc/)
})

test('预设不重新挂载 coding / 检索 / 委派工具', () => {
  const composition = read('presets/test-plan/agent.cordis.yml')
  const forbidden = [
    'dsh-tool-bash',
    'dsh-tool-pwsh',
    'dsh-tool-fs',
    'dsh-tool-fs-search',
    'dsh-tool-web',
    'dsh-tool-subagent',
    'dsh-tool-workflow',
    'dsh-tool-jobs',
    'dsh-tool-skill',
    'dsh-tool-todo',
    'dsh-tool-goal',
    'dsh-plan-mode',
    'dsh-tool-ask-user',
    'dsh-tool-present',
    'dsh-tool-ralph',
  ]
  for (const name of forbidden) {
    assert.doesNotMatch(composition, new RegExp(name), `不应挂载 ${name}`)
  }
})

test('组合包把 agent-presets 默认改成 test-plan，并扫描本包 presets/', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /id:\s*agent-presets/)
  assert.match(patch, /default:\s*test-plan/)
  assert.match(patch, /dsh-test-plan-tool\/presets/)
  assert.match(patch, /trust:\s*system/)
  assert.ok(presetDir.endsWith('presets/test-plan'))
})
