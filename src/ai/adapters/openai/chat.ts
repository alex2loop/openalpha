import type { SseRouter } from '@/ai/adapters/runner'
import type { ChainEntry, Transport } from '@/ai/types'
import type { LLMMessage, LLMRequest } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { StreamEvent, TokenUsage } from '@/core/stream-events'
import type { ToolSchema } from '@/core/tool'
import { resolveAuthHeaders } from '@/ai/adapters/auth-headers'
import {
  classifyStreamError,
  truncatedStreamError,
  unwrapOpenRouterBody,
} from '@/ai/adapters/errors'
import { toChatDecisions } from '@/ai/adapters/openai/decisions-chat'
import { chatFinishEvents } from '@/ai/adapters/openai/finish'
import { isMoonshotModel, toMoonshotSchema } from '@/ai/adapters/openai/moonshot-schema'
import { logOpenRouterMetadata } from '@/ai/adapters/openai/openrouter-metadata'
import { applyOpenRouterRequest } from '@/ai/adapters/openai/openrouter-request'
import { isOpenRouterHost } from '@/ai/adapters/openai/openrouter-routing'
import {
  applyAssistantReasoningReplay,
  applyOpenAiOutputContract,
} from '@/ai/adapters/openai/reasoning'
import {
  flushPending,
  type OpenAiToolDelta,
  type PartialToolCall,
  routeToolCall,
} from '@/ai/adapters/openai/tool-call-stream'
import { parseSseJson, parseTokenCount, resolveEndpointUrl, runStream } from '@/ai/adapters/runner'
import { toWireToolCallId } from '@/ai/adapters/tool-call-id'
import { describeWithExamples } from '@/core/tool'
import { textOf, toolCallsOf } from '@/core/utils/message'

const TRANSPORT_NAME = 'openai'
const DONE_SENTINEL = '[DONE]'
const NO_EVENTS: readonly StreamEvent[] = []
const OPENROUTER_METADATA_HEADER = 'X-OpenRouter-Metadata'
const OPENROUTER_METADATA_ENABLED = 'enabled'
const OPENROUTER_REASONING_DETAIL_TYPES: ReadonlySet<string> = new Set([
  'reasoning.encrypted',
  'reasoning.summary',
  'reasoning.text',
])

// o-series reasoning models reject `max_tokens` and the `system` role; deepseek-reasoner keeps
// `system` but shares the `max_completion_tokens` requirement.
const REASONING_MODEL_RE = /^(?:deepseek-reasoner|gpt-5|o[1-9])/
const DEVELOPER_ROLE_RE = /^(?:gpt-5|o[1-9])/

interface OpenAiUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number
    readonly cache_write_tokens?: number
  }
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number }
  // DeepSeek reports cache hits at the top level rather than under prompt_tokens_details.
  readonly prompt_cache_hit_tokens?: number
  // OpenRouter: billed USD, requested via `usage: { include: true }`.
  readonly cost?: number
}

interface OpenAiChunk {
  readonly error?: { readonly code?: unknown }
  readonly choices?: ReadonlyArray<{
    readonly delta?: {
      readonly content?: string
      readonly tool_calls?: readonly OpenAiToolDelta[]
      readonly reasoning?: string
      readonly reasoning_content?: string
      readonly reasoning_details?: unknown
    }
    readonly finish_reason?: string | null
  }>
  readonly usage?: OpenAiUsage
  readonly openrouter_metadata?: unknown
}

interface WireMessageOptions {
  readonly systemRole: 'system' | 'developer'
  readonly replay: ChainEntry['reasoningResolution']['replay']
  readonly toolCallIdLength?: number
}

interface WireMessageInput extends WireMessageOptions {
  readonly message: LLMMessage
}

type WireMessage = Record<string, unknown>

interface OpenAiRouterState {
  readonly logger: Logger
  readonly byIndex: Map<number, PartialToolCall>
  readonly captureReasoningDetails: boolean
  readonly reasoningDetails: Readonly<Record<string, unknown>>[]
  readonly seenReasoningDetails: Set<string>
  routingMetadataLogged: boolean
  ended: boolean
}

