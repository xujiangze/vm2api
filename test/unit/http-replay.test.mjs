import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createProcessReplay,
  expansionEnabled,
  replayScopeFromRequest,
  DEFAULT_HTTP_REPLAY_MAX_ITEMS,
  DEFAULT_HTTP_REPLAY_MAX_BYTES,
} from '../../src/lib/protocol/http-replay.mjs'

const item = (text) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] })

test('resolve returns the remembered snapshot for the same scope', () => {
  const replay = createProcessReplay()
  replay.remember('k1', 'resp_a', { input: [item('hi')], output: [{ type: 'message', role: 'assistant' }] })
  const snapshot = replay.resolve('k1', 'resp_a')
  assert.deepEqual(snapshot.input, [item('hi')])
  assert.equal(snapshot.output.length, 1)
  assert.equal(replay.resolve('k1', 'resp_missing'), null)
})

test('snapshots are scoped per API key', () => {
  const replay = createProcessReplay()
  replay.remember('k1', 'resp_a', { input: [item('hi')], output: [] })
  assert.equal(replay.resolve('k2', 'resp_a'), null)
})

test('resolve returns a deep clone of the stored snapshot', () => {
  const replay = createProcessReplay()
  const input = [item('hi')]
  replay.remember('k1', 'resp_a', { input, output: [] })
  input[0].content[0].text = 'mutated-after-remember'
  const first = replay.resolve('k1', 'resp_a')
  first.input[0].content[0].text = 'mutated-by-reader'
  const second = replay.resolve('k1', 'resp_a')
  assert.equal(second.input[0].content[0].text, 'hi')
})

test('re-membering the same id replaces it without double-counting bytes', () => {
  const replay = createProcessReplay()
  replay.remember('k1', 'resp_a', { input: [item('one')], output: [] })
  const before = replay.size()
  replay.remember('k1', 'resp_a', { input: [item('two')], output: [] })
  assert.equal(replay.size(), before)
  assert.deepEqual(replay.resolve('k1', 'resp_a').input, [item('two')])
})

test('oldest entries are evicted beyond maxItems', () => {
  const replay = createProcessReplay({ maxItems: 2, maxBytes: 1024 * 1024 })
  replay.remember('k1', 'resp_1', { input: [item('1')], output: [] })
  replay.remember('k1', 'resp_2', { input: [item('2')], output: [] })
  replay.remember('k1', 'resp_3', { input: [item('3')], output: [] })
  assert.equal(replay.resolve('k1', 'resp_1'), null)
  assert.ok(replay.resolve('k1', 'resp_2'))
  assert.ok(replay.resolve('k1', 'resp_3'))
})

test('oldest entries are evicted beyond maxBytes', () => {
  const replay = createProcessReplay({ maxItems: 10, maxBytes: 512 })
  replay.remember('k1', 'resp_big1', { input: [item('x'.repeat(200))], output: [] })
  replay.remember('k1', 'resp_big2', { input: [item('y'.repeat(200))], output: [] })
  replay.remember('k1', 'resp_big3', { input: [item('z'.repeat(200))], output: [] })
  assert.equal(replay.resolve('k1', 'resp_big1'), null)
  assert.ok(replay.resolve('k1', 'resp_big3'))
})

test('remember ignores empty ids, scopes, or snapshots', () => {
  const replay = createProcessReplay()
  replay.remember('', 'resp_a', { input: [], output: [] })
  replay.remember('k1', '', { input: [], output: [] })
  replay.remember('k1', 'resp_a', null)
  assert.equal(replay.size(), 0)
  assert.equal(replay.resolve('k1', 'resp_a'), null)
})

test('expansionEnabled defaults on and KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION=0 turns it off', () => {
  const previous = process.env.KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION
  try {
    delete process.env.KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION
    assert.equal(expansionEnabled(), true)
    process.env.KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION = '0'
    assert.equal(expansionEnabled(), false)
  } finally {
    if (previous === undefined) delete process.env.KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION
    else process.env.KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION = previous
  }
})

test('replayScopeFromRequest prefers the API key record id', () => {
  assert.equal(replayScopeFromRequest({ apiKeyRecord: { id: 7 }, apiKeyKind: 'managed' }), '7')
  assert.equal(replayScopeFromRequest({ apiKeyKind: 'master' }), 'master')
  assert.equal(replayScopeFromRequest({}), 'anon')
})

test('default limits match the documented process budget', () => {
  assert.equal(DEFAULT_HTTP_REPLAY_MAX_ITEMS, 256)
  assert.equal(DEFAULT_HTTP_REPLAY_MAX_BYTES, 64 * 1024 * 1024)
})
