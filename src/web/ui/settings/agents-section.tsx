import { agents } from '@/web/state/agents'
import { openView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { openAgentForm } from '@/web/ui/agent/form/agent-form'
import { Button } from '@/web/ui/kit/button'
import { closeModal } from '@/web/ui/kit/modal'
import { BudgetRow } from '@/web/ui/settings/budget'
import { ModelChainRow } from '@/web/ui/settings/model-chain'
import { ActionRow } from '@/web/ui/settings/row'

/** Agent và AI: the operator's own agents, the models the daemon tries in order, and the AI budget. */
export function AgentsSection() {
  return (
    <>
      <OwnAgents />
      <ModelChainRow />
      <BudgetRow />
    </>
  )
}

function OwnAgents() {
  const own = agents.value

  return (
    <ActionRow
      title={tr('ui.office.common.yourAgents')}
      summary={own.length === 0 ? tr('ui.office.settings.noAgents') : ''}
    >
      {own.map((agent) => (
        <Button
          key={agent.id}
          size="small"
          onClick={() => {
            closeModal()
            openView({ agent: agent.id })
          }}
        >
          {agent.paused ? tr('ui.office.who.paused', { name: agent.name }) : agent.name}
        </Button>
      ))}
      <Button size="small" onClick={() => openAgentForm()}>
        {tr('ui.office.form.addTitle')}
      </Button>
    </ActionRow>
  )
}
