import type { MessageKey } from '@/i18n'
import type { AgentDraft } from '@/web/state/agents'
import { view } from '@/web/scene/view'
import { agents, agentsRead, requestAgentForm } from '@/web/state/agents'
import { tr } from '@/web/text/tr'

import './empty-team.css'

interface Template {
  readonly name: MessageKey
  readonly prompt: MessageKey
  readonly hint: MessageKey
  readonly focus: NonNullable<AgentDraft['focus']>
}

const TEAM_FLOOR = 'team'
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

/** The team floor with no agent yet: three templates that prefill the agent form, and a blank one. */
export function EmptyTeam() {
  if (view.value.floor !== TEAM_FLOOR || !agentsRead.value || agents.value.length > 0) {
    return null
  }

  return (
    <section class="empty-team glass">
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
