import type { SseRouter } from '@/ai/adapters/runner'
import type { ChainEntry, Transport } from '@/ai/types'
import type { LLMMessage, LLMRequest, ReasoningReplayBlock } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { StreamEvent, TokenUsage } from '@/core/stream-events'
import type { ToolSchema } from '@/core/tool'
import { resolveAuthHeaders } from '@/ai/adapters/auth-headers'
import { classifyStreamFrame, truncatedStreamError } from '@/ai/adapters/errors'
import { canEnforceContract, toOpenAiStrictSubset } from '@/ai/adapters/openai/strict-schema'
import { parseSseJson, parseTokenCount, resolveEndpointUrl, runStream } from '@/ai/adapters/runner'
import { attributionHeaders } from '@/ai/auth/attribution'
import { describeWithExamples } from '@/core/tool'
import { textOf, toolCallsOf } from '@/core/utils/message'

const TRANSPORT_NAME = 'openai_responses'
const RESPONSES_PATH = 'responses'
const CACHE_KEY_MAX_CHARS = 64
// Responses-API `incomplete_details.reason` values with a core finish-reason equivalent.
const INCOMPLETE_FINISH_REASONS: Readonly<Record<string, 'length' | 'content_filter'>> = {
  max_output_tokens: 'length',
  content_filter: 'content_filter',
}
// The documented `error.code` values, as the status each would have carried had it failed the
// request outright. Anything else is left to the shared fallback.
const STREAM_ERROR_STATUSES: Readonly<Record<string, number>> = {
  invalid_prompt: 400,
  rate_limit_exceeded: 429,
  server_error: 500,
}
const NO_EVENTS: readonly StreamEvent[] = []
const DELTA_EVENTS: Readonly<Record<string, 'text_delta' | 'reasoning_delta'>> = {
  'response.output_text.delta': 'text_delta',
  'response.reasoning_summary_text.delta': 'reasoning_delta',
}

interface ResponsesEvent {
  readonly type?: string
  readonly delta?: string
  readonly item_id?: string
  // Present on the bare `error` event; `response.failed` carries the same pair under `response`.
  readonly code?: unknown
  readonly message?: unknown
  readonly item?: {
    readonly type?: string
    readonly id?: string
    readonly call_id?: string
    readonly name?: string
    readonly encrypted_content?: unknown
  }
  readonly response?: {
    readonly usage?: {
      readonly input_tokens?: unknown
      readonly output_tokens?: unknown
      readonly input_tokens_details?: { readonly cached_tokens?: unknown }
      readonly output_tokens_details?: { readonly reasoning_tokens?: unknown }
    }
    readonly incomplete_details?: { readonly reason?: unknown }
    readonly error?: { readonly code?: unknown; readonly message?: unknown }
  }
}

type WireItem = Record<string, unknown>

export const openaiResponsesTransport: Transport = {
  async stream(req, entry, onEvent) {
    const auth = await resolveAuthHeaders(req, entry)

    return await runStream({
      url: resolveEndpointUrl(entry.baseUrl, RESPONSES_PATH),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'openai-beta': 'responses=experimental',
          ...attributionHeaders(),
          ...auth,
        },
        body: JSON.stringify(buildBody(req, entry)),
        signal: req.signal,
      },
      router: responsesRouter(entry.logger),
      onEvent,
      logger: entry.logger,
      transportName: TRANSPORT_NAME,
      maxTokens: req.maxTokens,
      messages: req.messages,
    })
  },
}

function buildBody(req: LLMRequest, entry: ChainEntry): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: entry.model,
    instructions: instructionsOf(req.messages),
    input: toWireItems(req.messages),
    stream: true,
    store: false,
    // Nothing is stored server-side (store: false), so a reasoning model's chain of thought is lost
    // between tool turns unless the encrypted item is requested here and replayed on the next call.
    include: ['reasoning.encrypted_content'],
  }
  const tools = toWireTools(req.tools)

  if (entry.provider.supportsMaxTokens) {
    body.max_output_tokens = req.maxTokens
  }
  if (tools !== undefined && entry.provider.supportsTools) {
    body.tools = tools
  }
  if (req.routingKey !== undefined) {
    body.prompt_cache_key = req.routingKey.slice(0, CACHE_KEY_MAX_CHARS)
  }

  Object.assign(body, entry.reasoningResolution.request)
  applyResponsesOutputContract(body, req, entry)

  return body
}

