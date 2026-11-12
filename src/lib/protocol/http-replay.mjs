/**
 * Process-level Replay Store for HTTP /v1/responses.
 *
 * Every completed response the gateway returns is remembered (input + output
 * snapshot) so a later `previous_response_id` can be expanded locally and the
 * field never reaches upstream: no GPT account has to hold the conversation,
 * and pool scheduling stays free to move turns between accounts. Same contract
 * as the per-connection replay in responses-ws.mjs, with process lifetime and
 * per-API-key scoping instead of per-connection isolation.
 */

export const DEFAULT_HTTP_REPLAY_MAX_ITEMS = 256
export const DEFAULT_HTTP_REPLAY_MAX_BYTES = 64 * 1024 * 1024

function envInt(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION=0 restores the pre-expansion passthrough. */
export function expansionEnabled() {
  return process.env.KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION !== '0'
}

/** Snapshot scope: one API key can only expand ids its own requests produced. */
export function replayScopeFromRequest(req) {
  const id = req?.apiKeyRecord?.id
  if (id != null && id !== '') return String(id)
  return String(req?.apiKeyKind || 'anon')
}

function cloneJson(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

const TOOL_OUTPUT_TYPES = { function_call: 'function_call_output', custom_tool_call: 'custom_tool_call_output' }

function callIdOf(item) {
  return item && typeof item === 'object' && typeof item.call_id === 'string' ? item.call_id : ''
}

/**
 * Tool calls ending the replayed response must be answered by the continuation
 * input. sub2api binds response ids per Claude Code session, so subagents and
 * client retries can carry an id whose trailing call belongs to another turn;
 * expanding it anyway makes upstream 400 "No tool output found". Unanswered
 * calls are reported so the caller can answer previous_response_not_found,
 * which sub2api recovers from by resending the full history. Calls the client
 * echoed back are dropped from `input` so each call appears once upstream.
 */
export function pairReplayedToolCalls(snapshot, input) {
  const items = Array.isArray(input) ? input : []
  const replayed = new Map()
  for (const item of Array.isArray(snapshot?.output) ? snapshot.output : []) {
    const id = callIdOf(item)
    if (id && TOOL_OUTPUT_TYPES[item.type]) replayed.set(id, TOOL_OUTPUT_TYPES[item.type])
  }
  if (!replayed.size) return { ok: true, input: items }
  const answered = new Set(items.filter((item) => replayed.get(callIdOf(item)) === item?.type).map(callIdOf))
  const missing = [...replayed.keys()].filter((id) => !answered.has(id))
  if (missing.length) return { ok: false, missing }
  return { ok: true, input: items.filter((item) => !(TOOL_OUTPUT_TYPES[item?.type] && replayed.has(callIdOf(item)))) }
}

export function createProcessReplay({
  maxItems = envInt('KIN_CODEX_REPLAY_MAX_ITEMS', DEFAULT_HTTP_REPLAY_MAX_ITEMS),
  maxBytes = envInt('KIN_CODEX_REPLAY_MAX_BYTES', DEFAULT_HTTP_REPLAY_MAX_BYTES),
} = {}) {
  const items = new Map()
  const order = []
  let bytes = 0

  const entryKey = (scope, id) => `${scope}:${id}`

  function forget(key) {
    const prev = items.get(key)
    if (!prev) return
    items.delete(key)
    bytes = Math.max(0, bytes - prev.bytes)
  }

  function evict() {
    while (order.length && (order.length > maxItems || bytes > maxBytes)) {
      forget(order.shift())
    }
  }

  return {
    maxItems,
    maxBytes,
    remember(scope, id, snapshot) {
      if (typeof scope !== 'string' || !scope || typeof id !== 'string' || !id || !snapshot) return
      const key = entryKey(scope, id)
      forget(key)
      const stored = {
        input: Array.isArray(snapshot.input) ? cloneJson(snapshot.input) : [],
        output: Array.isArray(snapshot.output) ? cloneJson(snapshot.output) : [],
        bytes: 0,
      }
      stored.bytes = Buffer.byteLength(JSON.stringify({ id, input: stored.input, output: stored.output }))
      items.set(key, stored)
      order.push(key)
      bytes += stored.bytes
      evict()
    },
    resolve(scope, id) {
      if (typeof scope !== 'string' || !scope || typeof id !== 'string' || !id) return null
      const stored = items.get(entryKey(scope, id))
      if (!stored) return null
      return { input: cloneJson(stored.input), output: cloneJson(stored.output) }
    },
    size() {
      return items.size
    },
  }
}

export const httpReplayStore = createProcessReplay()
