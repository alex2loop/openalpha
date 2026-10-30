import type { SseRouter } from '@/ai/adapters/runner'
import type { ChainEntry, Transport } from '@/ai/types'
import type { LLMMessage, LLMRequest, ReasoningReplayBlock } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { FinishReason, StreamEvent, TokenUsage } from '@/core/stream-events'
import type { ToolSchema } from '@/core/tool'
import { classifyStreamFrame, truncatedStreamError } from '@/ai/adapters/errors'
import {
  keyedHeaders,
  parseSseJson,
  parseTokenCount,
  resolveEndpointUrl,
  runStream,
} from '@/ai/adapters/runner'
import { buildToolCallId } from '@/ai/adapters/tool-call-id'
import { describeWithExamples } from '@/core/tool'
import { contentBlocks, textOf, toolCallsOf } from '@/core/utils/message'

const TRANSPORT_NAME = 'gemini'
const NO_EVENTS: readonly StreamEvent[] = []
// Google's documented stand-in for a call another model made, which carries no thought signature.
const UNSIGNED_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

// A mid-stream failure arrives as an `event_type: error` frame rather than an HTTP status; unrouted
// it would end the stream as a bare empty answer. Only part of the code vocabulary is documented,
// so an unlisted one falls back to a server fault, which is what the chain fails over on.
const STREAM_ERROR_STATUSES: Readonly<Record<string, number>> = {
  invalid_request: 400,
  not_found: 404,
  gateway_timeout: 504,
}

// functionDeclarations.parameters take an OpenAPI-3.0 subset and reject JSON-Schema-only keywords,
// both of which zod's JSON Schema emitter produces.
const UNSUPPORTED_SCHEMA_KEYS: ReadonlySet<string> = new Set(['$schema', 'additionalProperties'])

const FINISH_REASONS: Readonly<Record<string, FinishReason>> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  BLOCKLIST: 'content_filter',
}

interface GeminiPart {
  readonly text?: string
  readonly thought?: boolean
  readonly thoughtSignature?: string
  readonly functionCall?: {
    readonly id?: string
    readonly name?: string
    readonly args?: unknown
  }
}

interface GeminiUsage {
  readonly promptTokenCount?: number
  readonly candidatesTokenCount?: number
  readonly cachedContentTokenCount?: number
  readonly thoughtsTokenCount?: number
}

interface GeminiChunk {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: readonly GeminiPart[] }
    readonly finishReason?: string
  }>
  readonly usageMetadata?: GeminiUsage
  /** Set, with no candidate, when the prompt itself was blocked. */
  readonly promptFeedback?: { readonly blockReason?: string }
  readonly event_type?: string
  readonly error?: { readonly code?: unknown; readonly message?: unknown }
}

interface GeminiContent {
  readonly role: 'user' | 'model'
  readonly parts: readonly Record<string, unknown>[]
}

interface RouterState {
  readonly reasoningBlocks: ReasoningReplayBlock[]
  sawToolCall: boolean
  finished: boolean
}

export const geminiTransport: Transport = {
  stream(req, entry, onEvent) {
    const path = `models/${encodeURIComponent(entry.model)}:streamGenerateContent?alt=sse`

    return runStream({
      url: resolveEndpointUrl(entry.baseUrl, path),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...keyedHeaders(entry.apiKey, { 'x-goog-api-key': entry.apiKey }),
        },
        body: JSON.stringify(buildBody(req, entry)),
        signal: req.signal,
      },
      router: geminiRouter(entry.logger),
      onEvent,
      logger: entry.logger,
      transportName: TRANSPORT_NAME,
      maxTokens: req.maxTokens,
      messages: req.messages,
    })
  },
}

function buildBody(req: LLMRequest, entry: ChainEntry): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens }
  Object.assign(generationConfig, entry.reasoningResolution.request)

  const body: Record<string, unknown> = {
    contents: toGeminiContents(req.messages),
    generationConfig,
  }
  const system = systemInstruction(req.messages)
  const tools = toGeminiTools(req.tools)

  if (system) {
    body.systemInstruction = system
  }

  if (tools && entry.provider.supportsTools) {
    body.tools = tools
  }

  return body
}

function systemInstruction(
  messages: readonly LLMMessage[]
): { readonly parts: readonly { readonly text: string }[] } | undefined {
  const text = messages
    .filter((message) => message.role === 'system')
    .map((message) => textOf(message.content, '\n'))
    .filter((part) => part !== '')
    .join('\n')

  return text === '' ? undefined : { parts: [{ text }] }
}

function toGeminiContents(messages: readonly LLMMessage[]): readonly GeminiContent[] {
  const callNames = toolCallNames(messages)
  const out: GeminiContent[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    if (message.role === 'tool') {
      if (message.toolCallId !== undefined) {
        out.push(toolResponseContent(message, callNames))
      }
    } else if (message.role === 'assistant') {
      out.push(assistantContent(message))
    } else {
      out.push({ role: 'user', parts: [{ text: textOf(message.content, '\n') }] })
    }
  }

  return out
}

