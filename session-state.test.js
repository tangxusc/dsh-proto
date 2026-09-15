/**
 * 按 session 落盘的进度 sidecar。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  emptyState,
  loadState,
  resolveStateDir,
  saveState,
  sessionIdOf,
  stateFileName,
} from './src/session-state.js'

const DIR = join(tmpdir(), `dsh-plan-state-${process.pid}`)

test('resolveStateDir 默认 dsh-plan-state，可覆盖', () => {
  assert.ok(resolveStateDir('').endsWith('dsh-plan-state'))
  assert.equal(resolveStateDir(DIR), DIR)
})

test('sessionIdOf 要求 exec.agent.id', () => {
  assert.equal(sessionIdOf({ agent: { id: ' abc ' } }), 'abc')
  assert.throws(() => sessionIdOf({}), /缺少会话/)
  assert.throws(() => sessionIdOf({ agent: {} }), /缺少会话/)
})

test('loadState 缺文件时为空进度；save 后能读回', () => {
  rmSync(DIR, { recursive: true, force: true })
  assert.deepEqual(loadState(DIR, 's1'), emptyState())
  const state = emptyState()
  state.planId = 'p1'
  state.chapters = { cover: '<p>x</p>' }
  saveState(DIR, 's1', state)
  const loaded = loadState(DIR, 's1')
  assert.equal(loaded.planId, 'p1')
  assert.equal(loaded.chapters.cover, '<p>x</p>')
  assert.ok(readFileSync(join(DIR, stateFileName('s1')), 'utf8').includes('"p1"'))
  rmSync(DIR, { recursive: true, force: true })
})

test('不同 sessionId 写入不同文件', () => {
  rmSync(DIR, { recursive: true, force: true })
  saveState(DIR, 'a', { ...emptyState(), planId: 'pa' })
  saveState(DIR, 'b', { ...emptyState(), planId: 'pb' })
  assert.equal(loadState(DIR, 'a').planId, 'pa')
  assert.equal(loadState(DIR, 'b').planId, 'pb')
  rmSync(DIR, { recursive: true, force: true })
})
