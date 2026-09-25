/**
 * 方案数据的投影：把接口原始 JSON 收成「写作真正要用的字段」。
 *
 * 实测原始 JSON 里约 84% 是写作无关的元数据 —— `id` / `fieldType` / `fieldOrigin` /
 * `sortNo` / `designFileCount` / `suggestions`，以及**功能点级与字段级重复出现的**
 * `sourceReferences`（里面的 `recommendation` 是前端展示用的长文本）。
 *
 * 投影后再按功能点切片，单片约 1 KB，模型按需读取，避免把整篇方案灌进上下文。
 */

/** 功能点概览，用于目录资源。 */
export interface PointSummary {
  /** 切片序号，对应 `plan://plans/{planId}/points/{index}`。 */
  index: number
  pointName: string
  adoptionStatus: string
  /** 该功能点包含的字段名清单（正文不在目录里，需读切片）。 */
  fields: string[]
  /** 原始体量（KB），供模型判断是否值得读。 */
  sizeKB: number
}

/** 试验信息概览，用于目录资源。 */
export interface TestSummary {
  index: number
  contentName: string
  sizeKB: number
}

/** 目录资源：先读它，再决定读哪些切片。 */
export interface PlanIndex {
  planId: string
  basicInfo: Record<string, unknown>
  points: PointSummary[]
  tests: TestSummary[]
  totals: { pointCount: number; testCount: number; rawKB: number }
}

/** 一个字段的正文。 */
export interface FieldSlice {
  fieldName: string
  fieldContent: unknown
}

/** 切片资源：单个功能点。 */
export interface PointSlice {
  index: number
  pointName: string
  adoptionStatus: string
  fields: FieldSlice[]
}

/** 切片资源：单条试验信息。 */
export interface TestSlice {
  index: number
  contentName: string
  content: unknown
}

/** basicInfo 里真正会被写进公文的字段。 */
const BASIC_KEYS = [
  'planName',
  'planNo',
  'productModelName',
  'targetName',
  'functionName',
  'planType',
  'testType',
  'testStages',
  'objectiveDescription',
] as const

/** 收成普通对象；非对象返回空对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** 收成数组；非数组返回空数组。 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 字符串化，缺失回退空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 紧凑 JSON 的字节数换算成 KB（保留 1 位小数）。 */
export function sizeKB(value: unknown): number {
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  return Math.round((bytes / 1024) * 10) / 10
}

/** 方案数据的顶层容器（`functionInfo` 缺省时按空对象处理）。 */
function functionInfoOf(plan: unknown): Record<string, unknown> {
  return asRecord(asRecord(plan).functionInfo)
}

/** 全部功能点原始对象。 */
function rawPoints(plan: unknown): Record<string, unknown>[] {
  return asArray(functionInfoOf(plan).functionPoints).map(asRecord)
}

/** 全部试验信息原始对象。 */
function rawTests(plan: unknown): Record<string, unknown>[] {
  return asArray(functionInfoOf(plan).functionTestInfos).map(asRecord)
}

/** basicInfo 的投影：只留会被写进公文的字段。 */
export function projectBasic(basic: unknown): Record<string, unknown> {
  const src = asRecord(basic)
  const out: Record<string, unknown> = {}
  for (const key of BASIC_KEYS) {
    if (src[key] !== undefined && src[key] !== null) out[key] = src[key]
  }
  return out
}

/**
 * 目录：`plan://plans/{planId}`。
 * @param plan - 方案原始数据。
 * @param planId - 请求的 planId（覆盖数据里的占位值）。
 * @returns 含 basicInfo、功能点/试验信息清单与总量统计的目录。
 */
export function projectIndex(plan: unknown, planId: string): PlanIndex {
  const points = rawPoints(plan)
  const tests = rawTests(plan)
  return {
    planId,
    basicInfo: projectBasic(asRecord(plan).basicInfo),
    points: points.map((p, index) => ({
      index,
      pointName: str(p.pointName),
      adoptionStatus: str(p.adoptionStatus),
      fields: asArray(p.fields).map((f) => str(asRecord(f).fieldName)).filter(Boolean),
      sizeKB: sizeKB(p),
    })),
    tests: tests.map((t, index) => ({
      index,
      contentName: str(t.contentName),
      sizeKB: sizeKB(t),
    })),
    totals: {
      pointCount: points.length,
      testCount: tests.length,
      rawKB: sizeKB(plan),
    },
  }
}

/**
 * 功能点切片：`plan://plans/{planId}/points/{index}`。
 * @param plan - 方案原始数据。
 * @param index - 功能点序号（从 0 计）。
 * @returns 只含 pointName / adoptionStatus / fields[fieldName,fieldContent] 的切片。
 * @throws 序号越界或不是整数时。
 */
export function projectPoint(plan: unknown, index: number): PointSlice {
  const points = rawPoints(plan)
  if (!Number.isInteger(index) || index < 0 || index >= points.length) {
    throw new Error(`功能点序号越界: ${index}（共 ${points.length} 项，序号从 0 计）`)
  }
  const p = points[index]
  return {
    index,
    pointName: str(p.pointName),
    adoptionStatus: str(p.adoptionStatus),
    fields: asArray(p.fields)
      .map(asRecord)
      .map((f) => ({ fieldName: str(f.fieldName), fieldContent: f.fieldContent ?? '' })),
  }
}

/**
 * 试验信息切片：`plan://plans/{planId}/tests`。
 * @param plan - 方案原始数据。
 * @param index - 试验信息序号（从 0 计）。
 * @returns 只含 contentName 与 content 的切片。
 * @throws 序号越界或不是整数时。
 */
export function projectTest(plan: unknown, index: number): TestSlice {
  const tests = rawTests(plan)
  if (!Number.isInteger(index) || index < 0 || index >= tests.length) {
    throw new Error(`试验信息序号越界: ${index}（共 ${tests.length} 项，序号从 0 计）`)
  }
  const t = tests[index]
  return { index, contentName: str(t.contentName), content: t.content ?? '' }
}

/**
 * 全部试验信息的投影：`plan://plans/{planId}/tests`。
 * @param plan - 方案原始数据。
 * @returns 每条只含 contentName 与 content。
 */
export function projectTests(plan: unknown): TestSlice[] {
  return rawTests(plan).map((t, index) => ({
    index,
    contentName: str(t.contentName),
    content: t.content ?? '',
  }))
}
