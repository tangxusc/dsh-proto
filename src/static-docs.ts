/**
 * 静态参考文档的只读访问：列出、按行分页读取，路径锁在 doc 根目录内。
 *
 * 模型按需分段读，不把全文灌进提示词。禁止绝对路径与 `..` 逃逸。
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 静态参考资料允许的扩展名。 */
export const ALLOWED_EXT = new Set(['.md', '.txt'])

/** 取数落盘的方案 JSON 允许的扩展名。 */
export const PLAN_EXT = new Set(['.json'])

/** 章节模版允许的扩展名（只读参照，不渲染）。 */
export const TEMPLATE_EXT = new Set(['.html'])

/** 默认每次返回的行数；大文件靠 offset 继续读。 */
export const DEFAULT_PAGE_LINES = 80

/** 单次读取行数上限，防止一次灌完整本。 */
export const MAX_PAGE_LINES = 200

/** 目录里一篇可读文件的摘要，不含正文。 */
export interface DocEntry {
  path: string
  title: string
  lines: number
  bytes: number
  kind: string
}

/** 可读取的根：静态资料、取数落盘、章节模版。 */
export interface ReadableRoot {
  dir: string
  kind: string
  exts: Set<string>
}

/** 按行分页读取的一页。 */
export interface DocPage {
  path: string
  offset: number
  limit: number
  totalLines: number
  hasMore: boolean
  nextOffset: number
  content: string
}

/**
 * 插件自带资源根目录（与 src/、lib/ 同级的 resources/）。
 */
function bundledResourcesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
}

/**
 * 插件自带的 doc 目录（resources/doc，只给模型参照）。
 * @returns 绝对路径。
 */
export function bundledDocDir(): string {
  return join(bundledResourcesDir(), 'doc')
}

/**
 * 插件自带的章节模版目录（resources/templates/dynamic-v1，只给模型参照）。
 * @returns 绝对路径。
 */
export function bundledTemplateDir(): string {
  return join(bundledResourcesDir(), 'templates', 'dynamic-v1')
}

/**
 * 解析部署配置中的文档根目录。空值用自带 resources/doc；相对路径相对进程 cwd。
 * @param configured - config.docDir。
 * @returns 绝对路径（尚未要求目录一定存在）。
 */
export function resolveDocDir(configured: string | undefined): string {
  const raw = typeof configured === 'string' ? configured.trim() : ''
  return raw ? resolve(raw) : bundledDocDir()
}

/**
 * 解析取数落盘目录。空值用进程 cwd 下的 dsh-plan-data。
 * @param configured - config.dataDir。
 * @returns 绝对路径。
 */
export function resolveDataDir(configured: string | undefined): string {
  const raw = typeof configured === 'string' ? configured.trim() : ''
  return resolve(raw || 'dsh-plan-data')
}

/**
 * 确认 candidate 落在 rootReal 之内（含 realpath 后的目标）。
 * @param rootReal - 已经 realpath 的文档根。
 * @param candidate - 待检查的绝对路径。
 */
function assertInside(rootReal: string, candidate: string): void {
  const rel = relative(rootReal, candidate)
  if (rel === '' || rel === '.') {
    throw new Error('只能读取 doc 目录内的文件，不能读取目录本身')
  }
  // 绝对 relative 或含 .. 都是逃出根目录。
  if (isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
    throw new Error('拒绝读取 doc 目录之外的路径')
  }
}

/**
 * 把相对路径解析成根内普通文件的真实路径。
 * @param docDir - 文档根。
 * @param relPath - 相对路径（如 `业务术语解释.md`）。
 * @param allowedExt - 允许的扩展名；默认静态资料。
 * @returns 文件真实路径。
 * @throws 路径为空、越权、不存在或类型不允许时。
 */
export function resolveDocPath(docDir: string, relPath: unknown, allowedExt: Set<string> = ALLOWED_EXT): string {
  const name = String(relPath ?? '').trim()
  if (name.length === 0) {
    throw new Error('path 不能为空')
  }
  if (name.includes('\0')) {
    throw new Error('非法路径')
  }
  if (isAbsolute(name) || name.split(/[/\\]/).includes('..')) {
    throw new Error('只接受 doc 目录内的相对路径')
  }
  let rootReal: string
  try {
    rootReal = realpathSync(docDir)
  } catch {
    throw new Error(`静态文档目录不存在: ${docDir}`)
  }
  const candidate = resolve(rootReal, name)
  assertInside(rootReal, candidate)
  let fileReal: string
  try {
    fileReal = realpathSync(candidate)
  } catch {
    throw new Error(`静态文档不存在: ${name}`)
  }
  assertInside(rootReal, fileReal)
  if (!statSync(fileReal).isFile()) {
    throw new Error('只能读取普通文件')
  }
  const ext = extname(fileReal).toLowerCase()
  if (!allowedExt.has(ext)) {
    throw new Error(`不支持的文件类型: ${ext || '(无扩展名)'}`)
  }
  return fileReal
}

