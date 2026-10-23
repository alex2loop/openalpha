// The live run feed: what the daemon is running right now, for a client that opens late. The same
// shapes ride GET /v1/live and the run_* wire events, so a client folds both into one view.

import type { WireEvent } from '@/app/server/wire/events'

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

/** How a run began. `channel` is the raw channel id, which is open (zalo, social, plugin
 *  channels), so it is never folded into the closed `Channel` union. */
export interface RunStartWire {
  readonly kind: 'agent' | 'command'
  /** The agent id, or the command name. */
  readonly name: string
  readonly title?: string
  readonly channel: string
  readonly sessionId: string
  readonly parentRunId?: string
  readonly hidden?: true
  readonly startedAt: number
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

/** A request still waiting for an answer, on any channel. An approval is retracted by its
 *  `approval_resolved` event (or `expiresAt`); a question by the next agent run in `sessionId`. */
export type PendingWire =
  | {
      readonly kind: 'approval'
      readonly event: WireEvent
      readonly channelId: string
      readonly answerable: boolean
    }
  | QuestionPendingWire

export interface QuestionPendingWire {
  readonly kind: 'question'
  readonly requestId: string
  readonly runId: string
  readonly sessionId: string
  readonly channel: string
  readonly question: string
  readonly askedAt: number
  readonly answerable: boolean
}

/** GET /v1/live. */
export interface LiveSnapshotWire {
  readonly runs: readonly LiveRunWire[]
  readonly pending: readonly PendingWire[]
  readonly alertsCheckedAt?: number
}
