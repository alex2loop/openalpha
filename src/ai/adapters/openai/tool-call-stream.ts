import type { StreamEvent } from '@/core/stream-events'
import { buildToolCallId } from '@/ai/adapters/tool-call-id'

const NO_EVENTS: readonly StreamEvent[] = []

export interface OpenAiToolDelta {
  readonly index?: number
  readonly id?: string
  readonly function?: { readonly name?: string; readonly arguments?: string }
}

// Id, name and arguments arrive across separate deltas, in no guaranteed order.
export interface PartialToolCall {
  id?: string
  name: string
  started: boolean
  pendingArgs: string
}

export function routeToolCall(
  call: OpenAiToolDelta,
  byIndex: Map<number, PartialToolCall>
): readonly StreamEvent[] {
  const index = call.index ?? 0
  let pending = byIndex.get(index)

  // A fresh id at an occupied index is a new call: start the old one before its slot is reused.
  if (pending?.id && call.id && call.id !== pending.id) {
    byIndex.delete(index)
    return [...startEvents(pending), ...routeToolCall(call, byIndex)]
  }

  if (!pending) {
    pending = { name: '', started: false, pendingArgs: '' }
    byIndex.set(index, pending)
  }

  if (call.id && !pending.id) {
    pending.id = call.id
  }

  const name = call.function?.name

  // Most hosts stream a name in fragments; NVIDIA NIM repeats the whole name in every chunk.
  if (name) {
    pending.name = name.startsWith(pending.name) ? name : pending.name + name
  }

  const args = call.function?.arguments

  if (!args) {
    return NO_EVENTS
  }

  // Arguments can start streaming before the name has finished assembling, and the runner freezes
  // the name at tool_call_start. A delta that still carries a name fragment may grow it further, so
  // hold the buffered args until a later delta proves the name is complete.
  if (!pending.started) {
    pending.pendingArgs += args
    return name ? NO_EVENTS : startEvents(pending)
  }

  return pending.id ? [{ type: 'tool_call_args_delta', id: pending.id, delta: args }] : NO_EVENTS
}

function startEvents(pending: PartialToolCall): readonly StreamEvent[] {
  if (pending.started || !pending.id || !pending.name) {
    return NO_EVENTS
  }

  pending.started = true
  const events: StreamEvent[] = [{ type: 'tool_call_start', id: pending.id, name: pending.name }]

  if (pending.pendingArgs.length > 0) {
    events.push({ type: 'tool_call_args_delta', id: pending.id, delta: pending.pendingArgs })
    pending.pendingArgs = ''
  }

  return events
}

// A tool call whose id and name landed in the same chunk as the closing finish_reason never got a
// start signal, and one the host streamed with no id at all is named here. Idempotent: `started`
// guards a second call from re-emitting.
export function flushPending(byIndex: Map<number, PartialToolCall>): readonly StreamEvent[] {
  const events: StreamEvent[] = []

  for (const pending of byIndex.values()) {
    pending.id ??= buildToolCallId()
    events.push(...startEvents(pending))
  }

  return events
}