/** 取文中第一个标题：Markdown #，否则 HTML h1 去标签。 */
function firstHeading(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (m) {
      return m[1].replaceAll('\\', '').trim()
    }
  }
  const html = text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (html) {
    return html[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  }
  return ''
}

/**
 * 列出根目录下一层的允许文件（不递归）。
 * @param docDir - 文档根。
 * @param allowedExt - 允许的扩展名；默认静态资料。
 * @returns 目录条目；根不存在时返回空数组。
 */
export function listDocs(docDir: string, allowedExt: Set<string> = ALLOWED_EXT): DocEntry[] {
  let rootReal: string
  try {
    rootReal = realpathSync(docDir)
  } catch {
    return []
  }
  const docs: DocEntry[] = []
  for (const entry of readdirSync(rootReal, { withFileTypes: true })) {
    if (!entry.isFile() || !allowedExt.has(extname(entry.name).toLowerCase())) {
      continue
    }
    const text = readFileSync(join(rootReal, entry.name), 'utf8')
    const lines = text.split(/\r?\n/)
    docs.push({
      path: entry.name,
      title: firstHeading(text) || entry.name,
      lines: lines.length,
      bytes: Buffer.byteLength(text, 'utf8'),
      kind: '',
    })
  }
  docs.sort((a, b) => a.path.localeCompare(b.path, 'zh'))
  return docs
}

function toPageIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/**
 * 按行分页读取一篇文档。
 * @param docDir - 文档根。
 * @param relPath - 相对路径。
 * @param offset - 起始行，从 1 计；缺省 1。
 * @param limit - 本页行数；缺省 DEFAULT_PAGE_LINES，封顶 MAX_PAGE_LINES。
 * @param allowedExt - 允许的扩展名；默认静态资料。
 * @returns 分页结果。
 */
export function readDoc(
  docDir: string,
  relPath: unknown,
  offset?: unknown,
  limit?: unknown,
  allowedExt: Set<string> = ALLOWED_EXT,
): DocPage {
  const abs = resolveDocPath(docDir, relPath, allowedExt)
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
  const start = toPageIndex(offset, 1)
  const wanted = toPageIndex(limit, DEFAULT_PAGE_LINES)
  const page = Math.min(wanted, MAX_PAGE_LINES)
  const slice = lines.slice(start - 1, start - 1 + page)
  const consumed = start - 1 + slice.length
  const hasMore = consumed < lines.length
  return {
    path: String(relPath).trim(),
    offset: start,
    limit: page,
    totalLines: lines.length,
    hasMore,
    nextOffset: hasMore ? consumed + 1 : 0,
    content: slice.join('\n'),
  }
}

/** 供提示词展示的目录摘要，不含正文。 */
export function catalogBrief(documents: readonly DocEntry[]): string {
  if (!documents.length) {
    return '（当前 doc 目录为空）'
  }
  return documents
    .map((d) => `- ${d.path}（${d.kind ? `${d.kind}，` : ''}${d.lines} 行，${d.title}）`)
    .join('\n')
}

/**
 * 列出多个根下的可读文件。
 * @param roots - 根目录列表。
 * @returns 带 kind 的目录条目。
 */
export function listRoots(roots: readonly ReadableRoot[]): DocEntry[] {
  const docs: DocEntry[] = []
  for (const root of roots) {
    for (const item of listDocs(root.dir, root.exts)) {
      docs.push({ ...item, kind: root.kind })
    }
  }
  return docs
}

/**
 * 按扩展名选择根并分页读取。json 走取数目录，md/txt 走静态目录，html 走章节模版目录。
 * @param roots - 根目录列表。
 * @param relPath - 相对路径。
 * @param offset - 起始行。
 * @param limit - 本页行数。
 * @returns 分页结果，含 kind。
 */
export function readFromRoots(
  roots: readonly ReadableRoot[],
  relPath: unknown,
  offset?: unknown,
  limit?: unknown,
): DocPage & { kind: string } {
  const ext = extname(String(relPath ?? '').trim()).toLowerCase()
  const candidates = roots.filter((root) => root.exts.has(ext))
  if (candidates.length === 0) {
    throw new Error(`不支持的文件类型: ${ext || '(无扩展名)'}`)
  }
  let last: unknown
  for (const root of candidates) {
    try {
      return { kind: root.kind, ...readDoc(root.dir, relPath, offset, limit, root.exts) }
    } catch (error) {
      last = error
    }
  }
  throw last
}
