import type { LruMap } from '@/core/utils/collections'
import type { ExitNoticeDeps } from '@/trading/features/alerts/exit-notices'
import type { ExitPlanner, RecordedPlanResult } from '@/trading/features/suggestion/exit-plan/types'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { Market, MarketCapabilities, MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { noticePlanned, noticeStopRaised } from '@/trading/features/alerts/exit-notices'
import {
  armsExit,
  framedDirectionOf,
  planStopOf,
  planTakeProfitOf,
} from '@/trading/features/suggestion/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { LEVEL_BARS_SESSIONS, resolveTrailBounds } from '@/trading/markets/levels'

/** A trail series the market could not serve, a plan that threw, or a holding the planner could not
 *  plan is asked again after this, not on every tick: each reaches a provider, and an outage would
 *  otherwise cost one request per held name a minute. */
const PLAN_RETRY_MS = 15 * 60_000

/** What the two plan-maintenance passes read — a slice of what the reconcile pass holds, declared
 *  here rather than imported from `exits.ts`, which consumes these. */
interface ExitPlanDeps extends ExitNoticeDeps {
  readonly suggestions: SuggestionStore
  readonly markets: MarketRegistry
  readonly exitPlans: ExitPlanner
  /** Plan id to the settled session its trail was last computed for. The trail is a function of
   *  settled closes, so asking again inside one session re-reads a year of bars to reach the same
   *  answer - and reaches the provider whenever the store has not caught up yet. */
  readonly trailedThrough: LruMap<string, TradingDay>
  /** Plan id to the instant its trail may read the series again after the market could not serve it. */
  readonly trailRetryAt: LruMap<string, number>
  /** Plan id to the settled session its replacement by a newer strategy version was last answered
   *  in, by a new plan or by a refusal. A replacement that threw leaves it unset. */
  readonly replannedOn: LruMap<string, TradingDay>
  /** Plan id, or the instrument key of a holding with no plan, to the instant planning may be tried
   *  again after it threw or the planner could not plan it. */
  readonly replanRetryAt: LruMap<string, number>
}

interface PlanHoldingInput {
  readonly instrument: InstrumentRef
  /** The plan the holding is watched on now; null where nothing watches it. */
  readonly standing: StoredSuggestion | null
  readonly delivery: DeliveryAddress
  readonly options: OperationTickOptions
}

/** The plan a holding arms from this tick: planned, then trailed. Each step fails alone, on that one
 *  holding, and the plan it started from stays armed: a replacement that threw leaves the standing
 *  plan, a tape that threw leaves the plan untrailed. The other holdings are planned as usual; only
 *  an abort stops the pass. */
export async function planAndTrail(
  deps: ExitPlanDeps,
  input: PlanHoldingInput
): Promise<StoredSuggestion | null> {
  const { instrument, standing, delivery, options } = input
  const planned = await isolated(deps, instrument, {
    name: 'plan',
    run: () => planHolding(deps, input),
    fallback: standing,
  })

  if (planned === null) {
    return null
  }

  return isolated(deps, instrument, {
    name: 'trail',
    run: () => trailPlanStop(deps, { instrument, plan: planned, delivery, options }),
    fallback: planned,
  })
}

async function isolated<T>(
  deps: ExitPlanDeps,
  instrument: InstrumentRef,
  step: { readonly name: 'plan' | 'trail'; readonly fallback: T; run(): Promise<T> }
): Promise<T> {
  try {
    return await step.run()
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.exit_holding_failed', {
      ticker: instrument.ticker,
      step: step.name,
      err: formatErrForLog(err),
    })

    return step.fallback
  }
}

/** The settled session a replacement is due for, or null: only for a plan an older strategy version
 *  priced, and not again once that session's replacement was answered. */
function replanDayOf(
  deps: ExitPlanDeps,
  plan: StoredSuggestion,
  at: { readonly market: Market | null; readonly now: number }
): TradingDay | null {
  const { market, now } = at

  if (market === null || plan.strategyVersion === market.manifest.strategyVersion) {
    return null
  }

  const settled = resolveSettledDay(market.manifest.calendar, now)

  return deps.replannedOn.get(plan.id) === settled ? null : settled
}

function movedLevels(from: StoredSuggestion, to: StoredSuggestion): boolean {
  return planStopOf(from) !== planStopOf(to) || planTakeProfitOf(from) !== planTakeProfitOf(to)
}

/** A replacement that throws leaves the standing plan armed; a holding with no plan has nothing to
 *  fall back to, so its throw propagates to the caller's log. Either one, and a holding the planner
 *  could not plan, is tried again after `PLAN_RETRY_MS`, not on every tick. */
async function planCaught(
  deps: ExitPlanDeps,
  input: PlanHoldingInput
): Promise<RecordedPlanResult | null> {
  const { instrument, standing, options } = input
  const retryKey = standing?.id ?? buildInstrumentKey(instrument)

  if (options.now < (deps.replanRetryAt.get(retryKey) ?? 0)) {
    return null
  }

  try {
    const planned = await deps.exitPlans.plan({
      instrument,
      now: options.now,
      signal: options.signal,
    })

    if (standing === null && planned.kind === 'unplanned') {
      deps.replanRetryAt.set(retryKey, options.now + PLAN_RETRY_MS)
    }

    return planned
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.replanRetryAt.set(retryKey, options.now + PLAN_RETRY_MS)

    if (standing === null) {
      throw err
    }

    deps.logger.warn('trading.exit_replan_failed', {
      ticker: instrument.ticker,
      err: formatErrForLog(err),
    })

    return null
  }
}

