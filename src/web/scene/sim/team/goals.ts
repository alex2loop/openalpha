import type { AgentWire } from '@/app/server/wire/agents'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, DeskFocus } from '@/web/scene/types'
import type { Run } from '@/web/state/live'
import { kidActorIdOf, ownActorIdOf } from '@/web/scene/sim/actors/roster'
import { SEAT_TARGET } from '@/web/scene/sim/vocabulary'

/** At most this many temporary children are drawn at once; the oldest come first. */
export const MAX_CHILD_ACTORS = 12
// A spawned child's title is "role: goal".
const TITLE_SEPARATOR = ': '
const BANK_SECTOR = 'banks'
const CRYPTO_MARKET = 'crypto'
const GOLD_MARKETS: ReadonlySet<string> = new Set(['gold', 'gold-vn'])

/** A run a parent started with the `spawn` tool: it has a parent and a "role: goal" title. */
type KidRun = Run & { readonly parentRunId: string; readonly title: string }

/** The own agent's run under way: its oldest top-level one. */
export function agentRunOf(runs: readonly Run[], agentId: string): Run | undefined {
  return runs
    .filter((run) => isAgentRun(run, agentId) && run.parentRunId === undefined)
    .sort((a, b) => a.startedAt - b.startedAt)[0]
}

// Every run the own agent owns now, children of its own commands included.
function isAgentRun(run: Run, agentId: string): boolean {
  return run.kind === 'agent' && run.agentId === agentId
}

/** The temporary children at work, oldest first, at most `MAX_CHILD_ACTORS`. */
export function kidRunsOf(runs: readonly Run[]): readonly KidRun[] {
  return runs
    .filter(isKidRun)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, MAX_CHILD_ACTORS)
}

/** The role a parent gave its child: the title before its goal. */
export function kidRoleOf(title: string): string {
  const end = title.indexOf(TITLE_SEPARATOR)

  return end < 0 ? title : title.slice(0, end)
}

/** What the team floor's people work on, worded as the vocabulary words the built-in crew: an own
 *  agent types at its desk on its run, a child on its own. Pure, like `goalsFor`. */
export function teamGoalsFor(
  runs: readonly Run[],
  agents: readonly AgentWire[]
): ReadonlyMap<ActorId, Goal> {
  const goals = new Map<ActorId, Goal>()

  for (const agent of agents) {
    const run = agentRunOf(runs, agent.id)

    if (run !== undefined) {
      goals.set(ownActorIdOf(agent.id), toWorkGoal(run))
    }
  }

  for (const run of kidRunsOf(runs)) {
    goals.set(kidActorIdOf(run.runId), toWorkGoal(run))
  }

  return goals
}

/** The prop an agent's desk carries, read off its focus: banks a safe, crypto a candle screen,
 *  gold a bar, any other share a piggy bank. */
export function deskFocusOf(agent: AgentWire): DeskFocus {
  const markets = agent.focus?.markets ?? []

  if (agent.focus?.sectors?.includes(BANK_SECTOR) === true) {
    return 'safe'
  }

  if (markets.includes(CRYPTO_MARKET)) {
    return 'candles'
  }

  return markets.some((market) => GOLD_MARKETS.has(market)) ? 'gold' : 'piggy'
}

function isKidRun(run: Run): run is KidRun {
  return run.parentRunId !== undefined && run.title !== undefined
}

function toWorkGoal(run: Run): Goal {
  return {
    kind: 'work',
    target: SEAT_TARGET,
    pose: 'type',
    runId: run.runId,
    since: run.progress?.at ?? run.startedAt,
  }
}
