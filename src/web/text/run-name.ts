import { hasMessage, type MessageKey } from '@/i18n'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

const COMMAND_PREFIX = '/'
/** The channel a run the daemon starts on a schedule carries. */
const SCHEDULE_CHANNEL = 'cron'

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

/** An agent's name: a persona the catalog names by that name, any other by its id (an own agent's id
 *  is its name). */
export function formatAgentName(agentId: string): string {
  const key = `trading.debate.role.${agentId}`

  return hasMessage(locale.value, key) ? tr(key as MessageKey) : agentId
}