// Responses-API form of the contract the chat transport applies (adapters/openai/reasoning.ts).
// Both transports read one applicability rule, so a tool-bearing run keeps or loses its contract
// for the same reason on either wire.
function applyResponsesOutputContract(
  body: Record<string, unknown>,
  req: LLMRequest,
  entry: ChainEntry
): void {
  const contract = req.outputContract

  if (contract === undefined || !canEnforceContract(req, entry.provider.id)) {
    return
  }

  body.text = {
    format: {
      type: 'json_schema',
      name: contract.name,
      schema: toOpenAiStrictSubset(contract.schema),
      strict: true,
    },
  }
}

function instructionsOf(messages: readonly LLMMessage[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => textOf(message.content, '\n'))
    .join('\n')
}

function toWireItems(messages: readonly LLMMessage[]): readonly WireItem[] {
  return messages.flatMap((message) => toWireMessage(message))
}

function toWireMessage(message: LLMMessage): readonly WireItem[] {
  if (message.role === 'system') {
    return []
  }

  if (message.role === 'tool') {
    return toWireToolResult(message)
  }

  const text = textOf(message.content, '\n')
  const items: WireItem[] =
    text === '' ? [] : [{ type: 'message', role: message.role, content: text }]

  for (const call of toolCallsOf(message)) {
    items.push({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.input ?? {}),
    })
  }

  // An orphaned reasoning item (nothing left to precede once compaction drops the whole turn) has
  // no item to attach to on replay, so it is dropped along with the rest of the message.
  if (message.role !== 'assistant' || items.length === 0) {
    return items
  }

  return [...reasoningItemsOf(message), ...items]
}

function reasoningItemsOf(message: LLMMessage): readonly WireItem[] {
  const items: WireItem[] = []

  for (const block of message.reasoningBlocks ?? []) {
    if (block.type === 'openai_reasoning_item') {
      items.push({ type: 'reasoning', encrypted_content: block.encrypted, summary: [] })
    }
  }

  return items
}

function toWireToolResult(message: LLMMessage): readonly WireItem[] {
  const callId = message.toolCallId

  if (callId === undefined) {
    return []
  }

  const output = textOf(message.content, '\n')

  return [
    {
      type: 'function_call_output',
      call_id: callId,
      output: message.isError === true ? JSON.stringify({ error: output }) : output,
    },
  ]
}

function toWireTools(tools: readonly ToolSchema[] | undefined): readonly WireItem[] | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined
  }

  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: describeWithExamples(tool),
    parameters: tool.parameters,
  }))
}

function responsesRouter(logger: Logger): SseRouter {
  const openCalls = new Map<string, string>()
  const reasoningBlocks: ReasoningReplayBlock[] = []
  const progress = { completed: false }

  return {
    route(data): readonly StreamEvent[] {
      const event = parseSseJson<ResponsesEvent>(data, TRANSPORT_NAME, logger)

      if (event === undefined) {
        return NO_EVENTS
      }

      collectReasoningBlock(event, reasoningBlocks, logger)

      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        progress.completed = true
      }

      return routeEvent(event, openCalls, logger)
    },
    finish(): readonly StreamEvent[] {
      if (!progress.completed) {
        throw truncatedStreamError(TRANSPORT_NAME)
      }

      return NO_EVENTS
    },
    replayBlocks(): readonly ReasoningReplayBlock[] {
      return reasoningBlocks
    },
  }
}

function collectReasoningBlock(
  event: ResponsesEvent,
  out: ReasoningReplayBlock[],
  logger: Logger
): void {
  if (event.type !== 'response.output_item.done' || event.item?.type !== 'reasoning') {
    return
  }

  const encrypted = event.item.encrypted_content

  if (typeof encrypted === 'string') {
    out.push({ type: 'openai_reasoning_item', encrypted })
    return
  }

  // Silent otherwise: no HTTP error, the turn still answers, and reasoning replay just does
  // nothing next turn — indistinguishable from "the model didn't reason" without this warning.
  logger.warn('adapter.reasoning_item_missing_encrypted_content', { transport: TRANSPORT_NAME })
}

