import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CACHE_BREAKPOINTS, listCacheMarkers } from '../../src/lib/protocol/cache-ttl.mjs'
import { prepareOutboundEnvelope } from '../../src/lib/protocol/outbound-attempt.mjs'
import {
  CONTINUE_USER_TEXT,
  MISSING_TOOL_RESULT_TEXT,
  ensureConversationInvariants,
  modelSupportsAssistantPrefill,
} from '../../src/lib/protocol/request-rectifier.mjs'

const text = (value) => ({ type: 'text', text: value })
const user = (value) => ({ role: 'user', content: [text(value)] })
const assistant = (...content) => ({ role: 'assistant', content })
const continueTurn = { role: 'user', content: [text(CONTINUE_USER_TEXT)] }

// prepareOutboundEnvelope is the HTTP hop's last step before the worker.
function sendHttp(messages, { model = 'claude-opus-4-6', ...options } = {}) {
  const body = { model, max_tokens: 64, messages }
  return prepareOutboundEnvelope({ canonicalBody: body, inbound: body, identity: {}, unofficial: true, ...options })
    .body
}

test('only Claude before 4.6 keeps a trailing assistant turn as prefill', () => {
  for (const id of [
    'claude-3-5-haiku-20241022',
    'claude-3-7-sonnet-latest',
    'claude-sonnet-4-20250514',
    'claude-opus-4-0',
    'claude-opus-4-1-20250805',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929[1m]',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-5-20251101',
  ]) {
    assert.equal(modelSupportsAssistantPrefill(id), true, id)
  }
  for (const id of [
    'claude-opus-4-6',
    'claude-sonnet-4-6[1m]',
    'claude-opus-4-7',
    'claude-sonnet-5',
    'claude-opus-5-5',
    'claude-haiku-5-5',
    'claude-fable-5',
    'claude-next',
    '',
  ]) {
    assert.equal(modelSupportsAssistantPrefill(id), false, id)
  }
})

test('the tail check keeps a legacy prefill but answers a dangling tool_use on every model', () => {
  const prefill = [user('Reply in JSON.'), assistant(text('{"name":'))]
  assert.deepEqual(ensureConversationInvariants({ model: 'claude-sonnet-4-5', messages: prefill }).messages, prefill)
  assert.deepEqual(ensureConversationInvariants({ model: 'claude-opus-4-6', messages: prefill }).messages, [
    ...prefill,
    continueTurn,
  ])
  const dangling = [user('run'), assistant({ type: 'tool_use', id: 'toolu_1', name: 'shell', input: {} })]
  for (const model of ['claude-sonnet-4-5', 'claude-opus-4-6']) {
    const once = ensureConversationInvariants({ model, messages: dangling })
    assert.deepEqual(once.messages.at(-1), {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: MISSING_TOOL_RESULT_TEXT }],
    })
    assert.deepEqual(ensureConversationInvariants(once), once)
  }
})

test('HTTP hop ends an unofficial assistant tail on a user turn after caller cache markers', () => {
  const out = sendHttp([user('task'), assistant(text('step one')), user('next'), assistant(text('ran it'))], {
    cacheBreakpoints: DEFAULT_CACHE_BREAKPOINTS,
  })
  assert.deepEqual(out.messages.at(-1), continueTurn)
  const marked = listCacheMarkers(out)
    .filter((marker) => marker.section === 'messages')
    .map((marker) => marker.index)
  // The next request will not carry the synthesized turn, so it must not anchor the cache.
  assert.ok(marked.includes(out.messages.length - 2), JSON.stringify(marked))
  assert.ok(!marked.includes(out.messages.length - 1), JSON.stringify(marked))
})

test('HTTP hop settles the tail after beta gating lifts a trailing system turn', () => {
  const out = sendHttp([user('hi'), assistant(text('ran it')), { role: 'system', content: [text('<reminder>')] }])
  assert.deepEqual(
    out.messages.map((message) => message.role),
    ['user', 'assistant', 'user'],
  )
  assert.deepEqual(out.messages.at(-1), continueTurn)
})

for (const credentialMode of ['setup-token', 'official-setup-token', 'apikey']) {
  test(`HTTP hop checks the tail for ${credentialMode} credentials too`, () => {
    const out = sendHttp([user('hi'), assistant(text('ran it'))], { credentialMode })
    assert.deepEqual(out.messages.at(-1), continueTurn)
  })
}

test('HTTP hop leaves official Claude Code tails alone', () => {
  const out = sendHttp([user('hi'), assistant(text('ran it'))], { unofficial: false, officialClient: true })
  assert.equal(out.messages.at(-1).role, 'assistant')
  assert.equal(out.messages.at(-1).content.at(-1).text, 'ran it')
})

test('HTTP hop keeps a prefill tail on models that still honor it', () => {
  const out = sendHttp([user('Reply in JSON.'), assistant(text('{"name":'))], { model: 'claude-sonnet-4-5' })
  assert.equal(out.messages.at(-1).role, 'assistant')
  assert.equal(out.messages.at(-1).content.at(-1).text, '{"name":')
})

test('KIN_UNOFFICIAL_CONVERSATION_GUARD=0 leaves the HTTP first hop to the retry repair', (t) => {
  const previous = process.env.KIN_UNOFFICIAL_CONVERSATION_GUARD
  process.env.KIN_UNOFFICIAL_CONVERSATION_GUARD = '0'
  t.after(() => {
    if (previous === undefined) delete process.env.KIN_UNOFFICIAL_CONVERSATION_GUARD
    else process.env.KIN_UNOFFICIAL_CONVERSATION_GUARD = previous
  })
  const out = sendHttp([user('hi'), assistant(text('ran it'))])
  assert.equal(out.messages.at(-1).role, 'assistant')
})
