import type { JobId, RunId } from '@/core/ids'

export const APPROVAL_DECISIONS = ['deny', 'once', 'remember'] as const

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number]

export type ApprovalScope =
  | { readonly kind: 'session' }
  | { readonly kind: 'scheduler'; readonly jobId: JobId }
  | { readonly kind: 'mcp' }
  | { readonly kind: 'delegated'; readonly parentRunId: RunId }

export type ToolApprovalStatus = 'remembered' | 'denied' | 'prompt'

export interface ApprovalAnswer {
  readonly decision: ApprovalDecision
  readonly feedback?: string
}

export interface ApprovalRequestInput {
  readonly toolName: string
  /** Engine-resolved display for the call. Adapters render these, not `argsSummary`. */
  readonly label: string
  readonly emoji?: string
  readonly detail?: string
  /** The detail is cut: a surface says so, since the operator never saw the whole call. */
  readonly truncated?: true
  readonly argsSummary: string
  readonly oneTime?: true
  readonly signal: AbortSignal
  // The gate's deadline: an adapter bounds its own wait with it so both give up together.
  readonly timeoutMs: number
}

export interface ToolApproval {
  readonly scope: ApprovalScope
  status(key: string): ToolApprovalStatus
  request?(input: ApprovalRequestInput): Promise<ApprovalAnswer>
  remember?(key: string): void
  deny(key: string): void
}
