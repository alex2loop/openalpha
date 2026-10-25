// Agent management on /v1: the operator's own agents, whether each is paused, and what it has spent.
// Contract shapes only - the runtime owns what pausing means (see CONTRACT.md).

import type { InvestmentGoal } from '@/app/server/wire/vocab'

/** The parts of an agent's character on the page (`hair`, `outfit` and the like), each a slug of at
 *  most 24 characters, at most 8 parts. The daemon checks that shape and stores what it is given: the
 *  page owns which values mean something, and derives a part left out from the agent's id. */
export type AgentLookWire = Readonly<Record<string, string>>

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
  readonly look?: AgentLookWire
  /** `default` for an agent that shares the operator's focus; any other key names its own. */
  readonly focusKey: string
  /** The focus in words, in the daemon's language. */
  readonly focusLabel: string
  /** Its own `[focus]` as declared (lists deduped and sorted); absent when it declares none.
   *  `goal: 'income'` marks an agent hunting dividends; the goal is in neither `focusKey` nor
   *  `focusLabel`. */
  readonly focus?: AgentFocusWire
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
  /** The calls that closed on their target. */
  readonly targetCount: number
  readonly winRate?: number
}

/** GET /v1/agents. */
export interface AgentsResponse {
  readonly agents: readonly AgentWire[]
}

/** What the operator sets on one of their own agents. A key left out is not set. */
export interface AgentFocusWire {
  readonly markets?: readonly string[]
  readonly sectors?: readonly string[]
  readonly horizon?: 'short' | 'long'
  /** What it hunts for, in the profile's goal words (`income` is dividends): a mark on the agent,
   *  never part of its calls. */
  readonly goal?: InvestmentGoal
}

/** GET /v1/agents/:id, and the answer to creating or editing one. Built-in and plugin agents can be
 *  read too; `editable` is true only for the operator's own, which live in the data directory. */
export interface AgentDetailWire {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly systemPrompt: string
  readonly focus?: AgentFocusWire
  readonly maxDailyUsd?: number
  /** The configured model tier it runs on; absent when it runs on the primary model. */
  readonly modelTier?: string
  /** The child agents it may have working at once; absent when it may not spawn any. */
  readonly maxSpawn?: number
  readonly look?: AgentLookWire
  readonly editable: boolean
}

/** The fields of POST /v1/agents (`id` required) and PATCH /v1/agents/:id (`id` taken from the
 *  path, and the body replaces every field: one left out is removed). The tools are the daemon's
 *  fixed preset: research on the web, memory, and read-only market and suggestion tools,
 *  plus `spawn` when `maxSpawn` is above 0. */
export interface AgentWriteBody {
  readonly id?: string
  readonly name: string
  readonly description?: string
  readonly systemPrompt: string
  readonly focus?: AgentFocusWire
  readonly maxDailyUsd?: number
  readonly modelTier?: string
  /** 1 to 4 lets the agent start that many child agents at once; 0 or left out, none. */
  readonly maxSpawn?: number
  readonly look?: AgentLookWire
}

/** POST /v1/agents/reload: the agents read off disk, and each file left out with the reason. */
export interface AgentsReloadWire {
  readonly loaded: readonly string[]
  readonly skipped: readonly { readonly id: string; readonly reason: string }[]
}

/** DELETE /v1/agents/:id. Its memory, sessions, spend and track record stay. */
export interface AgentDeletedWire {
  /** Schedules that were on and are now paused; the operator turns them back on. */
  readonly pausedSchedules: number
}
