// The /v1 WebSocket wire contract — client-agnostic. The daemon emits one WireEvent, pushed on
// /v1/ws as a ServerFrame { type: 'wire_event', ...WireEvent } (socket.ts).
// Clients hand-mirror these shapes: no field may be renamed within v1.

/** The surface a run originates from — drives the source glyph + notification threading. */
import type { Decision } from '@/app/server/wire/chat'

export type Channel = 'cli' | 'telegram' | 'cron' | 'api'

/** Routing tier assigned daemon-side; a hint each client maps to its own surface
 *  (a system notification, a toast, a badge). The hint is shared; rendering is not. */
type WireEventWeight = 'interrupt' | 'nudge' | 'sneak' | 'quiet'

/** The event vocabulary the daemon emits. Names mirror core (bus topics / StreamEvent types) where
 *  one exists, so the normalizer maps 1:1; run lifecycle + trading kinds have no core event.
 *  Clients switch on this; an unknown kind is ignored, never an error. */
type WireEventKind =
  | 'run_started'
  | 'usage'
  | 'run_finished'
  | 'tool_result'
  | 'approval_requested'
  | 'approval_resolved'
  | 'clarification_requested'
  | 'budget_warning'
  | 'provider_fallback'
  | 'pairing_requested'
  | 'alert_fired'
  | 'stop_breached'
  | 'brief_ready'
  | 'idea'
  | 'mover'
  | 'schedule_result'
  | 'notice'

export interface WireEvent {
  readonly v: 1
  readonly kind: WireEventKind
  readonly weight: WireEventWeight
  /** Originating surface — the source glyph + notification threading (by channel + agentId). */
  readonly source: { readonly channel: Channel; readonly agentId: string }
  readonly runId?: string
  /** approval interaction id; resolve via POST /v1/respond. */
  readonly requestId?: string

  // One payload below is set, matching `kind`; `note` may ride beside it.
  readonly usage?: { readonly costUsd: number; readonly tokens: number }
  readonly tool?: { readonly name: string; readonly ok: boolean }
  /** 'approval_requested': the gated tool. `dangerous` → the elevated "--warn" tag. `decisions`
   *  are the only answers the gate accepts; `truncated` says the arguments did not fit the prompt. */
  readonly approval?: {
    readonly toolName: string
    readonly argsSummary: string
    readonly decisions: readonly Decision[]
    readonly dangerous?: boolean
    readonly truncated?: true
  }
  /** 'approval_resolved': how it was answered (elsewhere / timeout) — clears the card. */
  readonly resolution?: { readonly decision: string; readonly by: Channel }
  /** 'clarification_requested': the answer is the next chat message in `sessionId`, sent on the
   *  surface that asked (`source.channel`). */
  readonly clarification?: { readonly text: string; readonly sessionId: string }
  readonly budget?: { readonly period: string; readonly spent: number; readonly cap: number }
  /** 'provider_fallback': `from`/`to` are `provider/model`; `reason` is the runtime LLM error code
   *  that moved the chain on; `attempt` counts from 1. */
  readonly fallback?: {
    readonly from: string
    readonly to: string
    readonly reason: string
    readonly attempt: number
  }
  /** 'pairing_requested': a chat was sent this code; approve or deny it with POST /v1/pairing. */
  readonly pairing?: {
    readonly channel: string
    readonly chatId: string
    readonly code: string
    readonly expiresAt: number
  }
  /** 'alert_fired' | 'stop_breached': the alert that crossed. `level` is set on a plan's own exit
   *  alert (`stop` is the 'stop_breached' kind, `target` a take-profit). */
  readonly alert?: {
    readonly alertId: string
    readonly instrument: { readonly market: string; readonly ticker: string }
    readonly condition: 'above' | 'below'
    readonly threshold: number
    readonly observedPrice: number
    readonly level?: 'stop' | 'target'
  }
  /** 'brief_ready': read it with GET /v1/brief. */
  readonly brief?: { readonly snapshotId: string; readonly day: string }
  /** 'mover': a watched or held name moved past its usual daily range. Percents. */
  readonly mover?: {
    readonly instrument: { readonly market: string; readonly ticker: string }
    readonly condition: 'above' | 'below'
    readonly observedPrice: number
    readonly movePct?: number
    readonly benchmark?: { readonly ticker: string; readonly movePct: number }
  }
  /** 'idea': a suggestion was stored; read it with GET /v1/suggestions. */
  readonly idea?: {
    readonly suggestionId: string
    readonly instrument: { readonly market: string; readonly ticker: string }
    readonly action: 'buy' | 'reduce' | 'hold'
    readonly conviction: string
  }
  /** The line a chat would get, already written in the daemon's language: the whole payload of
   *  'schedule_result' and 'notice', and set beside the 'alert_fired', 'stop_breached',
   *  'brief_ready' and 'mover' payloads too. */
  readonly note?: string
}
