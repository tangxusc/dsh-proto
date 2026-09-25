/**
 * 投影层：目录/切片的结构与体量。
 *
 * 体量断言是这套设计的核心依据 —— 投影必须显著小于原始，否则「按需切片」没有意义。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planFixture } from '../src/mcp/fixture.ts'
import {
  projectBasic,
  projectIndex,
  projectPoint,
  projectTest,
  projectTests,
  sizeKB,
} from '../src/mcp/project.ts'

const PLAN = planFixture()
const PLAN_ID = 'example-plan-001'

test('fixture 结构符合预期（basicInfo + functionInfo.functionPoints）', () => {
  const rec = PLAN as Record<string, unknown>
  assert.ok(rec.basicInfo, 'fixture 缺少 basicInfo')
  const info = rec.functionInfo as Record<string, unknown>
  assert.equal((info.functionPoints as unknown[]).length, 3)
  assert.equal((info.functionTestInfos as unknown[]).length, 2)
})

test('目录：含 basicInfo、功能点清单与总量统计', () => {
  const index = projectIndex(PLAN, PLAN_ID)
  assert.equal(index.planId, PLAN_ID)
  assert.equal(index.basicInfo.planName, '示例发电机设备通电检查试验方案')
  assert.equal(index.points.length, 3)
  assert.equal(index.tests.length, 2)
  assert.deepEqual(index.totals.pointCount, 3)
  assert.deepEqual(index.totals.testCount, 2)
  assert.ok(index.totals.rawKB > 20, `原始应 >20KB，实际 ${index.totals.rawKB}`)

  const first = index.points[0]
  assert.equal(first.index, 0)
  assert.ok(first.pointName.length > 0)
  assert.equal(first.adoptionStatus, 'adopted')
  assert.ok(first.fields.length > 0, '目录应列出字段名')
  assert.ok(first.sizeKB > 0)
})

test('目录体量小到可以先行读取', () => {
  const kb = sizeKB(projectIndex(PLAN, PLAN_ID))
  assert.ok(kb < 4, `目录应 <4KB，实际 ${kb}KB`)
})

test('功能点切片：只留 pointName / adoptionStatus / fields[fieldName,fieldContent]', () => {
  const slice = projectPoint(PLAN, 0)
  assert.deepEqual(Object.keys(slice).sort(), ['adoptionStatus', 'fields', 'index', 'pointName'])
  assert.ok(slice.fields.length > 0)
  for (const f of slice.fields) {
    assert.deepEqual(Object.keys(f).sort(), ['fieldContent', 'fieldName'])
  }

  const text = JSON.stringify(slice)
  for (const dropped of ['sourceReferences', 'designFileCount', 'fieldOrigin', 'sortNo', 'suggestions', 'fieldType']) {
    assert.ok(!text.includes(dropped), `切片不应包含 ${dropped}`)
  }
})

test('功能点切片体量显著小于原始（元数据占大头）', () => {
  const rawPoints = (PLAN as { functionInfo: { functionPoints: unknown[] } }).functionInfo.functionPoints
  const rawKB = sizeKB(rawPoints[0])
  const projKB = sizeKB(projectPoint(PLAN, 0))
  assert.ok(projKB < rawKB * 0.4, `投影 ${projKB}KB 应远小于原始 ${rawKB}KB`)
})

test('切片序号越界或非整数时抛错', () => {
  assert.throws(() => projectPoint(PLAN, 3), /越界/)
  assert.throws(() => projectPoint(PLAN, -1), /越界/)
  assert.throws(() => projectPoint(PLAN, 1.5), /越界/)
  assert.throws(() => projectTest(PLAN, 2), /越界/)
})

test('试验信息切片：只留 contentName 与 content', () => {
  const all = projectTests(PLAN)
  assert.equal(all.length, 2)
  for (const t of all) {
    assert.deepEqual(Object.keys(t).sort(), ['content', 'contentName', 'index'])
  }
  const one = projectTest(PLAN, 0)
  assert.deepEqual(one, all[0])
})

test('basicInfo 只留会被写进公文的字段', () => {
  const basic = projectBasic((PLAN as Record<string, unknown>).basicInfo)
  const keys = Object.keys(basic).sort()
  assert.ok(keys.includes('planName'))
  assert.ok(keys.includes('objectiveDescription'))
  // 不应把 sourceFiles / id / status 这类前端字段带出来。
  for (const dropped of ['sourceFiles', 'id', 'status', 'completedStep']) {
    assert.ok(!keys.includes(dropped), `basicInfo 不应包含 ${dropped}`)
  }
})
