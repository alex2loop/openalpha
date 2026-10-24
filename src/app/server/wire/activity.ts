// The /v1 activity contract: what the daemon ran and what it cost, read after the fact. A run that
// is still running is `GET /v1/live`; this is the same run once it has finished.

/** One finished run. `costUsd` is the run and every run beneath it. */
export interface ActivityRowWire {
  readonly runId: string
  readonly kind: 'agent' | 'command'
  /** The agent id, or the command name. */
  readonly name: string
  readonly title?: string
  readonly summary?: string
  /** The raw channel id, which is open (zalo, social, plugin channels). */
  readonly channelId: string
  readonly agentId?: string
  readonly parentRunId?: string
  /** Epoch ms. */
  readonly startedAt: number
  readonly endedAt: number
  /** A run result reason for an agent (`completed`, `aborted`, `budget`, `error`, `turn_limit`,
   *  `loop`, `timeout`), `completed | aborted | error` for a command. */
  readonly outcome: string
  readonly costUsd: number
  /** Direct children, oldest first. Absent on a child row and on a run that spawned none. */
  readonly children?: readonly ActivityRowWire[]
}

/** GET /v1/activity. */
export interface ActivityResponse {
  /** The operator's day the rows ended in, `YYYY-MM-DD`. */
  readonly day: string
  /** Top-level runs, newest first. */
  readonly rows: readonly ActivityRowWire[]
}

/** One finished deep-research run; the page opens its report from the chat history of `sessionId`. */
export interface ResearchReportWire {
  readonly runId: string
  readonly title?: string
  readonly sessionId: string
  readonly channelId: string
  readonly endedAt: number
  readonly outcome: string
  /** The admitted sources the run ended with. */
  readonly sources?: number
}

/** GET /v1/research. */
export interface ResearchResponse {
  /** Newest first. */
  readonly reports: readonly ResearchReportWire[]
}