export const openaiTransport: Transport = {
  async stream(req, entry, onEvent) {
    const isOpenRouter = isOpenRouterHost(entry.baseUrl)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(await resolveAuthHeaders(req, entry)),
      ...(isOpenRouter ? { [OPENROUTER_METADATA_HEADER]: OPENROUTER_METADATA_ENABLED } : {}),
    }

    return await runStream({
      url: resolveEndpointUrl(entry.baseUrl, 'chat/completions'),
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody(req, entry)),
        signal: req.signal,
      },
      router: openaiRouter(entry.logger, entry.reasoningResolution.replay === 'openrouter'),
      onEvent,
      logger: entry.logger,
      transportName: TRANSPORT_NAME,
      maxTokens: req.maxTokens,
      messages: req.messages,
      reasoningTextReplay: entry.reasoningResolution.replay,
    })
  },
}

function buildBody(req: LLMRequest, entry: ChainEntry): WireMessage {
  const leaf = modelLeaf(entry.model)
  const isReasoningModel = REASONING_MODEL_RE.test(leaf)
  const systemRole = DEVELOPER_ROLE_RE.test(leaf) ? 'developer' : 'system'
  const isOpenRouter = isOpenRouterHost(entry.baseUrl)
  // A decisions request carries questions rather than a conversation; the schema is mandatory
  // there, because without it a small model answers in prose.
  const asked = toChatDecisions(req, entry.provider.id)
  const { toolCallIdLength } = entry.provider
  const messages = toWireMessages(asked.messages, {
    systemRole,
    replay: entry.reasoningResolution.replay,
    ...(toolCallIdLength === undefined ? {} : { toolCallIdLength }),
  })
  const body: WireMessage = {
    model: entry.model,
    messages,
    stream: true,
    ...(asked.responseFormat === undefined ? {} : { response_format: asked.responseFormat }),
    ...(isReasoningModel
      ? { max_completion_tokens: req.maxTokens }
      : { max_tokens: req.maxTokens }),
  }

  if (entry.provider.supportsStreamOptions) {
    body.stream_options = { include_usage: true }
  }

  if (isOpenRouter) {
    applyOpenRouterRequest(body, { req, entry, messages })
  }

  const tools = toWireTools(req.tools, entry.model)

  if (tools && entry.provider.supportsTools) {
    body.tools = tools
  }

  Object.assign(body, entry.reasoningResolution.request)
  applyOpenAiOutputContract(body, req, entry)

  return body
}

function toWireMessages(
  messages: readonly LLMMessage[],
  options: WireMessageOptions
): readonly WireMessage[] {
  const out: WireMessage[] = []

  for (const message of messages) {
    const wire = toWireMessage({ message, ...options })

    if (wire) {
      out.push(wire)
    }
  }

  return out
}

function toWireMessage(input: WireMessageInput): WireMessage | undefined {
  const { message, systemRole, replay, toolCallIdLength } = input

  if (message.role === 'tool') {
    if (message.toolCallId === undefined) {
      return undefined
    }

    const content = textOf(message.content, '\n')

    return {
      role: 'tool',
      tool_call_id: toWireToolCallId(message.toolCallId, toolCallIdLength),
      content: message.isError === true ? JSON.stringify({ error: content }) : content,
    }
  }

  if (message.role === 'system') {
    return { role: systemRole, content: textOf(message.content, '\n') }
  }

  const calls = toolCallsOf(message)

  if (message.role !== 'assistant' || calls.length === 0) {
    return { role: message.role, content: textOf(message.content, '\n') }
  }

  const wire: WireMessage = {
    role: 'assistant',
    content: textOf(message.content, '\n'),
    tool_calls: calls.map((call) => ({
      id: toWireToolCallId(call.id, toolCallIdLength),
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
    })),
  }

  applyAssistantReasoningReplay(wire, message, replay)
  return wire
}

function toWireTools(
  tools: readonly ToolSchema[] | undefined,
  model: string
): readonly WireMessage[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  const moonshot = isMoonshotModel(model)

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: describeWithExamples(tool),
      parameters: moonshot ? toMoonshotSchema(tool.parameters) : tool.parameters,
    },
  }))
}

