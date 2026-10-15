import type { SseRouter } from '@/ai/adapters/runner'
import type { Logger } from '@/core/logging/logger'
import type { FinishReason, StreamEvent, ThinkingBlock } from '@/core/stream-events'
import { classifyStreamFrame, truncatedStreamError } from '@/ai/adapters/errors'
import { parseSseJson, parseTokenCount } from '@/ai/adapters/runner'
import { LLMError } from '@/core/errors'

export const ANTHROPIC_TRANSPORT_NAME = 'anthropic'

const NO_EVENTS: readonly StreamEvent[] = []

// Anthropic's documented error types, as the status each would have carried had it failed the
// request outright. A mid-stream failure is reported only this way — it never reaches an HTTP
// status — so an unrouted frame would end the stream as a bare empty answer.
const STREAM_ERROR_STATUSES: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
}

const STOP_REASONS: Readonly<Record<string, FinishReason>> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  tool_use: 'tool_use',
  refusal: 'content_filter',
  pause_turn: 'pause',
}

interface AnthropicUsage {
  readonly input_tokens?: number
  readonly output_tokens?: number
  readonly cache_read_input_tokens?: number
  readonly cache_creation_input_tokens?: number
}

interface AnthropicEvent {
  readonly type?: string
  readonly index?: number
  readonly message?: { readonly usage?: AnthropicUsage }
  readonly content_block?: {
    readonly type?: string
    readonly id?: string
    readonly name?: string
    readonly data?: string
  }
  readonly delta?: {
    readonly type?: string
    readonly text?: string
    readonly partial_json?: string
    readonly thinking?: string
    readonly signature?: string
    readonly stop_reason?: string
    readonly stop_details?: { readonly category?: string | null } | null
  }
  readonly usage?: AnthropicUsage
  readonly error?: { readonly type?: unknown; readonly message?: unknown }
}

interface StartUsage {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

interface RouterState {
  readonly open: Map<number, OpenBlock>
  startUsage: StartUsage | undefined
  stopped: boolean
}

// The block currently open at a given content index. Anthropic streams blocks by index, and a
// thinking block's text and signature arrive as deltas that must be reassembled before it closes.
interface OpenBlock {
  readonly kind: 'text' | 'tool_use' | 'thinking' | 'redacted_thinking'
  readonly toolId?: string
  thinking?: string
  signature?: string
}

// Anthropic streams a message as indexed content blocks. Thinking blocks in particular arrive as
// text + signature deltas that must be reassembled before the block closes.
export function anthropicRouter(logger: Logger): SseRouter {
  const state: RouterState = { open: new Map(), startUsage: undefined, stopped: false }

  return {
    route(data) {
      const event = parseSseJson<AnthropicEvent>(data, ANTHROPIC_TRANSPORT_NAME, logger)

      return event ? routeEvent(event, state, logger) : NO_EVENTS
    },
    finish() {
      if (!state.stopped) {
        throw truncatedStreamError(ANTHROPIC_TRANSPORT_NAME)
      }

      return NO_EVENTS
    },
  }
}

function routeEvent(
  event: AnthropicEvent,
  state: RouterState,
  logger: Logger
): readonly StreamEvent[] {
  // Unrouted, an error frame ends the stream with no content, which reads as an empty answer
  // rather than the overload or refused window the provider actually stated.
  if (event.type === 'error') {
    throw classifyStreamFrame(event.error?.type, STREAM_ERROR_STATUSES, event.error?.message)
  }

  if (event.type === 'message_start') {
    return messageStart(event, state)
  }

  if (event.type === 'content_block_start') {
    return blockStart(event, state.open)
  }

  if (event.type === 'content_block_delta') {
    return blockDelta(event, state.open)
  }

  if (event.type === 'content_block_stop') {
    return blockStop(event, state.open)
  }

  if (event.type === 'message_delta') {
    return messageDelta(event, state.startUsage, logger)
  }

  if (event.type === 'message_stop') {
    state.stopped = true
    return NO_EVENTS
  }

  return NO_EVENTS
}

function blockStart(event: AnthropicEvent, open: Map<number, OpenBlock>): readonly StreamEvent[] {
  const index = event.index
  const block = event.content_block

  if (typeof index !== 'number' || !block) {
    return NO_EVENTS
  }

  if (block.type === 'tool_use') {
    // Dropping the block instead would lose the call silently and surface as `empty_response`,
    // which retries and falls back against the same malformed frame.
    if (!(block.id && block.name)) {
      throw new LLMError('fatal', 'anthropic tool_use block is missing id or name')
    }

    open.set(index, { kind: 'tool_use', toolId: block.id })
    return [{ type: 'tool_call_start', id: block.id, name: block.name }]
  }

  if (block.type === 'redacted_thinking') {
    const data = block.data ?? ''
    open.set(index, { kind: 'redacted_thinking' })

    return [{ type: 'thinking_block', block: { type: 'redacted_thinking', data } }]
  }

  if (block.type === 'thinking') {
    open.set(index, { kind: 'thinking', thinking: '' })
  } else if (block.type === 'text') {
    open.set(index, { kind: 'text' })
  }

  return NO_EVENTS
}

function blockDelta(event: AnthropicEvent, open: Map<number, OpenBlock>): readonly StreamEvent[] {
  const index = event.index
  const delta = event.delta

  if (typeof index !== 'number' || !delta) {
    return NO_EVENTS
  }

  const block = open.get(index)

  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return [{ type: 'text_delta', delta: delta.text }]
  }

