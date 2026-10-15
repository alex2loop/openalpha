import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { LruMap } from '@/core/utils/collections'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { ExitPlanner, RecordedPlanResult } from '@/trading/features/suggestion/exit-plan/types'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { StopCover } from '@/trading/kernel/operator/alert'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import type { StopPlacement } from '@/trading/render/stop-raised'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { renderHoldLevels } from '@/trading/features/suggestion/render/hold-levels'
import {
  armsExit,
  framedDirectionOf,
  planStopOf,
  planTakeProfitOf,
} from '@/trading/features/suggestion/types'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { LEVEL_BARS_SESSIONS, resolveTrailBounds } from '@/trading/markets/levels'
import { NOTICE_SURFACE, resolveRenderContext } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { renderBoardScaleNotes } from '@/trading/render/money'
import { renderStopRaised } from '@/trading/render/stop-raised'

/** A stop the operator set in the exchange's app is moved there by hand, never by `/trade exit`,
 *  which would place a second one beside it. */
const PLACEMENT_BY_COVER: Readonly<Record<StopCover, StopPlacement>> = Object.freeze({
  placed: 'resting',
  venue: 'by-hand',
  none: 'unguarded',
})

/** What the two plan-maintenance passes read — a slice of what the reconcile pass holds, declared
 *  here rather than imported from `exits.ts`, which consumes these. */
interface ExitPlanDeps {
  readonly suggestions: SuggestionStore
  readonly markets: MarketRegistry
  readonly exitPlans: ExitPlanner
  readonly sender: TradingNoticeSender
  readonly logger: Logger
  readonly defaultLocale: Locale
  readonly timezone: string
  /** Plan id to the settled session its trail was last computed for. The trail is a function of
   *  settled closes, so asking again inside one session re-reads a year of bars to reach the same
   *  answer - and reaches the provider whenever the store has not caught up yet. */
  readonly trailedThrough: LruMap<string, TradingDay>
  /** Plan id to the settled session a newer strategy version last tried to replace it in. */
  readonly replannedOn: LruMap<string, TradingDay>
  /** Whether a stop rests at the exchange behind each held name, keyed by `buildInstrumentKey`.
   *  Absent on an install with no exchange, where nothing could rest anywhere. */
  restingStops?(options: PortfolioAtOptions): Promise<ReadonlyMap<string, StopCover>>
}

interface PlanHoldingInput {
  readonly instrument: InstrumentRef
  /** The plan the holding is watched on now; null where nothing watches it. */
  readonly standing: StoredSuggestion | null
  readonly delivery: DeliveryAddress
  readonly options: OperationTickOptions
}

/** True at most once a settled session per plan, and only for one an older strategy version
 *  priced: a replacement the store refuses that day is not re-read from the bars every tick. */
function claimsReplan(
  deps: ExitPlanDeps,
  plan: StoredSuggestion,
  at: { readonly market: Market | null; readonly now: number }
): boolean {
  const { market, now } = at

  if (market === null || plan.strategyVersion === market.manifest.strategyVersion) {
    return false
  }

  const settled = resolveSettledDay(market.manifest.calendar, now)

  if (deps.replannedOn.get(plan.id) === settled) {
    return false
  }

  deps.replannedOn.set(plan.id, settled)

  return true
}

function movedLevels(from: StoredSuggestion, to: StoredSuggestion): boolean {
  return planStopOf(from) !== planStopOf(to) || planTakeProfitOf(from) !== planTakeProfitOf(to)
}

/** A replacement that throws leaves the standing plan armed; only a holding with no plan has
 *  nothing to fall back to. */
