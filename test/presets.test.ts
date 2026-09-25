/**
 * 试验方案 preset：声明文件齐全、不挂 coding 工具、不压掉插件提示词，且接线走 0.1.7 的新机制。
 *
 * 0.1.7 起 preset 由 `@deepseek-ai/dsh-agent-preset` 行声明，作为独立 patch 文件列在
 * package.json 的 dsh.bundle.patch 数组里；注册表不再扫描目录。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 读仓库内文本文件。 */
function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

/** 去掉 YAML 注释行：注释里的历史说明不应干扰配置断言。 */
function stripComments(text: string): string {
  return text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
}

/** preset 声明 patch 文件。 */
const PRESET_PATCH = 'presets/test-plan.patch.yml'

test('preset 声明为 @deepseek-ai/dsh-agent-preset 行，含 id / 展示信息 / plugins', () => {
  const patch = read(PRESET_PATCH)
  assert.match(patch, /name:\s*'@deepseek-ai\/dsh-agent-preset'/)
  // config.id 是会话保存的标识符，必须与 cordis.patch.yml 的 default 一致。
  assert.match(patch, /^\s+id:\s*test-plan$/m)
  assert.match(patch, /^\s+name:\s*试验方案$/m)
  assert.match(patch, /^\s+plugins:\s*$/m)
  assert.match(patch, /@deepseek-ai\/dsh-persona/)
})

test('persona 不设 complete，以免压掉 tool:test-plan-doc', () => {
  const patch = read(PRESET_PATCH)
  // 只拦配置键，避免误伤注释里的「不要给 persona 设 complete: true」。
  assert.doesNotMatch(patch, /^\s+complete:\s*true/m)
  // 方案数据走 MCP 资源，不再有原生取数工具。
  assert.match(patch, /read_mcp_resource/)
  assert.match(patch, /plan:\/\/plans/)
  assert.match(patch, /write_chapter/)
  assert.match(patch, /read_static_doc/)
  assert.doesNotMatch(patch, /get_test_plan_info/)
})

test('预设不重新挂载 coding / 检索 / 委派工具', () => {
  const patch = read(PRESET_PATCH)
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
    assert.doesNotMatch(patch, new RegExp(name), `不应挂载 ${name}`)
  }
})

test('预设挂 tool-filter，按 server 白名单只放行部分工具', () => {
  const patch = stripComments(read(PRESET_PATCH))
  assert.match(patch, /base-plugin\/tool-filter/)
  assert.match(patch, /server:\s*test-plan/)
  assert.match(patch, /allow:\s*\[server_health\]/)
})

test('组合包插入 dsh-mcp-client 行，地址可配置且不阻断启动', () => {
  const patch = stripComments(read('cordis.patch.yml'))
  assert.match(patch, /'@deepseek-ai\/dsh-mcp-client'/)
  assert.match(patch, /transport:\s*'streamable-http'/)
  assert.match(patch, /serverName:\s*'test-plan'/)
  assert.match(patch, /MCP_SERVER_URL/)
  assert.match(patch, /failOnStartupError:\s*false/)
})

test('取数相关的配置键已随功能删除', () => {
  const patch = stripComments(read('cordis.patch.yml'))
  for (const gone of ['tenantId', 'timeoutMs', 'dataDir']) {
    assert.doesNotMatch(patch, new RegExp(`^\\s+${gone}:`, 'm'), `不应再有 ${gone}`)
  }
  // test-plan-tool 行只剩输出与进度相关配置。
  assert.match(patch, /id:\s*test-plan-tool/)
  assert.match(patch, /outDir:\s*'dsh-output'/)
  assert.match(patch, /stateDir:\s*'dsh-plan-state'/)
})

test('组合包把 agent-preset-registry 默认改成 test-plan', () => {
  const patch = stripComments(read('cordis.patch.yml'))
  assert.match(patch, /id:\s*agent-preset-registry/)
  assert.match(patch, /default:\s*test-plan/)
  // 旧的目录扫描机制（agent-presets + roots）必须彻底移除，否则 0.1.7 上会 patch 落空。
  assert.doesNotMatch(patch, /id:\s*agent-presets\b/)
  assert.doesNotMatch(patch, /includeShippedRoot|includeUserRoot/)
})

test('bundle patch 是数组，且同时列出主 patch 与预设声明', () => {
  const pkg = JSON.parse(read('package.json')) as {
    dsh?: { bundle?: { patch?: unknown } }
    files?: string[]
  }
  const patch = pkg.dsh?.bundle?.patch
  assert.ok(Array.isArray(patch), 'dsh.bundle.patch 应为数组（0.1.7 起支持多 patch 文件）')
  assert.deepEqual(patch, ['./cordis.patch.yml', './presets/test-plan.patch.yml'])
  assert.ok(pkg.files?.includes('presets/'), 'files 需包含 presets/ 以便随包发布')
})

test('TUI profile 走 0.1.7 的注册表行 id', () => {
  const patch = stripComments(read('docker/profile-tui/cordis.patch.yml'))
  assert.match(patch, /id:\s*dsh-tui-agent-preset-registry/)
  assert.match(patch, /default:\s*test-plan/)
  assert.doesNotMatch(patch, /id:\s*dsh-tui-agent-presets\b/)
})
