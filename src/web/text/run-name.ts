import { tr } from '@/web/text/tr'

const COMMAND_PREFIX = '/'
// The debate personas, whose names the daemon's catalog already carries.
const DEBATE_ROLES = [
  'bull-researcher',
  'bear-researcher',
  'portfolio-manager',
  'trader',
  'risk-analyst',
  'claim-verifier',
  'market-analyst',
] as const

interface Named {
  readonly kind: 'agent' | 'command'
  readonly name: string
  readonly title?: string
}

/** A run's title, else its agent id, or its command as the operator types it. */
export function formatRunName(run: Named): string {
  return run.title ?? commandOf(run) ?? run.name
}

/** The command as the operator types it; absent for an agent run. */
export function commandOf(run: Named): string | undefined {
  return run.kind === 'command' ? `${COMMAND_PREFIX}${run.name}` : undefined
}

/** An agent's name: a debate persona by its catalog name, any other by its id (an own agent's id
 *  is its name). */
export function formatAgentName(agentId: string): string {
  const role = DEBATE_ROLES.find((held) => held === agentId)

  return role === undefined ? agentId : tr(`trading.debate.role.${role}`)
}
