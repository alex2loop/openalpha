import type { ReasoningReplayProtocol } from '@/ai/reasoning/resolve'
import type { ContentBlock, LLMMessage, LLMResponse, ReasoningReplayBlock } from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { FinishReason, OnStreamEvent, StreamEvent, TokenUsage } from '@/core/stream-events'
import { classifyNetworkError } from '@/ai/adapters/errors'
import { openSseStream } from '@/ai/adapters/http'
import { sseScanner } from '@/ai/adapters/sse'
import { parseToolArgs } from '@/ai/adapters/tool-args'
import { abortError, attachAttemptUsage, LLMError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'
import { estimateTextTokens } from '@/core/stream-events'

const TRAILING_SLASH_RE = /\/$/
const MALFORMED_PREVIEW_CHARS = 120
// Catches a provider that ignores `max_tokens` and streams without end, so it has to sit above what
// the authorized budget can legitimately produce: SSE framing costs several hundred bytes per token,
// and a fixed ceiling meets a large reasoning budget long before any runaway reaches it.
const STREAM_BYTES_PER_TOKEN = 1024
const STREAM_MIN_BYTES = 4_194_304

// Per-transport translation of one SSE payload into core stream events. Stateful: it carries the
// open content blocks / partial tool calls that only make sense within a single response.
export interface SseRouter {
  route(data: string): readonly StreamEvent[]
  // Events owed at end-of-stream (e.g. an OpenAI tool call whose args never got a start signal).
  finish(): readonly StreamEvent[]
  // Complete hidden protocol blocks owed after parsing. They never reach surfaces as stream events.
  replayBlocks?(): readonly ReasoningReplayBlock[]
}

interface RunStreamOptions {
  readonly url: string
  readonly init: RequestInit
  readonly router: SseRouter
  readonly onEvent: OnStreamEvent
  readonly logger: Logger
  readonly transportName: string
  /** The request's own output ceiling, which is what the stream's byte cap is measured against. */
  readonly maxTokens: number
  /** Exact request messages — the estimator's input-token basis when the provider sends no usage. */
  readonly messages?: readonly LLMMessage[]
  readonly reasoningTextReplay?: ReasoningReplayProtocol
}

interface MutableUsage {
  input: number
  output: number
  /** Uncached input plus cache reads — the merge key `input` is re-derived from. */
  promptTotal: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  costUsd?: number
}

// A counter is trustworthy only if it is a non-negative safe integer — `1e400`, `NaN`, `Infinity`,
// floats and negatives are all rejected, so a poisoned wire value can never reach the ledger.
export function parseTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

interface PendingTool {
  readonly id: string
  readonly name: string
  args: string
}

interface StreamState {
  text: string
  reasoning: string
  readonly reasoningBlocks: ReasoningReplayBlock[]
  readonly tools: Map<string, PendingTool>
  readonly order: string[]
  readonly usage: MutableUsage
  // Separates a stream the provider closed without sending anything from one that streamed frames
  // the router had no use for. An empty response is otherwise indistinguishable between the two.
  frames: number
  // True once any trustworthy provider usage event was applied — the estimator runs only when false.
  usageSeen: boolean
  usageFinalized: boolean
  finishReason?: FinishReason
}

type EmitFn = (events: readonly StreamEvent[]) => void
type RouteFn = (payloads: readonly string[]) => void

export function resolveEndpointUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(TRAILING_SLASH_RE, '')}/`).toString()
}

// A keyless local server gets no auth header at all; an empty bearer is malformed to some hosts.
export function keyedHeaders(
  apiKey: string,
  headers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return apiKey === '' ? {} : headers
}

// One malformed frame must never kill a stream that is otherwise delivering tokens.
export function parseSseJson<T>(data: string, where: string, logger: Logger): T | undefined {
  try {
    // A frame that does not match yields undefined fields, not a throw.
    // why-safe: T is always a wire shape whose every field is optional; the router narrows first.
    return JSON.parse(data) as T
  } catch {
    logger.warn('sse.malformed_event', {
      where,
      preview: scrubCredentials(data.slice(0, MALFORMED_PREVIEW_CHARS)),
    })
    return undefined
  }
}

export async function runStream(options: RunStreamOptions): Promise<LLMResponse> {
  const state = createStreamState()
  const emit: EmitFn = (events) => {
    for (const event of events) {
      applyEvent(state, event)
      options.onEvent(event)
    }
  }
  const route: RouteFn = (payloads) => {
    for (const data of payloads) {
      state.frames += 1
      emit(options.router.route(data))
    }
  }

  try {
    const stream = await openSseStream(options.url, options.init)

    await pump(stream, route, streamByteCap(options.maxTokens))
    emit(options.router.finish())
    state.reasoningBlocks.push(...(options.router.replayBlocks?.() ?? []))

    return finalize(state, options)
  } catch (err: unknown) {
    throw finalizeError(err, state, options)
  }
}

function streamByteCap(maxTokens: number): number {
  return Math.max(STREAM_MIN_BYTES, maxTokens * STREAM_BYTES_PER_TOKEN)
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  route: RouteFn,
  byteCap: number
): Promise<void> {
  const scanner = sseScanner()
  const reader = stream.getReader()
  let totalBytes = 0

  try {
    for (;;) {
      const { value, done } = await reader.read()

      if (done) {
        break
      }

      // Bytes, not decoded chars: a multi-byte stream can exceed a char-based ceiling unnoticed.
      totalBytes += value.byteLength

      if (totalBytes > byteCap) {
        throw new LLMError('response_too_large', 'stream exceeded local byte cap')
      }

      route(scanner.push(value))
    }

    route(scanner.flush())
  } catch (err: unknown) {
    // A connection dropped mid-stream surfaces here as a bare ECONNRESET, not as a status code.
    // Typing it lets the chain retry or fail over on it like any other transient provider fault.
    throw asStreamError(err)
  } finally {
    // Releases the socket whether the stream drained, threw, or the caller aborted.
    await reader.cancel().catch(() => undefined)
  }
}

function asStreamError(err: unknown): Error {
  if (err instanceof LLMError) {
    return err
  }

  return classifyNetworkError(err)
}

function createStreamState(): StreamState {
  return {
    text: '',
    reasoning: '',
    reasoningBlocks: [],
    tools: new Map(),
    order: [],
    usage: { input: 0, output: 0, promptTotal: 0, cacheRead: 0, cacheWrite: 0 },
    frames: 0,
    usageSeen: false,
    usageFinalized: false,
  }
}

function applyEvent(state: StreamState, event: StreamEvent): void {
  if (event.type === 'text_delta') {
    state.text += event.delta
    return
  }

  if (event.type === 'reasoning_delta') {
    state.reasoning += event.delta
    return
  }

  if (event.type === 'thinking_block') {
    state.reasoningBlocks.push(event.block)
    return
  }

  if (event.type === 'tool_call_start') {
    state.tools.set(event.id, { id: event.id, name: event.name, args: '' })
    state.order.push(event.id)
    return
  }

  if (event.type === 'tool_call_args_delta') {
    const tool = state.tools.get(event.id)

    if (tool) {
      tool.args += event.delta
    }

    return
  }

  if (event.type === 'usage') {
    mergeUsage(state.usage, event.usage)
    state.usageSeen = true
    return
  }

  // A trailing OpenRouter chunk can downgrade a mapped `tool_use` back to `stop`; keep the
  // stronger signal so the loop still runs the tools the model asked for.
  if (event.type === 'finish_reason' && state.finishReason !== 'tool_use') {
    state.finishReason = event.reason
  }
}

// Providers re-send cumulative counters mid-stream; max-merge so a later partial frame reporting 0
// cannot erase a count an earlier frame already established. `input` is not merged directly: it is
// reported uncached-only, so it shrinks as cache reads grow and max-merging both fields
// independently would sum a low-cache frame's input with a high-cache frame's cacheRead.
function mergeUsage(into: MutableUsage, usage: TokenUsage): void {
  const cacheRead = usage.cacheRead ?? 0

  into.promptTotal = Math.max(into.promptTotal, usage.input + cacheRead)
  into.cacheRead = Math.max(into.cacheRead, cacheRead)
  into.input = Math.max(0, into.promptTotal - into.cacheRead)
  into.output = Math.max(into.output, usage.output)
  into.cacheWrite = Math.max(into.cacheWrite, usage.cacheWrite ?? 0)

  if (usage.reasoning !== undefined) {
    into.reasoning = Math.max(into.reasoning ?? 0, usage.reasoning)
  }

  if (usage.costUsd !== undefined) {
    into.costUsd = Math.max(into.costUsd ?? 0, usage.costUsd)
  }
}

function finalize(state: StreamState, options: RunStreamOptions): LLMResponse {
  finalizeUsage(state, options)
  assertUsable(state, options.transportName)

  const content: ContentBlock[] = state.text === '' ? [] : [{ type: 'text', text: state.text }]

  for (const id of state.order) {
    const tool = state.tools.get(id)

    if (tool) {
      const input = parseToolArgs(tool.args, options.logger, options.transportName)
      content.push({ type: 'tool_call', call: { id: tool.id, name: tool.name, input } })
    }
  }

  const finishReason = state.finishReason ?? (state.order.length > 0 ? 'tool_use' : 'stop')
  const reasoningBlocks = replayBlocksForResponse(state, options, finishReason)

  return {
    content,
    usage: toTokenUsage(state.usage),
    usageSource: state.usageSeen ? 'provider' : 'estimated',
    finishReason,
    ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
  }
}

function replayBlocksForResponse(
  state: StreamState,
  options: RunStreamOptions,
  finishReason: FinishReason
): readonly ReasoningReplayBlock[] {
  if (state.order.length === 0 && finishReason !== 'pause') {
    return []
  }

  const blocks = [...state.reasoningBlocks]
  const protocol = options.reasoningTextReplay
  const hasExactOpenRouter = blocks.some((block) => block.type === 'openrouter_reasoning_detail')

  if (
    state.reasoning !== '' &&
    protocol !== undefined &&
    protocol !== 'none' &&
    protocol !== 'anthropic' &&
    protocol !== 'gemini' &&
    !(protocol === 'openrouter' && hasExactOpenRouter)
  ) {
    blocks.push({ type: 'reasoning_text', protocol, text: state.reasoning })
  }

  return blocks
}

function finalizeUsage(state: StreamState, options: RunStreamOptions): void {
  if (state.usageFinalized) {
    return
  }

  state.usageFinalized = true

  // A provider that sends no usage (or only an untrustworthy one) must not bill zero: estimate from
  // the exact request plus the collected response so cost and totals stay finite and non-trivial.
  // Provider-sourced usage is left alone — a locally estimated field under `usageSource: 'provider'`
  // would be indistinguishable from a reported one.
  if (!state.usageSeen) {
    const estimated = estimateUsage(options.messages ?? [], state)
    state.usage.input = estimated.input
    state.usage.output = estimated.output

    if (state.reasoning !== '') {
      state.usage.reasoning = estimateTextTokens(state.reasoning)
    }

    options.logger.warn('ai.usage_estimated', {
      transport: options.transportName,
      input: estimated.input,
      output: estimated.output,
    })
  }
}

function finalizeError(err: unknown, state: StreamState, options: RunStreamOptions): Error {
  const signal = options.init.signal
  const typed = signal?.aborted ? abortError(signal) : asStreamError(err)

  if (typed instanceof LLMError && typed.usage !== undefined) {
    return typed
  }

  finalizeUsage(state, options)
  raiseOutputFloor(state)

  const graded = isSpentBudget(typed, state)
    ? new LLMError('output_budget_exhausted', typed.message)
    : typed

  return attachAttemptUsage(graded, {
    usage: toTokenUsage(state.usage),
    usageSource: state.usageSeen ? 'provider' : 'estimated',
  })
}

// The byte cap and a `length` finish are one event through two ceilings: the model spent its
// allowance and answered nothing. Which one fires depends on how verbose the provider's framing is,
// so only the code they share may decide whether the chain can fail over.
function isSpentBudget(err: Error, state: StreamState): boolean {
  return err instanceof LLMError && err.code === 'response_too_large' && hasNoAnswer(state)
}

// Anthropic publishes input-side usage with output:0 at message_start, so a socket drop mid-stream
// would otherwise book that zero as provider-sourced despite the deltas already delivered.
function raiseOutputFloor(state: StreamState): void {
  if (!state.usageSeen) {
    return
  }

  state.usage.output = Math.max(state.usage.output, estimateTextTokens(serializeResponse(state)))
}

// Only explicit pause/content-filter protocol states may finish without text or tool calls.
// Everything else fails here instead of degrading into a downstream parser failure.
function assertUsable(state: StreamState, transportName: string): void {
  const answerOptional = state.finishReason === 'pause' || state.finishReason === 'content_filter'

  if (!hasNoAnswer(state) || answerOptional) {
    return
  }

  const detail = `finish=${state.finishReason ?? 'none'}, frames=${state.frames}`

  // Stopping at the output cap with nothing to show is the request's own budget, not a provider
  // blip: the identical call spends it identically, so this must not retry the same entry.
  if (state.finishReason === 'length') {
    throw new LLMError(
      'output_budget_exhausted',
      `${transportName} spent its output budget before answering (${detail})`
    )
  }

  throw new LLMError('empty_response', `${transportName} returned no usable content (${detail})`)
}

function hasNoAnswer(state: StreamState): boolean {
  return state.text === '' && state.order.length === 0
}

function toTokenUsage(usage: MutableUsage): TokenUsage {
  return {
    input: usage.input,
    output: usage.output,
    ...(usage.cacheRead > 0 ? { cacheRead: usage.cacheRead } : {}),
    ...(usage.cacheWrite > 0 ? { cacheWrite: usage.cacheWrite } : {}),
    ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
  }
}

// Conservative input basis = every request message's text; output = the answer plus its reasoning.
// `estimateTextTokens` gives every non-empty component at least one token.
function estimateUsage(messages: readonly LLMMessage[], state: StreamState): TokenUsage {
  let input = 0

  for (const message of messages) {
    input += estimateTextTokens(serializeMessage(message))
  }

  return {
    input,
    output: estimateTextTokens(serializeResponse(state)),
  }
}

function serializeMessage(message: LLMMessage): string {
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  const reasoning =
    message.reasoningBlocks === undefined ? '' : JSON.stringify(message.reasoningBlocks)

  return `${message.role}\n${content}\n${reasoning}`
}

function serializeResponse(state: StreamState): string {
  const tools = state.order.map((id) => state.tools.get(id)).filter((tool) => tool !== undefined)

  return `${state.text}\n${state.reasoning}\n${JSON.stringify(tools)}\n${JSON.stringify(state.reasoningBlocks)}`
}
