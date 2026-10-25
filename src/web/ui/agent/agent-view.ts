import type { ActivityRowWire } from '@/app/server/wire/activity'
import type { AgentDetailWire, AgentWire } from '@/app/server/wire/agents'
import { agents } from '@/web/state/agents'
import { type Run, runs } from '@/web/state/live'

/** What one agent shares with every section of its tab. */
export interface AgentView {
  readonly agentId: string
  /** One of the operator's own agents; absent for a built-in one. */
  readonly agent: AgentWire | undefined
  readonly name: string
  /** Its top-level run working now. */
  readonly run: Run | undefined
  /** The runs it finished today, newest first. */
  readonly rows: readonly ActivityRowWire[]
}

/** The agent as the roster, the live feed and today's runs know it. */
export function buildAgentView(
  agentId: string,
  detail: AgentDetailWire | undefined,
  rows: readonly ActivityRowWire[]
): AgentView {
  const agent = agents.value.find((held) => held.id === agentId)

  return {
    agentId,
    agent,
    name: agent?.name ?? detail?.name ?? agentId,
    run: runs.value.find(
      (run) => run.kind === 'agent' && run.agentId === agentId && run.parentRunId === undefined
    ),
    rows: rows.filter((row) => row.agentId === agentId),
  }
}
