import type { ToolErrorCode } from '@/core/errors'
import type { LLMErrorCode, ProviderAttempt, ThinkingBlock } from '@/core/llm'

export type { ThinkingBlock } from '@/core/llm'

export const DEFAULT_MAX_TOKENS = 8192

export const CHARS_PER_TOKEN = 4

const CJK_EXTRA_WEIGHT = 1.7
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/g

export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly reasoning?: number
  readonly costUsd?: number // provider-reported billed USD; authoritative when present
}

export type FinishReason = 'stop' | 'tool_use' | 'length' | 'content_filter' | 'pause'

export interface LocalizedMessageParam {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number>>
}

interface LocalizedMessage {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number | LocalizedMessageParam>>
}

export type DisplayText = string | LocalizedMessage

export interface ProgressMessage extends LocalizedMessage {
  readonly mode: 'transient' | 'persistent'
}

export type ToolLifecycleOwner = 'tool' | 'progress'

export type StreamEvent =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'reasoning_delta'; readonly delta: string }
  | { readonly type: 'thinking_block'; readonly block: ThinkingBlock }
  | {
      // Model-protocol event: carries the raw registered tool name and arg summary. Surfaces that
      // need resolved display metadata must use the engine-owned `tool_execution_start` below.
      readonly type: 'tool_call_start'
      readonly id: string
      readonly name: string
      readonly argsSummary?: string
    }
  | { readonly type: 'tool_call_args_delta'; readonly id: string; readonly delta: string }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | ({ readonly type: 'provider_attempt_failed' } & ProviderAttempt)
  | { readonly type: 'finish_reason'; readonly reason: FinishReason }
  | {
      readonly type: 'turn_metric'
      readonly model: string
      readonly provider: string
      readonly latencyMs: number
      readonly contextPct: number
      readonly costUsd: number
      readonly inputTokens: number
      readonly outputTokens: number
    }
  | {
      readonly type: 'provider_fallback'
      readonly from: string
      readonly to: string
      readonly reason: LLMErrorCode
      readonly attempt: number
    }
  // Engine-owned activity events: resolved once by the executor, not persisted in the transcript.
  | {
      readonly type: 'tool_execution_start'
      readonly id: string
      readonly name: string
      readonly label: string
      readonly lifecycleOwner: ToolLifecycleOwner
      readonly emoji?: string
      readonly detail?: string
    }
  | { readonly type: 'tool_progress'; readonly id: string; readonly message: ProgressMessage }
  // Emitted by the engine loop after tool execution — transports never produce it.
  | {
      readonly type: 'tool_result'
      readonly id: string
      readonly name: string
      readonly ok: boolean
      readonly lifecycleOwner: ToolLifecycleOwner
      readonly error?: string
      readonly errorCode?: ToolErrorCode
      readonly resultSummary?: string
      readonly display?: DisplayText
    }

export type OnStreamEvent = (e: StreamEvent) => void

export function isPersistentProgress(message: ProgressMessage): boolean {
  return message.mode === 'persistent'
}

// CJK scripts are ~1.5 chars/token; the flat ratio undercounts ~3x. Adding weighted
// char-equivalents keeps ASCII identical (cjk=0) and only inflates CJK-heavy text.
export function weightedCharCount(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length
  return text.length + cjk * CJK_EXTRA_WEIGHT
}

export function estimateTextTokens(text: string): number {
  if (text === '') {
    return 0
  }

  return Math.max(1, Math.ceil(weightedCharCount(text) / CHARS_PER_TOKEN))
}