/** Plans a held name nothing watches, and replaces a plan an older strategy version priced, both
 *  from the settled close. The operator is told when a level is new or moved. The notice is
 *  best-effort: the plan is already stored and arms below whether or not the send lands. */
async function planHolding(
  deps: ExitPlanDeps,
  input: PlanHoldingInput
): Promise<StoredSuggestion | null> {
  const { instrument, standing, options } = input
  const market = deps.markets.find(instrument.market)

  const replanDay =
    standing === null ? null : replanDayOf(deps, standing, { market, now: options.now })

  if (standing !== null && replanDay === null) {
    return standing
  }

  const planned = await planCaught(deps, input)

  // Only a replacement that answered spends the day: a refusal the store gives is not re-read from
  // the bars every tick, while one that threw (a provider outage) is retried after PLAN_RETRY_MS.
  if (standing !== null && replanDay !== null && planned !== null) {
    deps.replannedOn.set(standing.id, replanDay)
  }

  if (planned?.kind !== 'planned') {
    return planned?.kind === 'standing' ? planned.plan : standing
  }

  if (standing === null || movedLevels(standing, planned.plan)) {
    await noticePlanned(deps, { ...input, market, plan: planned.plan })
  }

  return planned.plan
}

interface TrailPlanInput {
  readonly instrument: InstrumentRef
  readonly plan: StoredSuggestion
  readonly delivery: DeliveryAddress
  readonly options: OperationTickOptions
}

/** The stop a re-run would set today, written back so every reader of the plan sees it: only a long
 *  plan, only a market that trails, only upward, and only below the settled close. A series the
 *  market cannot serve leaves the plan as it stands - an unreadable tape is not a reason to move a
 *  stop. A raise is told to the operator, because no order at an exchange follows it. */
async function trailPlanStop(deps: ExitPlanDeps, input: TrailPlanInput): Promise<StoredSuggestion> {
  const { instrument, plan, options } = input
  const market = deps.markets.find(instrument.market)
  const bars = market?.capabilities.bars

  if (!isTrailable(plan) || market === null || market.trail === undefined || bars === undefined) {
    return plan
  }

  const settled = resolveSettledDay(market.manifest.calendar, options.now)

  if (deps.trailedThrough.get(plan.id) === settled) {
    return plan
  }

  const series = await readTrailSeries(deps, { plan, bars, settled, options })

  if (series === undefined) {
    return plan
  }

  const bounds = await resolveTrailBounds(market, {
    instrument,
    asOf: settled,
    now: options.now,
    signal: options.signal,
  })

  const raise = raiseOf(plan, market.trail.stopFor(series, bounds), series.at(-1)?.close)

  if (raise === undefined) {
    deps.trailedThrough.set(plan.id, settled)

    return plan
  }

  const raised = await deps.suggestions.raiseTrailingStop({
    id: plan.id,
    stop: raise.to,
    signal: options.signal,
  })

  // Only once the write has settled: a failed one throws past this, so the next tick tries again
  // instead of waiting a session for a raise nothing stored.
  deps.trailedThrough.set(plan.id, settled)

  if (!raised) {
    return plan
  }

  await noticeStopRaised(deps, { ...input, market, ...raise })

  return { ...plan, trailingStop: raise.to }
}

/** The settled series a trail reads, or nothing when the market could not serve it: then the read
 *  waits `PLAN_RETRY_MS` rather than reaching the provider on every tick of an outage. */
async function readTrailSeries(
  deps: ExitPlanDeps,
  input: {
    readonly plan: StoredSuggestion
    readonly bars: NonNullable<MarketCapabilities['bars']>
    readonly settled: TradingDay
    readonly options: OperationTickOptions
  }
): Promise<readonly Candle[] | undefined> {
  const { plan, options } = input

  if (options.now < (deps.trailRetryAt.get(plan.id) ?? 0)) {
    return undefined
  }

  const series = await input.bars.run({
    instrument: plan.instrument,
    asOf: input.settled,
    now: options.now,
    sessions: LEVEL_BARS_SESSIONS,
    signal: options.signal,
  })

  if (series.kind !== 'available') {
    deps.trailRetryAt.set(plan.id, options.now + PLAN_RETRY_MS)

    return undefined
  }

  return series.value
}

/** The raise the trail asks for, or nothing where it asks for none. A trail past the close is a
 *  pullback deeper than it allows, which `buildLevels` answers by keeping the entry stop. Writing it
 *  would put the stop above the market, read everywhere as breached. */
function raiseOf(
  plan: StoredSuggestion,
  trailed: number | undefined,
  close: number | undefined
): { readonly from: number; readonly to: number } | undefined {
  const from = planStopOf(plan)

  if (trailed === undefined || from === undefined || close === undefined) {
    return undefined
  }

  return trailed <= from || trailed >= close ? undefined : { from, to: trailed }
}

/** An armed plan whose position is long, which on a spot book is every one the trail applies to,
 *  tested on the framing as `findLatestExitPlan` selects: almost every held name carries a debated
 *  hold framed as a buy, and testing the action instead excluded all of them. A plan read off a
 *  sale's standing exit is not trailed, because the row's own stop belongs to the sale. */
function isTrailable(plan: StoredSuggestion): boolean {
  return framedDirectionOf(plan) === 'buy' && armsExit(plan) && plan.standingExit === undefined
}
