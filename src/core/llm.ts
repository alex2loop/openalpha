import type { ChannelId } from '@/core/channels'
import type { LLMAttemptId, RunId, SessionId } from '@/core/ids'
import type { FinishReason, OnStreamEvent, TokenUsage } from '@/core/stream-events'
import type { ToolCall, ToolSchema } from '@/core/tool'

export const REASONING_MODES = ['default', 'off', 'low', 'medium', 'high'] as const
export type ReasoningMode = (typeof REASONING_MODES)[number]
export type ReasoningEffort = Extract<ReasoningMode, 'low' | 'medium' | 'high'>

/** How a routing provider picks among the endpoints serving one model. Absent leaves the choice to
 *  the router, which optimizes for neither and can seat a call on an endpoint an order of magnitude
 *  slower than its neighbours. */
export const PROVIDER_SORTS = ['price', 'throughput', 'latency'] as const
type ProviderSort = (typeof PROVIDER_SORTS)[number]

/** What a routing provider is told about endpoints. A sort still seats every call afresh; `only`
 *  and `order` pin the endpoint, and `allowFallbacks: false` fails a request rather than let it
 *  drift off the named list. */
export interface ProviderRouting {
  readonly sort?: ProviderSort
  readonly only?: readonly string[]
  readonly order?: readonly string[]
  readonly allowFallbacks?: boolean
}

export const LLM_ERROR_CODES = [
  'transient',
  // A provider that answered 429: the same request may succeed once the window resets, but never
  // on the same endpoint seconds later, which is what separates it from `transient`.
  'rate',
  'auth',
  'timeout',
  'not_found',
  'context_overflow',
  'billing',
  'empty_response',
  'output_budget_exhausted',
  'response_too_large',
  'fatal',
] as const
export type LLMErrorCode = (typeof LLM_ERROR_CODES)[number]

const PROVIDER_ATTEMPT_OUTCOMES = ['success', 'retry', 'fallback', 'terminal_failure'] as const
export type ProviderAttemptOutcome = (typeof PROVIDER_ATTEMPT_OUTCOMES)[number]

export type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: ToolCall }

// Hosts that take a prior turn's reasoning back as plain text.
export type ReasoningTextProtocol = 'deepseek' | 'glm' | 'kimi' | 'ollama' | 'openrouter' | 'qwen'

export type ReasoningReplayBlock =
  | { readonly type: 'thinking'; readonly thinking: string; readonly signature?: string }
  | { readonly type: 'redacted_thinking'; readonly data: string }
  | {
      readonly type: 'reasoning_text'
      readonly protocol: ReasoningTextProtocol
      readonly text: string
    }
  | {
      readonly type: 'openrouter_reasoning_detail'
      readonly detail: Readonly<Record<string, unknown>>
    }
  | {
      readonly type: 'gemini_thought_signature'
      readonly signature: string
      readonly callId: string
    }
  | { readonly type: 'openai_reasoning_item'; readonly encrypted: string }

export type ThinkingBlock = Extract<
  ReasoningReplayBlock,
  { readonly type: 'thinking' | 'redacted_thinking' }
>

export interface JsonOutputContract {
  readonly name: string
  readonly schema: Readonly<Record<string, unknown>>
  readonly strict: boolean
}

/** A question a decisions provider answers with a calibrated distribution rather than prose. The
 *  criteria are what separate the options, so they travel with the question: a schema can name an
 *  option but cannot say when to pick it. */
export type DecisionQuery =
  | {
      readonly kind: 'choice'
      readonly instructions: string
      readonly criteria: Readonly<Record<string, string>>
    }
  | { readonly kind: 'statement'; readonly instructions: string }

/** What a decisions transport asks, in place of messages. Protocol vocabulary, not domain: the
 *  state is whatever the caller is asking about, opaque to everything between here and the wire. */
export interface DecisionQueries {
  readonly state: Readonly<Record<string, unknown>>
  readonly queries: Readonly<Record<string, DecisionQuery>>
}

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | readonly ContentBlock[]
  readonly toolCallId?: string
  readonly reasoningBlocks?: readonly ReasoningReplayBlock[]
  readonly isError?: boolean
}

export type AssistantMessage = LLMMessage & { readonly role: 'assistant' }
export type NonAssistantMessage = LLMMessage & {
  readonly role: Exclude<LLMMessage['role'], 'assistant'>
}

