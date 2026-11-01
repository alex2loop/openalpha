import type { AgentDetailWire } from '@/app/server/wire/agents'
import type { AgentView } from '@/web/ui/agent/agent-view'
import { SHARED_FOCUS } from '@/web/state/agents'
import { findMarket } from '@/web/state/market'
import { formatUsd } from '@/web/text/figures'
import { ABSENT_CELL, joinList } from '@/web/text/glyphs'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { openAgentForm } from '@/web/ui/agent/form/agent-form'
import { Relations } from '@/web/ui/agent/relations'
import { Reputation } from '@/web/ui/agent/reputation'
import { Button } from '@/web/ui/kit/button'

interface ProfileProps {
  readonly view: AgentView
  readonly detail: AgentDetailWire
  /** Reads the agent again once the form saved it. */
  readonly onSaved: () => void
}

interface Fact {
  readonly label: string
  readonly value: string
}

/** "Hồ sơ": what the agent follows and how it may spend, read-only, with "Sửa hồ sơ" for one of
 *  the operator's own; then its standing and how it sits with the others. */
export function Profile({ view, detail, onSaved }: ProfileProps) {
  return (
    <>
      <dl class="agent-facts">
        {buildFacts(view, detail).map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {detail.editable && (
        <Button size="small" onClick={() => openAgentForm({ detail, onSaved })}>
          {tr('ui.office.agent.editProfile')}
        </Button>
      )}
      {view.agent !== undefined && <Reputation agent={view.agent} />}
      {view.agent !== undefined && <Relations agent={view.agent} />}
    </>
  )
}

function buildFacts(view: AgentView, detail: AgentDetailWire): readonly Fact[] {
  const { focus } = detail
  const sectors = focus?.sectors ?? []

  return [
    { label: tr('ui.office.form.markets'), value: describeFocus(view, detail) },
    {
      label: tr('ui.office.common.horizon'),
      value: focus?.horizon === undefined ? ABSENT_CELL : tr(`trading.horizon.${focus.horizon}`),
    },
    ...(sectors.length === 0
      ? []
      : [{ label: tr('ui.office.agent.sectors'), value: joinList(sectors.map(sectorName)) }]),
    {
      label: tr('ui.office.form.spawn'),
      value:
        detail.maxSpawn === undefined || detail.maxSpawn === 0
          ? tr('ui.office.agent.spawnOff')
          : tr('ui.office.agent.spawnOn', { max: detail.maxSpawn }),
    },
    {
      label: tr('ui.office.form.model'),
      value: detail.modelTier ?? tr('ui.office.form.modelDefault'),
    },
    {
      label: tr('ui.office.form.budget'),
      value: detail.maxDailyUsd === undefined ? ABSENT_CELL : formatUsd(detail.maxDailyUsd),
    },
  ]
}

// The daemon words an own agent's focus; a built-in one is named by its markets.
function describeFocus(view: AgentView, detail: AgentDetailWire): string {
  const markets = detail.focus?.markets ?? []

  if (view.agent !== undefined) {
    return view.agent.focusKey === SHARED_FOCUS
      ? tr('ui.office.agent.sameView')
      : view.agent.focusLabel
  }

  return markets.length === 0
    ? tr('ui.office.agent.sameView')
    : joinList(markets.map((market) => findMarket(market)?.label ?? market))
}
