/**
 * 插件接线：注册的工具集合、每个工具一个文件、Config schema 默认值。
 *
 * 原生取数工具已删除 —— 方案数据改由独立 MCP server 以资源形式提供（见 test/mcp-server.test.ts）。
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { apply, Config, type Config as PluginConfig } from '../src/index.ts'
import { DOCUMENT_ORDER } from '../src/chapters.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 用假 ctx 捕获全部注册的工具，按名字取用。传入 config 覆盖默认值。 */
function captureAll(config: Partial<PluginConfig> = {}): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool) } },
    systemPrompt: { section: () => {} },
    // 未挂 redis-kv-store 基础插件：业务插件回退文件 sidecar。
    get: () => undefined,
  }
  apply(ctx as unknown as Context, {
    outDir: 'dsh-output-test',
    docDir: '',
    stateDir: 'dsh-plan-state-test',
    ...config,
  } as PluginConfig)
  return tools
}

test('注册恰好两个工具：只读查阅与写章', () => {
  const tools = captureAll()
  assert.deepEqual([...tools.keys()].sort(), ['read_static_doc', 'write_chapter'])
})

test('每个工具一个文件，且原生取数工具已删除', () => {
  assert.ok(existsSync(join(root, 'src', 'tools', 'read_static_doc.ts')))
  assert.ok(existsSync(join(root, 'src', 'tools', 'write_chapter.ts')))
  assert.ok(!existsSync(join(root, 'src', 'tools', 'get_test_plan_info.ts')), '取数工具应已删除')
})

test('write_chapter 参数 schema：planId 必填、chapterNo 锁死公文顺序', () => {
  const tool = captureAll().get('write_chapter')
  assert.ok(tool, '未注册 write_chapter')
  const parameters = tool.parameters as {
    required?: string[]
    properties: Record<string, { enum?: string[]; type?: string }>
  }
  assert.deepEqual([...parameters.required ?? []].sort(), ['chapterNo', 'content', 'planId'])
  assert.deepEqual(parameters.properties.chapterNo.enum, DOCUMENT_ORDER)
  assert.equal(parameters.properties.planId.type, 'string')
  // planName 可选，因此不在 required 里。
  assert.equal(parameters.properties.planName.type, 'string')
})

test('read_static_doc 参数 schema：只读分页', () => {
  const tool = captureAll().get('read_static_doc')
  assert.ok(tool, '未注册 read_static_doc')
  const properties = (tool.parameters as { properties: Record<string, unknown> }).properties
  assert.deepEqual(Object.keys(properties).sort(), ['limit', 'offset', 'path'])
})

test('Config schema 默认值', () => {
  const resolved = Config({})
  assert.equal(resolved.outDir, 'dsh-output')
  assert.equal(resolved.docDir, '')
  assert.equal(resolved.stateDir, 'dsh-plan-state')
  assert.equal(resolved.keyPrefix, 'dsh:plan-state:')
  assert.equal(resolved.ttlSeconds, 3 * 24 * 60 * 60)
})

test('Config schema 允许覆盖', () => {
  assert.equal(Config({ outDir: '/tmp/x' }).outDir, '/tmp/x')
  assert.equal(Config({ ttlSeconds: 60 }).ttlSeconds, 60)
  assert.equal(Config({ stateDir: 's' }).stateDir, 's')
})
