// Agent management on /v1: the operator's own agents, whether each is paused, and what it has spent.
// Contract shapes only - the runtime owns what pausing means (see CONTRACT.md).

/** One of the operator's own agents. Built-in agents and plugin agents are not listed: they cannot
 *  be paused. */
export interface AgentWire {
  readonly id: string
  readonly name: string
  readonly paused: boolean
  /** The agent's own daily ceiling in USD. Absent when only the overall cap applies. */
  readonly maxDailyUsd?: number
  /** What it has spent today, on the operator's calendar, debates it asked for included. */
  readonly spentTodayUsd: number
  /** `default` for an agent that shares the operator's focus; any other key names its own. */
  readonly focusKey: string
  /** The focus in words, in the daemon's language. */
  readonly focusLabel: string
  /** What its calls earned, every focus it has used together. Absent until it has called. */
  readonly record?: AgentRecordWire
  /** How often it takes the action the other agents take on the same name and day. */
  readonly agreement?: {
    readonly comparedCount: number
    readonly matchedCount: number
  }
  /** Where it went against the others and both sides were scored. */
  readonly contrarian?: {
    readonly count: number
    readonly wins: number
    readonly crowdWins: number
  }
  /** Other agents whose focus almost always reaches the same call. */
  readonly overlapsWith: readonly string[]
  /** The social networks it is on; empty when none. */
  readonly social: readonly AgentSocialWire[]
}

interface AgentSocialWire {
  readonly network: string
  /** `active`, `paused` or `refused`. */
  readonly state: string
  readonly reviewAll: boolean
  readonly drafts: number
}

interface AgentRecordWire {
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
}

/** GET /v1/agents. */
export interface AgentsResponse {
  readonly agents: readonly AgentWire[]
}
