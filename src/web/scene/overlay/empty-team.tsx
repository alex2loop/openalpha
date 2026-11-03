import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import type { AgentTemplate } from '@/web/scene/world/regions'
import type { AgentDraft } from '@/web/state/agents'
import { regionPack } from '@/web/scene/data/home'
import { view } from '@/web/scene/view'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { agents, agentsFailed, agentsRead, requestAgentForm } from '@/web/state/agents'
import { tr } from '@/web/text/tr'
import { armDismiss } from '@/web/ui/kit/popover'

import './empty-team.css'

/** The team floor with no agent yet: the home region's three templates, each a draft the agent form
 *  opens with, and a blank one. Before the first good read a failed one says so rather than leaving
 *  the floor blank. Esc or a press outside puts the templates away until the floor is entered
 *  again. */
export function EmptyTeam() {
  const isEmptyFloor = view.value.floor === TEAM_FLOOR && agents.value.length === 0
  const isDismissed = useSignal(false)

  useEffect(() => {
    isDismissed.value = false
  }, [isEmptyFloor, isDismissed])

  if (!isEmptyFloor) {
    return null
  }

  if (!agentsRead.value) {
    return agentsFailed.value ? (
      <section class="empty-team glass is-strong">
        <p class="failure-line" role="alert">
          {tr('ui.office.team.readFailed')}
        </p>
      </section>
    ) : null
  }

  return isDismissed.value ? null : <Templates isDismissed={isDismissed} />
}

function Templates({ isDismissed }: { readonly isDismissed: Signal<boolean> }) {
  const panel = useRef<HTMLElement>(null)

  useLayoutEffect(
    () =>
      armDismiss({
        panel,
        onDismiss: () => {
          isDismissed.value = true
        },
      }),
    [isDismissed]
  )

  return (
    <section ref={panel} class="empty-team glass is-strong">
      <h3>{tr('ui.office.team.emptyTitle')}</h3>
      <div class="empty-team-templates">
        {regionPack.value.agentTemplates.map((template) => (
          <button
            key={template.name}
            type="button"
            class="empty-team-template"
            onClick={() => requestAgentForm(toDraft(template))}
          >
            <b>{tr(template.name)}</b>
            <span class="meta">{tr(template.hint)}</span>
          </button>
        ))}
      </div>
      <button type="button" class="empty-team-scratch" onClick={() => requestAgentForm()}>
        {tr('ui.office.team.scratch')}
      </button>
    </section>
  )
}

function toDraft(template: AgentTemplate): Partial<AgentDraft> {
  return {
    name: tr(template.name),
    systemPrompt: tr(template.prompt),
    focus: template.focus,
  }
}