  if (delta.type === 'thinking_delta') {
    return thinkingDelta(block, delta.thinking)
  }

  if (delta.type === 'signature_delta') {
    return signatureDelta(block, delta.signature)
  }

  if (delta.type === 'input_json_delta') {
    return toolArgsDelta(block, delta.partial_json)
  }

  return NO_EVENTS
}

function thinkingDelta(
  block: OpenBlock | undefined,
  text: string | undefined
): readonly StreamEvent[] {
  if (!text) {
    return NO_EVENTS
  }

  if (block?.kind === 'thinking') {
    block.thinking = (block.thinking ?? '') + text
  }

  return [{ type: 'reasoning_delta', delta: text }]
}

// Buffered onto the open thinking block, never emitted: a signature has meaning only attached to
// the completed block it authenticates, which the next content_block_stop yields.
function signatureDelta(
  block: OpenBlock | undefined,
  signature: string | undefined
): readonly StreamEvent[] {
  if (typeof signature === 'string' && block?.kind === 'thinking') {
    block.signature = (block.signature ?? '') + signature
  }

  return NO_EVENTS
}

function toolArgsDelta(
  block: OpenBlock | undefined,
  partialJson: string | undefined
): readonly StreamEvent[] {
  if (typeof partialJson !== 'string' || block?.kind !== 'tool_use' || !block.toolId) {
    return NO_EVENTS
  }

  return [{ type: 'tool_call_args_delta', id: block.toolId, delta: partialJson }]
}

function blockStop(event: AnthropicEvent, open: Map<number, OpenBlock>): readonly StreamEvent[] {
  const index = event.index

  if (typeof index !== 'number') {
    return NO_EVENTS
  }

  const block = open.get(index)
  open.delete(index)

  if (block?.kind !== 'thinking') {
    return NO_EVENTS
  }

  const thinking: ThinkingBlock = {
    type: 'thinking',
    thinking: block.thinking ?? '',
    ...(block.signature !== undefined ? { signature: block.signature } : {}),
  }

  return [{ type: 'thinking_block', block: thinking }]
}

// Publish the input side as soon as it arrives: a stream that dies before message_delta still
// bills what the provider reported. The runner max-merges counters, so the delta's later output
// wins over this zero and input is never added twice. An untrustworthy start stays silent.
function messageStart(event: AnthropicEvent, state: RouterState): readonly StreamEvent[] {
  const start = parseStartUsage(event.message?.usage ?? {})
  state.startUsage = start

  if (start === undefined) {
    return NO_EVENTS
  }

  return [
    {
      type: 'usage',
      usage: {
        input: start.input,
        output: 0,
        cacheRead: start.cacheRead,
        cacheWrite: start.cacheWrite,
      },
    },
  ]
}

function messageDelta(
  event: AnthropicEvent,
  start: StartUsage | undefined,
  logger: Logger
): readonly StreamEvent[] {
  const usage = event.usage ?? {}
  const output = parseTokenCount(usage.output_tokens)
  const events: StreamEvent[] = []

  // Re-publish the complete counters once output arrives: the runner's field-wise max merge keeps
  // the final output over the start frame's zero and never double-counts the repeated input side.
  // An untrustworthy start leaves usage unseen here so the runner estimates the entire response.
  if (start !== undefined && output !== undefined) {
    events.push({
      type: 'usage',
      usage: {
        input: start.input,
        output,
        cacheRead: start.cacheRead,
        cacheWrite: start.cacheWrite,
      },
    })
  }

  const stop = event.delta?.stop_reason
  const reason = stop === undefined ? undefined : STOP_REASONS[stop]

  // A stop reason added upstream must not discard an already-streamed response: emit no
  // finish_reason and let the runner finalize on what it has, as the other transports do.
  if (stop !== undefined && reason === undefined) {
    logger.warn('ai.unknown_stop_reason', { stopReason: stop })
  }

  // A safety classifier's decline arrives as a normal stop; its category is the only record of why.
  if (reason === 'content_filter') {
    logger.warn('ai.provider_refusal', {
      category: event.delta?.stop_details?.category ?? null,
    })
  }

  if (reason) {
    events.push({ type: 'finish_reason', reason })
  }

  return events
}

// message_start carries the input side of the bill; output is not known until message_delta.
// A non-integer/negative input_tokens makes the whole event untrustworthy, so drop it and let the
// runner estimate. input_tokens already excludes cache reads (the uncached-only TokenUsage.input shape).
function parseStartUsage(usage: AnthropicUsage): StartUsage | undefined {
  const input = parseTokenCount(usage.input_tokens)

  if (input === undefined) {
    return undefined
  }

  return {
    input,
    cacheRead: parseTokenCount(usage.cache_read_input_tokens) ?? 0,
    cacheWrite: parseTokenCount(usage.cache_creation_input_tokens) ?? 0,
  }
}
