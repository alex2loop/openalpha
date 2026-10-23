import type { AgentId } from '@/core/ids'
import type { RunServices } from '@/engine/types/run'
// Side-effect import: merges engine's BusEventMap declarations so bus.emit('budget_exhausted') typechecks.
import '@/engine/events'

type ExhaustionServices = Pick<RunServices, 'costTracker' | 'bus'>

interface PeriodSpend {
  readonly agentId: AgentId
  readonly period: 'daily' | 'monthly'
  readonly spent: number
  readonly cap: number
  readonly now: number
}

/** Announces a period whose settled spend has reached its cap: the test the inbound queue refuses on,
 *  and stricter than the `>` that halts a run. A refusal because one estimate would cross the cap
 *  (daily, monthly, or the run budget: the smaller of the daily and per-run caps) reaches this
 *  helper too, but settled spend is still under the cap, so it stays silent. The tracker lets each
 *  period through once. */
export function emitIfExhausted(services: ExhaustionServices, agentId: AgentId, now: number): void {
  const snapshot = services.costTracker.snapshot(now)

  announce(services, {
    agentId,
    period: 'daily',
    spent: snapshot.dailySpentUsd,
    cap: snapshot.dailyCapUsd,
    now,
  })
  announce(services, {
    agentId,
    period: 'monthly',
    spent: snapshot.monthlySpentUsd,
    cap: snapshot.monthlyCapUsd,
    now,
  })
}

function announce(services: ExhaustionServices, input: PeriodSpend): void {
  const { now, ...event } = input

  if (
    event.cap > 0 &&
    event.spent >= event.cap &&
    services.costTracker.markExhausted(event.period, now)
  ) {
    services.bus.emit('budget_exhausted', event)
  }
}
