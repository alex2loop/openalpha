// The live run feed: what the daemon is running right now, for a client that opens late. The same
// shapes ride GET /v1/live and the run_* wire events, so a client folds both into one view.

import type { WireEvent } from '@/app/server/wire/events'
import type { TaskStatusWire } from '@/app/server/wire/tasks'
import type { LLMAttemptKind, RunAttempt } from '@/core/types/usage'

/** One progress line a run reported. `text` is the line rendered in the daemon's `[locale]`;
 *  `params` are the keyed message's values, credential-scrubbed. */
export interface ProgressWire {
  readonly key: string
  readonly params?: Readonly<Record<string, unknown>>
  readonly text: string
  readonly mode: 'transient' | 'persistent'
  /** Epoch ms the daemon saw the line. */
  readonly at: number
}

/** How a run began. `channelId` is the raw channel id, which is open (zalo, social, plugin
 *  channels), so it is never folded into the closed `Channel` union. */
export interface RunStartWire {
  readonly kind: 'agent' | 'command'
  /** The agent id, or the command name. */
  readonly name: string
  readonly title?: string
  readonly channelId: string
  readonly sessionId: string
  readonly parentRunId?: string
  readonly hidden?: true
  readonly startedAt: number
}

/** 202 from POST /v1/runs/:runId/stop: the run was told to stop. It ends as `run_finished`. */
export interface RunStopWire {
  readonly stopped: true
}

/** One billed call of a run: metadata only, no prompt or answer. `at` is when it settled, epoch ms. */
export interface RunCallWire {
  readonly at: number
  readonly runId: string
  readonly parentRunId?: string
  readonly agentId: string
  readonly kind: LLMAttemptKind
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly costUsd: number
  readonly latencyMs: number
  readonly outcome: RunAttempt['outcome']
  /** The stored code of a failed attempt. */
  readonly errorCode?: NonNullable<RunAttempt['errorCode']>
}

/** GET /v1/runs/:runId/calls: the run's calls and everything beneath it, newest first. `truncated`
 *  when more exist than the page shows; `totalCalls` and `totalUsd` count all of them, as
 *  `/v1/activity` prices the run, so a cut list never undercounts. */
export interface RunCallsWire {
  readonly runId: string
  readonly calls: readonly RunCallWire[]
  readonly truncated: boolean
  readonly totalCalls: number
  readonly totalUsd: number
}

export interface LiveRunWire extends RunStartWire {
  readonly runId: string
  /** Absent for a command. */
  readonly agentId?: string
  /** The latest line, transient or persistent. */
  readonly progress?: ProgressWire
  /** A scrubbed tail of the model's reasoning. */
  readonly thinking?: string
  /** The persistent steps so far, oldest first. */
  readonly persistent: readonly ProgressWire[]
  /** The tickers the run's progress lines named so far, in the order first seen; at most 20. */
  readonly tickers?: readonly string[]
}

/** A request still waiting for an answer, on any channel. An approval is its `approval_requested`
 *  event, whose `approval` carries the `channelId` and `answerable` (so the two live in one place);
 *  it is retracted by its `approval_resolved` event (or `expiresAt`). A question is retracted by
 *  the next agent run in `sessionId`. */
export type PendingWire =
  | { readonly kind: 'approval'; readonly event: WireEvent }
  | QuestionPendingWire

export interface QuestionPendingWire {
  readonly kind: 'question'
  readonly requestId: string
  readonly runId: string
  readonly sessionId: string
  /** The raw channel id the question was asked on, as `clarification_requested.channelId`. */
  readonly channelId: string
  readonly question: string
  readonly askedAt: number
  readonly answerable: boolean
}

/** GET /v1/live. */
export interface LiveSnapshotWire {
  readonly runs: readonly LiveRunWire[]
  readonly pending: readonly PendingWire[]
  readonly alertsCheckedAt?: number
  /** Every background task, as `GET /v1/tasks` lists it; `tasks_changed` replaces it. */
  readonly tasks: readonly TaskStatusWire[]
}
