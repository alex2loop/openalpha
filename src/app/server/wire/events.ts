// The /v1 WebSocket wire contract — client-agnostic. The daemon emits one WireEvent, pushed on
// /v1/ws as a ServerFrame { type: 'wire_event', ...WireEvent } (socket.ts).
// Clients hand-mirror these shapes: no field may be renamed within v1.

/** The surface a run originates from — drives the source glyph + notification threading. */
import type { Decision } from '@/app/server/wire/chat'
import type { ProgressWire, RunStartWire } from '@/app/server/wire/live'

export type Channel = 'cli' | 'telegram' | 'cron' | 'api'

/** Routing tier assigned daemon-side; a hint each client maps to its own surface
 *  (a system notification, a toast, a badge). The hint is shared; rendering is not. */
type WireEventWeight = 'interrupt' | 'nudge' | 'sneak' | 'quiet'

/** The event vocabulary the daemon emits. Names mirror core (bus topics / StreamEvent types) where
 *  one exists, so the normalizer maps 1:1; run lifecycle + trading kinds have no core event.
 *  Clients switch on this; an unknown kind is ignored, never an error. */
type WireEventKind =
  | 'run_started'
  | 'run_progress'
  | 'run_thinking'
  | 'usage'
  | 'run_finished'
  | 'tool_started'
  | 'tool_result'
  | 'approval_requested'
  | 'approval_resolved'
  | 'clarification_requested'
  | 'budget_warning'
  | 'budget_exhausted'
  | 'provider_fallback'
  | 'pairing_requested'
  | 'alert_fired'
  | 'stop_breached'
  | 'brief_ready'
  | 'idea'
  | 'role_output'
  | 'mover'
  | 'order_filled'
  | 'alerts_checked'
  | 'schedule_result'
  | 'call_scored'
  | 'notice'
  | 'daemon_notice'
  | 'notices_changed'

export interface WireEvent {
  readonly v: 1
  readonly kind: WireEventKind
  readonly weight: WireEventWeight
  /** Set on the kinds that should bring a sleeping client back to its surface: an approval, a stop
   *  or alert, a fill, a spent budget. Absent everywhere else. */
  readonly wake?: true
  /** Originating surface — the source glyph + notification threading (by channel + agentId). */
  readonly source: { readonly channel: Channel; readonly agentId: string }
  readonly runId?: string
  /** approval interaction id; resolve via POST /v1/respond. */
  readonly requestId?: string