function openaiRouter(logger: Logger, captureReasoningDetails: boolean): SseRouter {
  const state: OpenAiRouterState = {
    logger,
    byIndex: new Map(),
    captureReasoningDetails,
    reasoningDetails: [],
    seenReasoningDetails: new Set(),
    routingMetadataLogged: false,
    ended: false,
  }

  return {
    route(data) {
      if (data === DONE_SENTINEL) {
        state.ended = true
        return flushPending(state.byIndex)
      }

      const chunk = parseSseJson<OpenAiChunk>(data, TRANSPORT_NAME, logger)

      // Unrouted, an error frame leaves the stream empty with no stated cause.
      if (chunk?.error) {
        const status = typeof chunk.error.code === 'number' ? chunk.error.code : undefined

        throw classifyStreamError(status, unwrapOpenRouterBody(data))
      }

      if (chunk && !state.routingMetadataLogged) {
        state.routingMetadataLogged = logOpenRouterMetadata(logger, chunk.openrouter_metadata)
      }

      return chunk ? routeChunk(chunk, state) : NO_EVENTS
    },
    finish() {
      if (!state.ended) {
        throw truncatedStreamError(TRANSPORT_NAME)
      }

      return flushPending(state.byIndex)
    },
    replayBlocks() {
      return state.reasoningDetails.map((detail) => ({
        type: 'openrouter_reasoning_detail',
        detail,
      }))
    },
  }
}

function routeChunk(chunk: OpenAiChunk, state: OpenAiRouterState): readonly StreamEvent[] {
  const choice = chunk.choices?.[0]
  const delta = choice?.delta
  const events: StreamEvent[] = []

  if (delta?.content) {
    events.push({ type: 'text_delta', delta: delta.content })
  }

  // DeepSeek and OpenRouter disagree on the field name for the same content.
  const reasoning = delta?.reasoning ?? delta?.reasoning_content

  if (reasoning) {
    events.push({ type: 'reasoning_delta', delta: reasoning })
  }

  if (state.captureReasoningDetails) {
    collectReasoningDetails(state, delta?.reasoning_details)
  }

  for (const call of delta?.tool_calls ?? []) {
    events.push(...routeToolCall(call, state.byIndex))
  }

  if (chunk.usage) {
    const usage = mapUsage(chunk.usage)

    if (usage !== undefined) {
      events.push({ type: 'usage', usage })
    }
  }

  const reason = choice?.finish_reason

  if (reason) {
    state.ended = true
    events.push(...chatFinishEvents(reason, state.logger))
  }

  return events
}

function collectReasoningDetails(state: OpenAiRouterState, value: unknown): void {
  if (!Array.isArray(value)) {
    return
  }

  for (const detail of value) {
    if (!isReasoningDetail(detail)) {
      continue
    }

    const key = JSON.stringify(detail)

    if (!state.seenReasoningDetails.has(key)) {
      state.seenReasoningDetails.add(key)
      state.reasoningDetails.push(detail)
    }
  }
}

function isReasoningDetail(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return (
    'type' in value &&
    typeof value.type === 'string' &&
    OPENROUTER_REASONING_DETAIL_TYPES.has(value.type)
  )
}

function modelLeaf(model: string): string {
  return model.split('/').at(-1) ?? model
}

// Both input and output are required: an OpenAI usage chunk missing either is untrustworthy, so the
// whole event is dropped and the runner falls back to its estimator instead of billing zero.
function mapUsage(usage: OpenAiUsage): TokenUsage | undefined {
  const input = parseTokenCount(usage.prompt_tokens)
  const output = parseTokenCount(usage.completion_tokens)

  if (input === undefined || output === undefined) {
    return undefined
  }

  const details = usage.prompt_tokens_details
  const cacheRead = parseTokenCount(details?.cached_tokens ?? usage.prompt_cache_hit_tokens) ?? 0
  const cacheWrite = parseTokenCount(details?.cache_write_tokens) ?? 0
  const reasoning = parseTokenCount(usage.completion_tokens_details?.reasoning_tokens)
  // Negative/non-finite provider cost is dropped; the billing cascade falls through to the table.
  const costUsd =
    typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0
      ? usage.cost
      : undefined

  return {
    // prompt_tokens counts cache reads and writes too; TokenUsage.input is uncached-only, so each
    // is billed once at its own rate rather than twice.
    input: Math.max(0, input - cacheRead - cacheWrite),
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}
