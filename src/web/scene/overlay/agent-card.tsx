import type { AgentWire } from '@/app/server/wire/agents'
import type { ScheduleRow } from '@/app/server/wire/system'
import type { CardPlace } from '@/web/scene/overlay/team-pass'
import { formatDay, pluralKey } from '@/i18n'
import { latestCalls } from '@/web/scene/data/team-calls'
import { overlayView } from '@/web/scene/overlay/overlay'
import { CARD_H_PX, CARD_W_PX } from '@/web/scene/overlay/team-pass'
import { agentRunOf } from '@/web/scene/sim/team/goals'
import { agents, reputationLine } from '@/web/state/agents'
import { runs } from '@/web/state/live'
import { openView } from '@/web/state/panel'
import { locale, state } from '@/web/state/session'
import { formatUsd } from '@/web/text/figures'
import { formatRunName } from '@/web/text/run-name'
import { describeEvent } from '@/web/text/schedule-event'
import { formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'

import './agent-card.css'

// A spend bar never shrinks below a sliver, so a started day reads as started.
const MIN_BAR_PCT = 3
const FULL_PCT = 100

type Status = 'running' | 'idle' | 'paused'

/** The cards over the own agents' heads on the team floor, where the overlay's layout put them. */
export function AgentCards() {
  const places = overlayView.value.cards

  if (places.length === 0) {
    return null
  }

  return (
    <div class="agent-cards">
      {places.map((place) => (
        <AgentCard key={place.agentId} place={place} />
      ))}
    </div>
  )
}

function AgentCard({ place }: { readonly place: CardPlace }) {
  const agent = agents.value.find((held) => held.id === place.agentId)

  if (agent === undefined) {
    return null
  }

  const status = statusOf(agent)

  return (
    <button
      type="button"
      class="agent-card glass"
      style={{
        left: `${place.rect.x}px`,
        top: `${place.rect.y}px`,
        width: `${CARD_W_PX}px`,
        height: `${CARD_H_PX}px`,
        transform: `scale(${place.zoom})`,
      }}
      onClick={() => openView({ agent: agent.id })}
    >
      <span class="agent-card-head">
        <i class={`agent-card-dot is-${status}`} />
        <b>{agent.name}</b>
      </span>
      <span class="agent-card-line">{lineOf(agent, place)}</span>
      <LastCall agentId={agent.id} />
      <ReputationLine agent={agent} />
      <SpendBar agent={agent} />
    </button>
  )
}

function statusOf(agent: AgentWire): Status {
  if (agent.paused) {
    return 'paused'
  }

  return agentRunOf(runs.value, agent.id) === undefined ? 'idle' : 'running'
}

// Paused, then its children, then the run under way, then what it waits for or runs next.
function lineOf(agent: AgentWire, place: CardPlace): string {
  const run = agentRunOf(runs.value, agent.id)

  if (agent.paused) {
    return tr('ui.office.team.paused')
  }

  if (place.kidsOpen > 0) {
    const count = place.kidsOpen

    return tr(pluralKey(count, 'ui.office.team.kidsWaitOne', 'ui.office.team.kidsWait'), { count })
  }

  if (place.kidsBack > 0) {
    return tr('ui.office.team.kidsBack')
  }

  return run === undefined
    ? scheduleLineOf(agent)
    : tr('ui.office.team.running', { what: formatRunName(run) })
}

function scheduleLineOf(agent: AgentWire): string {
  const rows = (state.value?.schedules ?? []).filter(
    (row) => row.agentId === agent.id && row.enabled !== false
  )
  const waiting = rows.find((row) => row.event !== undefined)?.event
  const timeZone = state.value?.timeZone
  const next = nextRunOf(rows)

  if (waiting !== undefined) {
    return tr('ui.office.agent.waiting', { what: describeEvent(waiting) })
  }

  return next === undefined || timeZone === undefined
    ? tr('ui.office.agent.noPlan')
    : tr('ui.office.team.schedule', { time: formatWhen(next, timeZone) })
}

function nextRunOf(rows: readonly ScheduleRow[]): number | undefined {
  const times = rows.flatMap((row) => (typeof row.nextRunAt === 'number' ? [row.nextRunAt] : []))

  return times.length === 0 ? undefined : Math.min(...times)
}

function LastCall({ agentId }: { readonly agentId: string }) {
  const call = latestCalls.value.get(agentId)

  if (call === undefined) {
    return null
  }

  return (
    <span class="agent-card-meta">
      {tr('ui.office.team.last', {
        ticker: call.instrument.ticker,
        verdict: tr(`trading.action.${call.action}`),
        when: formatDay(locale.value, call.at),
      })}
    </span>
  )
}

function ReputationLine({ agent }: { readonly agent: AgentWire }) {
  const minSample = state.value?.trackRecordMinSample

  return minSample === undefined ? null : (
    <span class="agent-card-meta">{reputationLine(agent, minSample)}</span>
  )
}

// Today's spend against the agent's own ceiling; an agent with none answers to the overall cap.
function SpendBar({ agent }: { readonly agent: AgentWire }) {
  const cap = agent.maxDailyUsd

  if (cap === undefined || cap <= 0) {
    return null
  }

  const pct = Math.min(FULL_PCT, Math.max(MIN_BAR_PCT, (agent.spentTodayUsd / cap) * FULL_PCT))
  const title = tr('ui.office.team.spend', {
    spent: formatUsd(agent.spentTodayUsd),
    cap: formatUsd(cap),
  })

  return (
    <span class="agent-card-bar" title={title}>
      <i style={{ width: `${pct}%` }} />
    </span>
  )
}
