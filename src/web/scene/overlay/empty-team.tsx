import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import type { MessageKey } from '@/i18n'
import type { AgentDraft } from '@/web/state/agents'
import { view } from '@/web/scene/view'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { agents, agentsFailed, agentsRead, requestAgentForm } from '@/web/state/agents'
import { tr } from '@/web/text/tr'
import { armDismiss } from '@/web/ui/kit/popover'

import './empty-team.css'

interface Template {
  readonly name: MessageKey
  readonly prompt: MessageKey
  readonly hint: MessageKey
  readonly focus: NonNullable<AgentDraft['focus']>
}

// Three ways to start, each a draft the form opens with; the operator edits it before saving.
const TEMPLATES: readonly Template[] = Object.freeze([
  {
    name: 'ui.office.team.tplDividend',
    prompt: 'ui.office.team.tplDividendPrompt',
    hint: 'ui.office.team.tplDividendHint',
    focus: { markets: ['equity-vn'], horizon: 'long' },
  },
  {
    name: 'ui.office.team.tplBanks',
    prompt: 'ui.office.team.tplBanksPrompt',
    hint: 'ui.office.team.tplBanksHint',
    focus: { markets: ['equity-vn'], sectors: ['banks'] },
  },
  {
    name: 'ui.office.team.tplCrypto',
    prompt: 'ui.office.team.tplCryptoPrompt',
    hint: 'ui.office.team.tplCryptoHint',
    focus: { markets: ['crypto'], horizon: 'short' },
  },
])

/** The team floor with no agent yet: three templates that prefill the agent form, and a blank one.
 *  Before the first good read a failed one says so rather than leaving the floor blank. Esc or a
 *  press outside puts the templates away until the floor is entered again. */
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
      <section class="empty-team glass">
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
    <section ref={panel} class="empty-team glass">
      <h3>{tr('ui.office.team.emptyTitle')}</h3>
      <div class="empty-team-templates">
        {TEMPLATES.map((template) => (
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

function toDraft(template: Template): Partial<AgentDraft> {
  return {
    name: tr(template.name),
    systemPrompt: tr(template.prompt),
    focus: template.focus,
  }
}
