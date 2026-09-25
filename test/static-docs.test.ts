/**
 * 静态文档只读访问：目录、分页读取、路径沙箱。
 */

import { mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { apply } from '../src/index.ts'
import {
  DEFAULT_PAGE_LINES,
  MAX_PAGE_LINES,
  TEMPLATE_EXT,
  bundledDocDir,
  bundledTemplateDir,
  listDocs,
  readDoc,
  resolveDocPath,
} from '../src/static-docs.ts'

const FIX = join(tmpdir(), `dsh-static-docs-${process.pid}`)

function captureRead(docDir: string): ToolDefinition {
  const map = new Map<string, ToolDefinition>()
  apply({
    tools: { register: (t: ToolDefinition) => map.set(t.name, t) },
    systemPrompt: { section: () => {} },
  } as unknown as Context, {
    outDir: 'dsh-output-test',
    docDir,
    stateDir: 'dsh-plan-state-test',
  })
  const tool = map.get('read_static_doc')
  assert.ok(tool, '未注册 read_static_doc')
  return tool
}

test('自带 doc 目录能列出术语与接口文档，且不含正文', () => {
  const docs = listDocs(bundledDocDir())
  const paths = docs.map((d) => d.path)
  assert.ok(paths.includes('业务术语解释.md'))
  assert.ok(paths.includes('特设POC-本体平台接.md'))
  for (const d of docs) {
    assert.ok(d.lines > 0)
    assert.ok(d.bytes > 0)
    assert.ok(d.title.length > 0)
    assert.equal((d as { content?: unknown }).content, undefined)
  }
})

test('分页读取不超过上限，hasMore 指引下一页', () => {
  const first = readDoc(bundledDocDir(), '特设POC-本体平台接.md', 1, 20)
  assert.equal(first.offset, 1)
  assert.equal(first.limit, 20)
  assert.equal(first.content.split('\n').length, 20)
  assert.equal(first.hasMore, true)
  assert.equal(first.nextOffset, 21)
  const second = readDoc(bundledDocDir(), '特设POC-本体平台接.md', first.nextOffset, 20)
  assert.equal(second.offset, 21)
  assert.notEqual(second.content, first.content)
})

test('单次 limit 被封顶，避免一次灌完整本', () => {
  const page = readDoc(bundledDocDir(), '特设POC-本体平台接.md', 1, 9999)
  assert.equal(page.limit, MAX_PAGE_LINES)
  assert.ok(page.totalLines > MAX_PAGE_LINES)
  assert.equal(page.hasMore, true)
})

test('拒绝越权路径与绝对路径', () => {
  const root = bundledDocDir()
  assert.throws(() => resolveDocPath(root, '../package.json'), /相对路径|之外/)
  assert.throws(() => resolveDocPath(root, '/etc/passwd'), /相对路径/)
  assert.throws(() => resolveDocPath(root, ''), /不能为空/)
  assert.throws(() => readDoc(root, '不存在.md'), /不存在/)
})

test('工具：不传 path 列出；传 path 只读分页', async () => {
  const tool = captureRead(bundledDocDir())
  const listed = await tool.execute({}, {} as ToolRunContext) as { action: string; documents: { path: string }[]; content: string }
  assert.equal(listed.action, 'list')
  assert.ok(listed.documents.some((d) => d.path === '业务术语解释.md'))
  assert.equal(listed.content, '')

  const page = await tool.execute({ path: '业务术语解释.md', offset: 1, limit: 5 }, {} as ToolRunContext) as {
    action: string
    documents: unknown[]
    content: string
  }
  assert.equal(page.action, 'read')
  assert.equal(page.documents.length, 0)
  assert.match(page.content, /功能\/性能要求内容/)
  assert.equal(page.content.split('\n').length, 5)
})

test('工具：沙箱目录内可读，逃逸失败', async () => {
  rmSync(FIX, { recursive: true, force: true })
  mkdirSync(FIX, { recursive: true })
  writeFileSync(join(FIX, 'a.md'), '# A\nline2\nline3\n', 'utf8')
  writeFileSync(join(FIX, 'secret.txt'), 'nope', 'utf8')
  const outside = join(FIX, '..', `outside-${process.pid}.md`)
  writeFileSync(outside, 'escaped', 'utf8')

  const tool = captureRead(FIX)
  const ok = await tool.execute({ path: 'a.md' }, {} as ToolRunContext) as { content: string; offset: number; limit: number }
  assert.match(ok.content, /^# A/)
  assert.equal(ok.offset, 1)
  assert.equal(ok.limit, DEFAULT_PAGE_LINES)

  // .json 已不再有可读根（方案数据改由 MCP 资源提供）。
  await assert.rejects(() => tool.execute({ path: '../package.json' }, {} as ToolRunContext), /不支持的文件类型/)
  // 扩展名合法时仍必须被沙箱拦住。
  await assert.rejects(() => tool.execute({ path: '../escape.md' }, {} as ToolRunContext), /相对路径|之外/)
  await assert.rejects(() => tool.execute({ path: outside }, {} as ToolRunContext), /相对路径/)

  try {
    symlinkSync(outside, join(FIX, 'link.md'))
    await assert.rejects(() => tool.execute({ path: 'link.md' }, {} as ToolRunContext), /之外|不存在/)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'EPERM' || code === 'EACCES') {
      // 部分环境禁止建符号链接，跳过这一条。
    } else if (!String((error as Error).message).includes('之外') && !String((error as Error).message).includes('不存在')) {
      throw error
    }
  } finally {
    rmSync(outside, { force: true })
    rmSync(FIX, { recursive: true, force: true })
  }
})

test('章节模版可列出并只读，不经渲染', async () => {
  const listed = listDocs(bundledTemplateDir(), TEMPLATE_EXT)
  const paths = listed.map((d) => d.path)
  assert.ok(paths.includes('cover.html'))
  assert.ok(paths.includes('01.html'))
  assert.ok(paths.includes('05.html'))
  assert.ok(paths.includes('11.html'))
  assert.equal(listed.length, 12)
  const one = listed.find((d) => d.path === '01.html')
  assert.match(one!.title, /范围/)

  const tool = captureRead(bundledDocDir())
  const catalog = await tool.execute({}, {} as ToolRunContext) as { documents: { path: string; kind: string }[] }
  assert.ok(catalog.documents.some((d) => d.path === 'cover.html' && d.kind === 'template'))
  const page = await tool.execute({ path: '01.html' }, {} as ToolRunContext) as { kind: string; content: string }
  assert.equal(page.kind, 'template')
  assert.match(page.content, /01　范围/)
  assert.match(page.content, /本方案规定了/)
  assert.ok(!page.content.includes('<p>正文</p>'), '模版应原样返回')
})
