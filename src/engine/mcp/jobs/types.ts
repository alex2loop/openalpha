import type { ClientModelRequest } from '@/ai/api'
import type { ProgressMessage } from '@/core/stream-events'
import type { ToolResult } from '@/core/tool'
import type { ToolApproval } from '@/engine/types/approval'

export interface McpJobCall {
  /** The MCP request's own signal. Aborting it releases this call, never another. */
  readonly signal: AbortSignal
  readonly progress?: (message: ProgressMessage) => void
}

export interface McpJobStart extends McpJobCall {
  readonly name: string
  readonly input: unknown
  readonly approval?: ToolApproval
}

export interface McpJobResume extends McpJobCall {
  readonly continuation: string
  /** The caller answers requests in its own context, so replies carry each request whole. */
  readonly inline: boolean
}

export interface McpJobView {
  readonly continuation: string
  readonly requestId: string
}

export interface McpJobAnswerItem {
  readonly requestId: string
  readonly output: string
}

export interface McpJobAnswer extends McpJobResume {
  readonly answers: readonly McpJobAnswerItem[]
  readonly model: string
}

export type McpJobRefusal =
  | 'full'
  | 'unknown'
  | 'busy'
  | 'expired'
  | 'closing'
  | 'not_pending'
  | 'too_large'

export type McpJobReply =
  | { readonly kind: 'result'; readonly result: ToolResult }
  | {
      readonly kind: 'requests'
      readonly continuation: string
      readonly requests: readonly ClientModelRequest[]
      readonly inline: boolean
    }
  | { readonly kind: 'working'; readonly continuation: string }
  /** The result waits for `model_resume`: a subagent that closed the last round hands back this
   *  marker, never the result itself. */
  | { readonly kind: 'finished'; readonly continuation: string }
  | { readonly kind: 'request'; readonly request: ClientModelRequest }
  | { readonly kind: 'answered' }
  | { readonly kind: 'refused'; readonly refusal: McpJobRefusal }
