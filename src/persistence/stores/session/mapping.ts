import type { LLMMessage, ReasoningReplayBlock } from '@/core/llm'
import type { LLMUsageTotals } from '@/core/types/usage'
import type {
  SessionDetails,
  SessionStatus,
  SessionSummary,
  StoredSessionMessage,
  TranscriptMessage,
} from '@/persistence/types'
import { channelId } from '@/core/channels'
import { StorageError } from '@/core/errors'
import { agentId, runId, sessionId, userId } from '@/core/ids'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'
import { fromNanoUsd } from '@/persistence/money'

export interface MessagePayloadRow {
  readonly role: LLMMessage['role']
  readonly content: string
  readonly tool_call_id: string | null
  readonly reasoning_blocks: string | null
  readonly is_error: number
}

export interface TranscriptRow extends MessagePayloadRow {
  readonly idx: number
  readonly run_id: string | null
}

export interface StoredMessageRow extends TranscriptRow {
  readonly created_at: number
}

export interface SessionRow {
  readonly id: string
  readonly agent_id: string
  readonly user_id: string
  readonly channel: string
  readonly chat_id: string | null
  readonly status: SessionStatus
  readonly end_reason: string | null
  readonly error_message: string | null
  readonly started_at: number
  readonly last_activity_at: number
  readonly ended_at: number | null
}

export interface TotalsRow {
  readonly cost_nano_usd: number
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_tokens: number
  readonly cache_write_tokens: number
  readonly reasoning_tokens: number
  readonly model_calls: number
  readonly model_count: number
  readonly model_name: string | null
}

export interface SessionSummaryRow {
  readonly id: string
  readonly agent_id: string
  readonly channel: string
  readonly status: SessionStatus
  readonly cost_nano_usd: number
  readonly input_tokens: number
  readonly output_tokens: number
  readonly model_calls: number
  readonly last_activity_at: number
}

export function toMessage(row: MessagePayloadRow): LLMMessage {
  const message: {
    role: LLMMessage['role']
    content: LLMMessage['content']
    toolCallId?: string
    reasoningBlocks?: readonly ReasoningReplayBlock[]
    isError?: boolean
  } = { role: row.role, content: parseJson<LLMMessage['content']>(row.content, 'content') }

  if (row.tool_call_id !== null) {
    message.toolCallId = row.tool_call_id
  }

  if (row.reasoning_blocks !== null) {
    message.reasoningBlocks = parseJson<readonly ReasoningReplayBlock[]>(
      row.reasoning_blocks,
      'reasoning_blocks'
    )
  }

  if (row.is_error === 1) {
    message.isError = true
  }

  return message
}

export function toTranscriptMessage(row: TranscriptRow): TranscriptMessage {
  return {
    message: toMessage(row),
    ...(row.run_id === null ? {} : { runId: runId(row.run_id) }),
  }
}

export function toStoredMessage(row: StoredMessageRow): StoredSessionMessage {
  return {
    idx: row.idx,
    ...(row.run_id === null ? {} : { runId: runId(row.run_id) }),
    message: toMessage(row),
    createdAt: row.created_at,
  }
}

export function toSessionDetails(row: SessionRow): SessionDetails {
  return {
    id: sessionId(row.id),
    agentId: agentId(row.agent_id),
    userId: userId(row.user_id),
    channel: channelId(row.channel),
    ...(row.chat_id === null ? {} : { chatId: row.chat_id }),
    status: row.status,
    ...(row.end_reason === null ? {} : { endReason: row.end_reason }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
  }
}

export function toTotals(row: TotalsRow | undefined): LLMUsageTotals {
  if (row === undefined) {
    return EMPTY_LLM_USAGE_TOTALS
  }

  return {
    costUsd: fromNanoUsd(row.cost_nano_usd),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    modelCalls: row.model_calls,
    ...(row.model_count === 1 && row.model_name !== null ? { modelName: row.model_name } : {}),
  }
}

export function toSessionSummary(row: SessionSummaryRow): SessionSummary {
  return {
    id: sessionId(row.id),
    agentId: agentId(row.agent_id),
    channel: channelId(row.channel),
    status: row.status,
    costUsd: fromNanoUsd(row.cost_nano_usd),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    modelCalls: row.model_calls,
    lastActivityAt: row.last_activity_at,
  }
}

function parseJson<T>(raw: string, column: string): T {
  try {
    return JSON.parse(raw)
  } catch (err: unknown) {
    throw new StorageError(`corrupt session_messages.${column} column`, err)
  }
}
