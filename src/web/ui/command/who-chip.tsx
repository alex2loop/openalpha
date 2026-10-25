import type { TargetedEvent } from 'preact'

import { agents, selectAgent, selectedAgentId } from '@/web/state/agents'
import { isNotSent } from '@/web/state/command'
import { tr } from '@/web/text/tr'

// The option standing for the assistant; agent ids are never empty.
const ASSISTANT_VALUE = ''

/** Who receives what is typed: the assistant or one of the operator's own agents. */
export function WhoChip() {
  return (
    <label class="who-chip" title={tr('ui.office.who.tip')}>
      <span class="sr">{tr('ui.office.who.tip')}</span>
      <select value={selectedAgentId.value ?? ASSISTANT_VALUE} onChange={onPick}>
        <option value={ASSISTANT_VALUE}>{tr('ui.office.role.assistant')}</option>
        {agents.value.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.paused ? tr('ui.office.who.paused', { name: agent.name }) : agent.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// The list keeps showing the agent the daemon last accepted; the answer to `/agent` moves it.
function onPick(event: TargetedEvent<HTMLSelectElement>): void {
  const element = event.currentTarget
  const value = element.value

  element.value = selectedAgentId.value ?? ASSISTANT_VALUE

  if (!selectAgent(value === ASSISTANT_VALUE ? undefined : value)) {
    isNotSent.value = true
  }
}