  // One payload below is set, matching `kind`; `note` may ride beside it.
  /** 'run_started': an agent run or a long-running command began; `run.sessionId` lets a client
   *  clear a pending question when the answer turn starts. */
  readonly run?: RunStartWire
  /** 'run_progress': the line a run just reported, in the daemon's language. */
  readonly progress?: ProgressWire
  /** 'run_thinking': a scrubbed tail of the model's reasoning, at most one per 2 s per run. */
  readonly thinking?: string
  /** 'run_finished': a run result reason, or `done | cancelled | failed` for a command. */
  readonly outcome?: string
  /** 'run_finished': the tickers the run reported on, in the order first seen; at most 20. Absent
   *  when it named none. */
  readonly tickers?: readonly string[]
  readonly usage?: { readonly costUsd: number; readonly tokens: number }
  /** 'tool_started' | 'tool_result': a tool call in an agent run. `capability` is the tool's declared
   *  one (read, net, memory, schedule, delegate, write or shell). A start carries `ok: true`, as
   *  nothing has failed yet. A result with `skipped` has no start: the call never reached its tool
   *  (refused, blocked, or paired unrun). */
  readonly tool?: {
    readonly name: string
    readonly ok: boolean
    readonly capability?: string
    readonly skipped?: true
  }
  /** 'approval_requested': the gated tool. `label` is its name in the operator's language, as the
   *  CLI and channels print it; `expiresAt` (epoch ms) is when the gate denies on its own.
   *  `dangerous` → the elevated "--warn" tag. `decisions` are the only answers the gate accepts;
   *  `truncated` says the arguments did not fit the prompt. `channelId` is the raw channel that
   *  asked (`source.channel` folds an unknown one into `api`); `answerable` is true only when
   *  POST /v1/respond may answer it, that is when it was asked on `api`; `askedAt` is epoch ms. */
  readonly approval?: {
    readonly toolName: string
    readonly label: string
    readonly argsSummary: string
    readonly expiresAt: number
    readonly decisions: readonly Decision[]
    readonly dangerous?: boolean
    readonly truncated?: true
    readonly channelId?: string
    readonly answerable?: boolean
    readonly askedAt?: number
  }
  /** 'approval_resolved': how it was answered (elsewhere / timeout) — clears the card. */
  readonly resolution?: { readonly decision: string; readonly by: Channel }
  /** 'clarification_requested': the answer is the next chat message in `sessionId`, sent on the
   *  surface that asked (`channelId`, the raw channel id). `requestId` and `runId` ride on the event
   *  itself; `askedAt` is epoch ms; `answerable` is true when that surface is `api`. */
  readonly clarification?: {
    readonly text: string
    readonly sessionId: string
    readonly askedAt?: number
    readonly channelId?: string
    readonly answerable?: boolean
  }
  /** 'budget_warning' | 'budget_exhausted': the period's spend against its cap, in USD. */
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
  /** 'order_filled': a fill the ledger now holds, from `/trade` or a resting exit. `price` is the
   *  average fill price in the instrument's own currency; `closeReason` is set on a sale a resting
   *  stop or take-profit made. */
  readonly fill?: {
    readonly instrument: { readonly market: string; readonly ticker: string }
    readonly venue: string
    readonly side: 'buy' | 'sell'
    readonly quantity: number
    readonly price: number
    readonly closeReason?: 'stop' | 'target'
  }
  /** 'alerts_checked': epoch ms an alert pass last finished. A pass reads one cursor page of alerts,
   *  not the whole book. */
  readonly checkedAt?: number
  /** 'notices_changed': the bell's unread count after a notice was written or some were read;
   *  refetch GET /v1/notices. */
  readonly unread?: number
  /** 'idea': a suggestion was stored; read it with GET /v1/suggestions. */
  readonly idea?: {
    readonly suggestionId: string
    readonly instrument: { readonly market: string; readonly ticker: string }
    readonly action: 'buy' | 'reduce' | 'hold'
    readonly conviction: string
  }
  /** 'call_scored': a call the track record has just scored, read it with GET /v1/suggestions/:id.
   *  `returnPct` and the benchmark's are fractions net of fees (0.05 is 5%), as on a suggestion's
   *  `outcome`. `benchmark` is absent where the market names none. The rendered sentence rides in
   *  `note`. */
  readonly call?: {
    readonly suggestionId: string
    readonly ticker: string
    readonly market: string
    readonly action: string
    readonly status: 'target' | 'stop' | 'expired'
    readonly returnPct: number
    readonly benchmark?: { readonly name: string; readonly returnPct: number }
    readonly focusKey: string
    readonly day: string
  }
  /** 'notice': which kind of notice it is (the notice's own name, for example `held-news`), so a page
   *  can place it. Absent on a notice that has no kind of its own. */
  readonly noticeKind?: string
  /** 'notice' of kind `held-news`: the holding the headline is about. */
  readonly instrument?: { readonly market: string; readonly ticker: string }
  /** 'notice' of kind `index-drop`: the index's move in the session, a percent (-1.7 is down 1.7%). */
  readonly move?: number
  /** 'role_output': what one debate role said once the debate was verified. `stance` is the role's own
   *  conclusion in the daemon's language. `unsupported` means the evidence refuted every claim the role
   *  checked, and its `summary` is then withheld. Never sent to a chat. */
  readonly role?: {
    readonly ticker: string
    readonly market: string
    readonly role: string
    readonly stance?: string
    readonly summary?: string
    readonly citations: number
    readonly unsupported: boolean
  }
  /** The line a chat would get, already written in the daemon's language: the whole payload of
   *  'schedule_result', 'notice' and 'daemon_notice', and set beside the 'alert_fired', 'stop_breached',
   *  'brief_ready', 'mover', 'order_filled' and 'budget_exhausted' payloads too. */
  readonly note?: string
}