async function planCaught(
  deps: ExitPlanDeps,
  input: PlanHoldingInput
): Promise<RecordedPlanResult | null> {
  const { instrument, standing, options } = input

  try {
    return await deps.exitPlans.plan({ instrument, now: options.now, signal: options.signal })
  } catch (err: unknown) {
    if (standing === null || isAbortError(err)) {
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
export async function planHolding(
  deps: ExitPlanDeps,
  input: PlanHoldingInput
): Promise<StoredSuggestion | null> {
  const { instrument, standing, options } = input
  const market = deps.markets.find(instrument.market)

  if (standing !== null && !claimsReplan(deps, standing, { market, now: options.now })) {
    return standing
  }

  const planned = await planCaught(deps, input)

  if (planned?.kind !== 'planned') {
    return planned?.kind === 'standing' ? planned.plan : standing
  }

  if (standing === null || movedLevels(standing, planned.plan)) {
    await noticePlanned(deps, { ...input, market, plan: planned.plan })
  }

  return planned.plan
}

interface PlannedNotice extends PlanHoldingInput {
  readonly market: Market | null
  readonly plan: StoredSuggestion
}

async function noticePlanned(deps: ExitPlanDeps, input: PlannedNotice): Promise<void> {
  const { instrument, delivery, options, market } = input
  const outcome = await sendCaught(
    deps.sender,
    {
      target: delivery,
      locale: deps.defaultLocale,
      payload: {
        kind: 'exit-plan',
        lines: renderHoldLevels({
          locale: deps.defaultLocale,
          suggestion: input.plan,
          context: resolveRenderContext(deps.timezone, NOTICE_SURFACE),
          trailsStop: market?.trail !== undefined,
          operatorFigures: 'shown',
          ...(market?.manifest.boardLot === undefined
            ? {}
            : { boardLot: market.manifest.boardLot }),
        }),
      },
    },
    options.signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.exit_plan_notice_undelivered', { ticker: instrument.ticker, outcome })
  }
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
export async function trailPlanStop(
  deps: ExitPlanDeps,
  input: TrailPlanInput
): Promise<StoredSuggestion> {
  const { instrument, plan, options } = input
  const market = deps.markets.find(instrument.market)
  const bars = market?.capabilities.bars

  if (
    !(isLongPlan(plan) && armsExit(plan)) ||
    market === null ||
    market.trail === undefined ||
    bars === undefined
  ) {
    return plan
  }

  const settled = resolveSettledDay(market.manifest.calendar, options.now)

  if (deps.trailedThrough.get(plan.id) === settled) {
    return plan
  }

  const series = await bars.run({
    instrument,
    asOf: settled,
    now: options.now,
    sessions: LEVEL_BARS_SESSIONS,
    signal: options.signal,
  })

  if (series.kind !== 'available') {
    return plan
  }

  const bounds = await resolveTrailBounds(market, {
    instrument,
    asOf: settled,
    now: options.now,
    signal: options.signal,
  })

  deps.trailedThrough.set(plan.id, settled)

  const trailed = market.trail.stopFor(series.value, bounds)
  const current = planStopOf(plan)
  const close = series.value.at(-1)?.close

  if (trailed === undefined || current === undefined || close === undefined) {
    return plan
  }

  // A trail past the close is a pullback deeper than it allows, which `buildLevels` answers by
  // keeping the entry stop. Writing it would put the stop above the market, read everywhere as breached.
  if (trailed <= current || trailed >= close) {
    return plan
  }

  const raised = await deps.suggestions.raiseTrailingStop({
    id: plan.id,
    stop: trailed,
    signal: options.signal,
  })

  if (!raised) {
    return plan
  }

  await noticeStopRaised(deps, { ...input, market, from: current, to: trailed })

  return { ...plan, trailingStop: trailed }
}

interface StopRaisedNotice extends TrailPlanInput {
  readonly market: Market
  readonly from: number
  readonly to: number
}

/** Best-effort, like the plan notice: the raised stop is already stored and armed. */
async function noticeStopRaised(deps: ExitPlanDeps, input: StopRaisedNotice): Promise<void> {
  const { instrument, market, options } = input
  const { manifest } = market
  const quoted = {
    currency: manifest.currency,
    unit: manifest.quoteUnit,
    ...(manifest.priceDisplay === undefined ? {} : { display: manifest.priceDisplay }),
  }
  const lines = [
    ...renderStopRaised(deps.defaultLocale, {
      instrument,
      from: input.from,
      to: input.to,
      quoted,
      placement: await placementOf(deps, input),
    }),
    ...renderBoardScaleNotes(deps.defaultLocale, [{ market: instrument.market, ...quoted }]).map(
      (note) => `${INDENT[1]}${note}`
    ),
  ]
  const outcome = await sendCaught(
    deps.sender,
    {
      target: input.delivery,
      locale: deps.defaultLocale,
      payload: { kind: 'stop-raised', lines },
    },
    options.signal
  )

  if (outcome !== 'accepted') {
    deps.logger.warn('trading.stop_raised_notice_undelivered', {
      ticker: instrument.ticker,
      outcome,
    })
  }
}

/** A name no venue this tree places on holds is carried by hand. A book that could not be read is
 *  `unread`, which still names the command: the exchange may hold a stop nobody can see. */
async function placementOf(
  deps: ExitPlanDeps,
  input: Pick<TrailPlanInput, 'instrument' | 'options'>
): Promise<StopPlacement> {
  const { instrument, options } = input

  if (deps.restingStops === undefined) {
    return 'by-hand'
  }

  try {
    const stops = await deps.restingStops({ now: options.now, signal: options.signal })
    const resting = stops.get(buildInstrumentKey(instrument))

    if (resting === undefined) {
      return 'by-hand'
    }

    return PLACEMENT_BY_COVER[resting]
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.resting_stops_unread', {
      ticker: instrument.ticker,
      err: formatErrForLog(err),
    })

    return 'unread'
  }
}

/** A plan whose position is long, which on a spot book is every one the trail applies to. The same question `findLatestExitPlan` selects on, so a row the arming pass reads as the
 *  holding's exit plan is never one the trail refuses: almost every held name carries a debated hold
 *  framed as a buy, and testing the action instead excluded all of them. */
function isLongPlan(plan: StoredSuggestion): boolean {
  return framedDirectionOf(plan) === 'buy'
}