function routeEvent(
  event: ResponsesEvent,
  openCalls: Map<string, string>,
  logger: Logger
): readonly StreamEvent[] {
  if (event.type === undefined) {
    return NO_EVENTS
  }

  const delta = DELTA_EVENTS[event.type]

  if (delta !== undefined && event.delta !== undefined) {
    return [{ type: delta, delta: event.delta }]
  }

  if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
    return startToolCall(event, openCalls)
  }

  if (event.type === 'response.function_call_arguments.delta') {
    return toolCallArgsDelta(event, openCalls)
  }

  if (event.type === 'response.completed' || event.type === 'response.incomplete') {
    return completionEvents(event, logger)
  }

  if (event.type === 'response.failed') {
    const error = event.response?.error

    throw classifyStreamFrame(error?.code, STREAM_ERROR_STATUSES, error?.message)
  }

  // A mid-stream failure the API reports without failing the response; unrouted it ends the stream
  // with no content, which the chain reads as an empty answer rather than the stated fault.
  if (event.type === 'error') {
    throw classifyStreamFrame(event.code, STREAM_ERROR_STATUSES, event.message)
  }

  return NO_EVENTS
}

function startToolCall(
  event: ResponsesEvent,
  openCalls: Map<string, string>
): readonly StreamEvent[] {
  const id = event.item?.call_id ?? event.item_id
  const name = event.item?.name

  if (id === undefined || name === undefined) {
    return NO_EVENTS
  }

  // The `added` event carries no top-level `item_id`: its own id lives at `item.id` (`fc_...`), and
  // that is what the later argument deltas key on. `item_id` is kept as a fallback for a host that
  // sends the flatter shape.
  const itemId = event.item?.id ?? event.item_id

  if (itemId !== undefined) {
    openCalls.set(itemId, id)
  }

  return [{ type: 'tool_call_start', id, name }]
}

function toolCallArgsDelta(
  event: ResponsesEvent,
  openCalls: Map<string, string>
): readonly StreamEvent[] {
  const id = event.item_id === undefined ? undefined : openCalls.get(event.item_id)

  return id === undefined || event.delta === undefined
    ? NO_EVENTS
    : [{ type: 'tool_call_args_delta', id, delta: event.delta }]
}

// Only mapped reasons are emitted: the runner infers `tool_use` when tool calls were seen and
// `stop` otherwise, and an explicit `stop` here would override that inference and strand the tool
// calls.
function completionEvents(event: ResponsesEvent, logger: Logger): readonly StreamEvent[] {
  const usage = toUsage(event)
  const events: StreamEvent[] = usage === undefined ? [] : [{ type: 'usage', usage }]
  const reason = event.response?.incomplete_details?.reason

  if (typeof reason !== 'string') {
    return events
  }

  const mapped = INCOMPLETE_FINISH_REASONS[reason]

  if (mapped === undefined) {
    logger.warn('adapter.responses_unmapped_incomplete_reason', {
      transport: TRANSPORT_NAME,
      reason,
    })
    return events
  }

  events.push({ type: 'finish_reason', reason: mapped })
  return events
}

// Both input and output are required: a Responses usage block missing either is untrustworthy, so
// the whole event is dropped and the runner falls back to its estimator instead of billing zero.
function toUsage(event: ResponsesEvent): TokenUsage | undefined {
  const usage = event.response?.usage
  const input = parseTokenCount(usage?.input_tokens)
  const output = parseTokenCount(usage?.output_tokens)

  if (input === undefined || output === undefined) {
    return undefined
  }

  const cacheRead = parseTokenCount(usage?.input_tokens_details?.cached_tokens)
  const reasoning = parseTokenCount(usage?.output_tokens_details?.reasoning_tokens)

  return {
    // input_tokens counts cached tokens too; TokenUsage.input is uncached-only, so that cache reads
    // are billed once at their own rate rather than twice.
    input: Math.max(0, input - (cacheRead ?? 0)),
    output,
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(reasoning === undefined ? {} : { reasoning }),
  }
}
