import type { ActivityRowWire } from '@/app/server/wire/activity'
import type { AgentDetailWire, AgentWire } from '@/app/server/wire/agents'
import { agents } from '@/web/state/agents'
import { type Run, runs } from '@/web/state/live'
import { tr } from '@/web/text/tr'

/** The assistant's panel id. The daemon knows it as its default agent, `chat`, which owns its jobs
 *  and runs. */
export const ASSISTANT_ID = 'assistant'
const DAEMON_ASSISTANT_ID = 'chat'

/** What one agent shares with every section of its tab. */
export interface AgentView {
  readonly agentId: string
  /** The id the daemon files this person's jobs and runs under. */
  readonly daemonId: string
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
  const daemonId = agentId === ASSISTANT_ID ? DAEMON_ASSISTANT_ID : agentId

  return {
    agentId,
    daemonId,
    agent,
    name:
      agentId === ASSISTANT_ID
        ? tr('ui.office.role.assistant')
        : (agent?.name ?? detail?.name ?? agentId),
    run: runs.value.find(
      (run) => run.kind === 'agent' && run.agentId === daemonId && run.parentRunId === undefined
    ),
    rows: rows.filter((row) => row.agentId === daemonId),
  }
}
