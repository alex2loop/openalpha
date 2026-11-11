import { hasMessage, type MessageKey } from '@/i18n'
import { agents } from '@/web/state/agents'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

const COMMAND_PREFIX = '/'
/** The channel a run the daemon starts on a schedule carries. */
const SCHEDULE_CHANNEL = 'cron'

// The built-in agents outside the debate, named as the office names the same people.
const AGENT_NAME_KEYS: ReadonlyMap<string, MessageKey> = new Map([
  ['chat', 'ui.office.role.assistant'],
  ['deep-researcher', 'ui.office.role.researcher'],
  ['research-planner', 'ui.office.role.planner'],
  ['research-crawler', 'ui.office.role.crawler'],
  ['research-reviewer', 'ui.office.role.reviewer'],
  ['research-synthesizer', 'ui.office.role.synth'],
  ['reviewer', 'ui.office.role.reviewer'],
  ['theme-analyst', 'ui.office.role.theme'],
])

interface Named {
  readonly kind: 'agent' | 'command'
  readonly name: string
  readonly title?: string
  readonly channelId?: string
}

/** A run's title, else what a scheduled command is named, else its agent id, or its command as the
 *  operator types it. */
export function formatRunName(run: Named): string {
  return run.title ?? scheduledNameOf(run) ?? commandOf(run) ?? run.name
}

function scheduledNameOf(run: Named): string | undefined {
  if (run.kind !== 'command' || run.channelId !== SCHEDULE_CHANNEL) {
    return undefined
  }

  const key = `ui.office.run.scheduled.${run.name}`

  return hasMessage(locale.value, key) ? tr(key as MessageKey) : undefined
}

/** The command as the operator types it; absent for an agent run. */
export function commandOf(run: Named): string | undefined {
  return run.kind === 'command' ? `${COMMAND_PREFIX}${run.name}` : undefined
}

/** An agent's name: a debate persona by the catalog's name, any other built-in agent by the
 *  office's, an own agent by its own name; the id only for an agent with none. */
export function formatAgentName(agentId: string): string {
  const key = `trading.debate.role.${agentId}`

  if (hasMessage(locale.value, key)) {
    return tr(key as MessageKey)
  }

  const builtIn = AGENT_NAME_KEYS.get(agentId)

  return builtIn === undefined
    ? (agents.value.find((agent) => agent.id === agentId)?.name ?? agentId)
    : tr(builtIn)
}