// The one transcript-write shape: an assistant row must name the non-empty attempt group that
// produced it; every other role never has linked attempts.
export type SessionMessageWrite =
  | {
      readonly runId: RunId
      readonly message: AssistantMessage
      readonly llmAttemptIds: readonly [LLMAttemptId, ...LLMAttemptId[]]
    }
  | {
      readonly runId: RunId
      readonly message: NonAssistantMessage
      readonly llmAttemptIds?: never
    }

export interface LLMRequest {
  readonly model: string
  /** Exact configured entry to try first; absent, the first entry serving `model` leads. */
  readonly preferredProviderModel?: ProviderModelId
  /** Stable, non-user-text key for provider routing and prompt-cache affinity: the session for a
   *  conversation, the role and market for a debate persona whose calls share a prompt prefix. */
  readonly routingKey?: string
  readonly origin?: LLMRequestOrigin
  readonly messages: readonly LLMMessage[]
  /** Reusable character prefix in the first string-valued system message. */
  readonly systemCachePrefixLength?: number
  readonly tools?: readonly ToolSchema[]
  readonly outputContract?: JsonOutputContract
  /** Set only for a decisions transport, which takes questions and a state instead of a
   *  conversation. Every chat wire ignores it, and a decisions wire requires it. */
  readonly decisions?: DecisionQueries
  /** Hidden answers remain available to the engine but never reach the caller's stream. */
  readonly answerVisibility?: 'hidden'
  /** Hidden reasoning remains available for protocol replay but never reaches the caller's stream. */
  readonly reasoningVisibility?: 'hidden'
  readonly maxTokens: number
  readonly reasoningMode: ReasoningMode
  readonly signal: AbortSignal
}

export interface LLMRequestOrigin {
  readonly channel: ChannelId
  readonly sessionId: SessionId
  readonly chatId?: string
}

export interface ProviderModelId {
  readonly provider: string
  readonly model: string
}

interface ProviderAttemptFacts {
  readonly providerModel: ProviderModelId
  readonly usage: TokenUsage
  readonly usageSource: 'provider' | 'estimated'
  readonly latencyMs: number
}

// `empty_response` is deliberately not an outcome: it is an error code. One empty response can
// cause a retry, a fallback, or a terminal failure — the transition and its cause stay separate.
type ProviderAttemptTransition =
  | { readonly outcome: 'success'; readonly errorCode?: never }
  | {
      readonly outcome: Exclude<ProviderAttemptOutcome, 'success'>
      readonly errorCode: LLMErrorCode
    }

type ProviderAttemptUsage = ProviderAttemptFacts & ProviderAttemptTransition

export type ProviderAttempt = ProviderAttemptUsage & {
  readonly attemptId: number
}

// Awaited after every settled network attempt, before the chain retries, falls back, or returns.
// A rejection aborts the chain: continuing would knowingly leave paid work unrecorded.
export type ProviderAttemptObserver = (attempt: ProviderAttempt) => Promise<void>

export interface LLMResponse {
  readonly content: readonly ContentBlock[]
  readonly usage: TokenUsage
  readonly usageSource: 'provider' | 'estimated'
  readonly finishReason: FinishReason
  readonly reasoningBlocks?: readonly ReasoningReplayBlock[]
}

export interface ProviderResponse extends LLMResponse {
  /** The chain entry that actually answered — differs from the request's model on fallback. */
  readonly model: string
  /** Provider-qualified identity of the answering entry: `${provider}/${model}` is the cost key. */
  readonly providerModel: ProviderModelId
  /** Bounded, ordered ledger of every network attempt incurred by this chain call. */
  readonly attempts: readonly ProviderAttempt[]
}

export interface ProviderChain {
  stream(
    req: LLMRequest,
    onEvent: OnStreamEvent,
    observer?: ProviderAttemptObserver
  ): Promise<ProviderResponse>
  /** Worst-case USD ceiling across every configured entry reachable for the requested model:
   *  reservation uses this so a budget check never underestimates a cheap entry whose fallback
   *  is expensive. */
  estimateMaxCost(input: {
    readonly requestedModel: string
    /** The whole prompt, priced once at the dearer of the input and cache-write rates. */
    readonly inputTokens: number
    readonly cacheReadTokens: number
    /** Extra cache-write tokens beyond the prompt; 0 for a pre-call estimate. */
    readonly cacheWriteTokens: number
    readonly maxTokens: number
    /** Priced with the reasoning widening the chain applies to a downgraded entry. */
    readonly reasoningMode: ReasoningMode
    /** A contracted request pays for a second ladder when an entry refuses the schema. */
    readonly hasOutputContract: boolean
  }): number
}
