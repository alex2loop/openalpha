import type { TargetedEvent } from 'preact'

import { ASSISTANT } from '@/web/scene/sim/actors/roster'
import { lookOf } from '@/web/scene/sprites/parts'
import { agents, selectAgent, selectedAgentId } from '@/web/state/agents'
import { isNotSent } from '@/web/state/command'
import { tr } from '@/web/text/tr'
import { Portrait } from '@/web/ui/kit/portrait'

// The option standing for the assistant; agent ids are never empty.
const ASSISTANT_VALUE = ''
const WHO_PORTRAIT_PX = 24

/** Who receives what is typed: the assistant or one of the operator's own agents. */
export function WhoChip() {
  return (
    <label class="who-chip" title={tr('ui.office.who.tip')}>
      <span class="sr">{tr('ui.office.who.tip')}</span>
      <Portrait look={lookOfPicked()} size={WHO_PORTRAIT_PX} />
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

function lookOfPicked() {
  const agent = agents.value.find((held) => held.id === selectedAgentId.value)

  return agent === undefined
    ? lookOf(ASSISTANT, 'assistant')
    : lookOf(agent.id, undefined, agent.look)
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
