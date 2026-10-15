import type { ChannelId } from '@/core/channels'
import type { AgentId, RunId, SessionId } from '@/core/ids'
import type { Threat } from '@/core/security/sanitize'
import type { RunResultReason } from '@/core/types/run'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { ApprovalDecision, ApprovalScope } from '@/engine/types/approval'

declare module '@/core/events' {
  interface BusEventMap {
    approval_requested: {
      readonly runId: RunId
      // Minted by the gate: a provider tool-call id is not guaranteed unique across runs.
      readonly requestId: string
      readonly agentId: AgentId
      readonly toolName: string
      readonly argsSummary: string
      // Engine-resolved display for the call (same source as tool_execution_start); surfaces
      // render these instead of parsing toolName/argsSummary.
      readonly label: string
      readonly emoji?: string
      readonly detail?: string
      readonly truncated?: true
      readonly scope: ApprovalScope
      // The tool declined a remembered decision, so no surface may offer one. Carried beside
      // `scope` because it answers the same question and a surface holds only this event.
      readonly oneTime?: true
      // Epoch ms, absolute: a surface's own clock would start after delivery, not before it.
      readonly expiresAt: number
      // Which surface must render the prompt: every surface subscribes to one bus, so without this
      // a telegram run's approval would also prompt on the CLI and vice versa.
      readonly channel: ChannelId
      readonly chatId: string
      readonly callDepth: number
    }
    approval_resolved: {
      readonly requestId: string
      readonly decision: ApprovalDecision
      readonly feedback?: string
      readonly approvedBy?: string
      /** Originating channel; the engine only resolves a request whose channel matches the run. */
      readonly channel?: ChannelId
    }
    budget_warning: {
      readonly agentId: AgentId
      readonly period: 'daily' | 'monthly'
      readonly spent: number
      readonly cap: number
    }
    tool_output_threat: {
      readonly toolName: string
      readonly callId: string
      readonly findings: readonly Threat[]
    }
    run_finished: {
      readonly runId: RunId
      readonly agentId: AgentId
      readonly sessionId: SessionId
      readonly reason: RunResultReason
      readonly totals: LLMUsageTotals
    }
    run_failed: {
      readonly sessionId: SessionId
      readonly agentId: AgentId
      readonly reason: RunResultReason
      readonly errorMessage?: string
    }
    // Session-scoped state the engine holds in memory outlives the row otherwise: `app` owns the
    // session lifecycle, so it announces the end and the engine drops what it remembered.
    session_ended: {
      readonly sessionId: SessionId
    }
  }
}