// functionResponse is keyed by the function's NAME, not the call id, so results must be matched
// back to the assistant turn that requested them.
function toolCallNames(messages: readonly LLMMessage[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>()

  for (const message of messages) {
    for (const call of toolCallsOf(message)) {
      names.set(call.id, call.name)
    }
  }

  return names
}

function toolResponseContent(
  message: LLMMessage,
  callNames: ReadonlyMap<string, string>
): GeminiContent {
  const id = message.toolCallId ?? ''
  const name = callNames.get(id) ?? id
  const text = textOf(message.content, '\n')
  const response = message.isError === true ? { error: text } : { result: text }

  return { role: 'user', parts: [{ functionResponse: { id, name, response } }] }
}

function assistantContent(message: LLMMessage): GeminiContent {
  const parts: Record<string, unknown>[] = []

  for (const block of contentBlocks(message.content)) {
    if (block.type === 'text') {
      if (block.text !== '') {
        parts.push({ text: block.text })
      }
    } else {
      const signature = thoughtSignatureFor(message, block.call.id)
      parts.push({
        functionCall: {
          id: block.call.id,
          name: block.call.name,
          args: block.call.input ?? {},
        },
        thoughtSignature: signature ?? UNSIGNED_THOUGHT_SIGNATURE,
      })
    }
  }

  // Gemini rejects a content entry with no parts.
  return { role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] }
}

function thoughtSignatureFor(message: LLMMessage, callId: string): string | undefined {
  for (const block of message.reasoningBlocks ?? []) {
    if (block.type === 'gemini_thought_signature' && block.callId === callId) {
      return block.signature
    }
  }

  return undefined
}

function toGeminiTools(
  tools: readonly ToolSchema[] | undefined
): readonly Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: describeWithExamples(tool),
        parameters: sanitizeSchema(tool.parameters),
      })),
    },
  ]
}

function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema)
  }

  if (schema === null || typeof schema !== 'object') {
    return schema
  }

  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    if (!UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      out[key] = sanitizeSchema(value)
    }
  }

  return out
}

function geminiRouter(logger: Logger): SseRouter {
  const state: RouterState = {
    reasoningBlocks: [],
    sawToolCall: false,
    finished: false,
  }

  return {
    route(data) {
      const chunk = parseSseJson<GeminiChunk>(data, TRANSPORT_NAME, logger)

      return chunk ? routeChunk(chunk, state) : NO_EVENTS
    },
    finish() {
      if (!state.finished) {
        throw truncatedStreamError(TRANSPORT_NAME)
      }

      return NO_EVENTS
    },
    replayBlocks() {
      return state.reasoningBlocks
    },
  }
}

function routeChunk(chunk: GeminiChunk, state: RouterState): readonly StreamEvent[] {
  if (chunk.event_type === 'error') {
    throw classifyStreamFrame(chunk.error?.code, STREAM_ERROR_STATUSES, chunk.error?.message)
  }

  const candidate = chunk.candidates?.[0]
  const events: StreamEvent[] = []

  for (const part of candidate?.content?.parts ?? []) {
    events.push(...routePart(part, state))
  }

  if (chunk.usageMetadata) {
    const usage = mapUsage(chunk.usageMetadata)

    if (usage !== undefined) {
      events.push({ type: 'usage', usage })
    }
  }

  // A blocked prompt streams no candidate, so its block reason is the stream's end: read as a
  // filter, not as a cut stream that a retry or a cooldown could fix.
  if (chunk.promptFeedback?.blockReason !== undefined && candidate === undefined) {
    state.finished = true
    events.push({ type: 'finish_reason', reason: 'content_filter' })

    return events
  }

  const reason = candidate?.finishReason
  const mapped = reason === undefined ? undefined : FINISH_REASONS[reason]

  if (reason !== undefined) {
    state.finished = true
  }

  // Gemini reports STOP even alongside a functionCall; suppressing it lets the runner default to
  // `tool_use` so the loop actually runs the tool the model asked for.
  if (mapped && !(state.sawToolCall && mapped === 'stop')) {
    events.push({ type: 'finish_reason', reason: mapped })
  }

  return events
}

function routePart(part: GeminiPart, state: RouterState): readonly StreamEvent[] {
  if (part.functionCall?.name) {
    // Gemini omits the call id on some models. A minted one must be unique across turns, not just
    // within a response: ledger idempotency keys and compaction both key on it.
    const id = part.functionCall.id ?? buildToolCallId()
    state.sawToolCall = true
    collectThoughtSignature(state, part, id)

    // The whole call arrives in one part; the start/args pair keeps the shape uniform with the
    // other two transports rather than reflecting any incremental delivery.
    return [
      { type: 'tool_call_start', id, name: part.functionCall.name },
      { type: 'tool_call_args_delta', id, delta: JSON.stringify(part.functionCall.args ?? {}) },
    ]
  }

  if (!part.text) {
    return NO_EVENTS
  }

  return [{ type: part.thought === true ? 'reasoning_delta' : 'text_delta', delta: part.text }]
}

function collectThoughtSignature(state: RouterState, part: GeminiPart, callId: string): void {
  const signature = part.thoughtSignature

  if (signature === undefined || signature === '') {
    return
  }

  state.reasoningBlocks.push({
    type: 'gemini_thought_signature',
    signature,
    callId,
  })
}

// Both input and output are required; a Gemini usage block missing either is untrustworthy, so the
// whole event is dropped and the runner estimates instead of billing zero.
function mapUsage(usage: GeminiUsage): TokenUsage | undefined {
  const input = parseTokenCount(usage.promptTokenCount)
  const outputBase = parseTokenCount(usage.candidatesTokenCount)
  const thoughts = parseTokenCount(usage.thoughtsTokenCount) ?? 0

  if (input === undefined || outputBase === undefined) {
    return undefined
  }

  const cacheRead = parseTokenCount(usage.cachedContentTokenCount) ?? 0

  return {
    // promptTokenCount counts cached tokens too; TokenUsage.input is uncached-only, so that cache
    // reads are billed once at their own rate rather than twice.
    input: Math.max(0, input - cacheRead),
    // Gemini bills thinking as output but reports it apart from candidatesTokenCount.
    output: outputBase + thoughts,
    cacheRead,
    ...(thoughts > 0 ? { reasoning: thoughts } : {}),
  }
}
