import type { Locale } from '@/core/types/locale'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { Holding } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type {
  ExitPlanner,
  PlanRecordedEntryOptions,
  RecordedPlanResult,
} from '@/trading/features/suggestion/exit-plan/types'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradeLevels } from '@/trading/kernel/factor'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { InvestmentHorizon, ProfileStamp } from '@/trading/kernel/operator/profile'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { resolveDay } from '@/trading/features/market-data/resolve'
import {
  keepTakeProfit,
  ratchetStop,
  toStandingPlan,
} from '@/trading/features/suggestion/exit-plan/ratchet'
import { toHeldPosition } from '@/trading/features/suggestion/pipeline/concentration'
import { instrumentEvents } from '@/trading/features/suggestion/pipeline/draft-input'
import {
  adjustForExRight,
  type ExRightGap,
  toSeriesBasisPrice,
} from '@/trading/features/suggestion/pipeline/ex-right'
import { buildSuggestionId, isRecordedPlan, planStopOf } from '@/trading/features/suggestion/types'
import { strategyId } from '@/trading/kernel/instrument'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'
import { horizonFor, toProfileStamp } from '@/trading/kernel/operator/profile'
import { orderSessionOf, resolveSettledDay } from '@/trading/markets/calendar'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'
import { LEVEL_BARS_SESSIONS } from '@/trading/markets/levels'
import { spreadPct } from '@/trading/markets/overview'
import { exitPriceOf } from '@/trading/markets/stored-quote'

interface ExitPlannerDeps {
  readonly markets: MarketRegistry
  readonly store: SuggestionStore
  /** The tradeable holdings, each measured from the buy that opened it as it stands. */
  readonly holdingsAt: (options: PortfolioAtOptions) => Promise<readonly Holding[]>
  readonly profile: Pick<ProfileService, 'get' | 'isSaved'>
  readonly defaultLocale: Locale
}

export function createExitPlanner(deps: ExitPlannerDeps): ExitPlanner {
  return { plan: (options) => planRecordedEntry(deps, options) }
}

/** The levels a `/suggest` would price, without the debate, written as a hold the name is watched
 *  against. A call stands until its strategy version is superseded; a recorded plan also until the
 *  price it is watched on passes one of its levels. Either is then replaced from where the name
 *  trades now, the stop never lower. Only a plan written since the holding opened can stand: an
 *  older one was a closed holding's. */
async function planRecordedEntry(
  deps: ExitPlannerDeps,
  options: PlanRecordedEntryOptions
): Promise<RecordedPlanResult> {
  const { instrument, now, signal } = options
  const market = deps.markets.find(instrument.market)
  const bars = market?.capabilities.bars

  if (market === null || bars === undefined) {
    return { kind: 'unplanned', reason: 'market-unknown' }
  }

  const settled = resolveSettledDay(market.manifest.calendar, now)
  const held = toHeldPosition(await deps.holdingsAt({ now, signal }), instrument)
  const [standing, series, board] = await Promise.all([
    deps.store.findLatestExitPlan({
      market: instrument.market,
      ticker: instrument.ticker,
      ...heldSinceOf(held),
      signal,
    }),
    bars.run({ instrument, asOf: settled, now, sessions: LEVEL_BARS_SESSIONS, signal }),
    readBoard(market, { ...options, settled }),
  ])
  const exRight = await readExRight(market, { ...options, day: resolveDay(market, now), series })
  const kept = await standingIfUnspent(market, standing, { ...options, settled, board, exRight })

  if (kept !== null) {
    return { kind: 'standing', plan: kept }
  }

  if (exRight.bars?.kind !== 'available') {
    return { kind: 'unplanned', reason: 'no-levels' }
  }

  const plan = await buildRecordedPlan(deps, market, {
    ...options,
    ...(exRight.entry === undefined ? {} : { entry: exRight.entry }),
    ...(held === undefined ? {} : { held }),
    ...(board === undefined ? {} : { board }),
    ...(exRight.gap === undefined ? {} : { gap: exRight.gap }),
    settled,
    candles: exRight.bars.value,
    provenance: exRight.bars.provenance,
    caveats: [...exRight.bars.caveats, ...exRight.caveats],
  })

  if (plan === null) {
    return { kind: 'unplanned', reason: 'no-levels' }
  }

  const created = await deps.store.create(plan, signal)

  return created ? { kind: 'planned', plan } : { kind: 'unplanned', reason: 'row-exists' }
}

/** The day the holding opened: only a plan written since can stand, and the floor a new stop may not
 *  sit under comes from its plans. */
function heldSinceOf(held: HeldPosition | undefined): { readonly heldSince?: TradingDay } {
  return held?.openedOn === undefined ? {} : { heldSince: held.openedOn }
}

type ExRightView = ReturnType<typeof adjustForExRight> & {
  /** The fill's price on the series' basis, where there is a fill to move. */
  readonly entry?: number
}

/** The settled series moved onto the basis of an ex-date the store has not caught up to, the way a
 *  suggestion's levels read it, and the fill's price moved onto the same basis (events are read from
 *  the fill's day when it precedes the series' end: a refresh may have restated the bars across an
 *  ex-date the fill's price still stands before). A failed events read is no gap: the next run's
 *  adjustment finds it. */
async function readExRight(
  market: Market,
  input: PlanRecordedEntryOptions & {
    readonly day: TradingDay
    readonly series: SourceResult<readonly Candle[]>
  }
): Promise<ExRightView> {
  const { instrument, day, series, entry, entryDay } = input
  const newest = series.kind === 'available' ? series.value.at(-1) : undefined
  const events =
    newest === undefined
      ? undefined
      : await market.capabilities.events?.run({
          instrument,
          asOf: day,
          now: input.now,
          fromDay: entryDay !== undefined && entryDay < newest.at ? entryDay : newest.at,
          signal: input.signal,
        })
  const rows = instrumentEvents(events, instrument)
  const adjusted = adjustForExRight(
    { bars: series, quote: undefined },
    { events: rows, asOf: day, calendar: market.manifest.calendar }
  )

  if (newest === undefined || entry === undefined || entryDay === undefined) {
    return adjusted
  }

  const basis = { events: rows, newestDay: newest.at, gap: adjusted.gap }

  return { ...adjusted, entry: toSeriesBasisPrice({ price: entry, day: entryDay }, basis) }
}

/** The plan already on the book, when it still answers: priced by this strategy version and, for a
 *  recorded plan, not yet passed by the price it is watched on. */
async function standingIfUnspent(
  market: Market,
  standing: StoredSuggestion | null,
  input: PlanRecordedEntryOptions & {
    readonly settled: TradingDay
    readonly board: Quote | undefined
    readonly exRight: ReturnType<typeof adjustForExRight>
  }
): Promise<StoredSuggestion | null> {
  if (standing === null || standing.strategyVersion !== market.manifest.strategyVersion) {
    return null
  }

  const on = await toStandingPlan(standing, {
    market,
    instrument: input.instrument,
    gap: input.exRight.gap,
    asOf: input.settled,
    now: input.now,
    signal: input.signal,
  })

  // A plan the gap cannot price is not carried: its levels describe a trade that no longer exists.
  return on.plan === null ||
    isSpent(on, watchedPrice(market, { bars: input.exRight.bars, board: input.board }))
    ? null
    : standing
}

/** The price a stored plan's levels are watched on: the board's buying price where the market's
 *  bars are another instrument's tape, the settled close otherwise. */
function watchedPrice(
  market: Market,
  reads: {
    readonly bars: SourceResult<readonly Candle[]> | undefined
    readonly board: Quote | undefined
  }
): number | undefined {
  if (market.manifest.referenceBarsOnly === true) {
    return reads.board === undefined ? undefined : exitPriceOf(reads.board)
  }

  return reads.bars?.kind === 'available' ? reads.bars.value.at(-1)?.close : undefined
}

/** Only a recorded plan is judged here: a call resolves on the outcome tick and drops out on its
 *  own. A price at or past the target, or at or under the stop as the tick has trailed it, has
 *  spent the plan; an unknown price leaves it standing rather than replacing a plan on no evidence.
 *  The price and the levels are compared on the series' basis. */
function isSpent(
  standing: Awaited<ReturnType<typeof toStandingPlan>>,
  price: number | undefined
): boolean {
  const { plan, toBasis } = standing
  const stop = plan === null ? undefined : planStopOf(plan)

  if (
    plan === null ||
    !isRecordedPlan(plan) ||
    price === undefined ||
    stop === undefined ||
    plan.target === undefined
  ) {
    return false
  }

  return price >= toBasis(plan.target) || price <= toBasis(stop)
}

interface RecordedPlanInput extends PlanRecordedEntryOptions {
  /** Absent only when the book no longer holds the name by the time the plan is written. */
  readonly held?: HeldPosition
  /** The dealer board the levels sit on, where the market quotes one. */
  readonly board?: Quote
  readonly settled: TradingDay
  /** The ex-dates the candles were moved across; absent where none passed since the series ended. */
  readonly gap?: ExRightGap
  readonly candles: readonly Candle[]
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** The live dealer board, which is what puts a plan's stop and target on the buy side the way a
 *  planned buy's are. Read for a recorded fill, and on the tick for a market with no series of its
 *  own, whose close is not its price. Absent for a last-trade market and a board that cannot be read. */
async function readBoard(
  market: Market,
  input: PlanRecordedEntryOptions & { readonly settled: TradingDay }
): Promise<Quote | undefined> {
  if (input.entry === undefined && market.manifest.referenceBarsOnly !== true) {
    return undefined
  }

  const quote = await market.capabilities.quote?.run({
    instrument: input.instrument,
    asOf: input.settled,
    now: input.now,
    signal: input.signal,
  })

  return quote?.kind === 'available' && quote.value.board !== undefined ? quote.value : undefined
}

/** The entry moved onto the buy side by the board's own spread. */
function exitPriceFor(entry: number | undefined, board: Quote | undefined): number | undefined {
  const spread =
    board?.board === undefined ? undefined : spreadPct(board.board.buyPrice, board.board.sellPrice)

  return entry === undefined || spread === undefined ? undefined : entry * (1 - spread)
}

async function buildRecordedPlan(
  deps: ExitPlannerDeps,
  market: Market,
  input: RecordedPlanInput
): Promise<StoredSuggestion | null> {
  const { instrument, signal, settled, board } = input
  const { manifest } = market
  const [profile, saved, prior] = await Promise.all([
    deps.profile.get({ signal }),
    deps.profile.isSaved({ signal }),
    deps.store.findLatestExitPlan({
      market: instrument.market,
      ticker: instrument.ticker,
      includeResolved: true,
      ...heldSinceOf(input.held),
      signal,
    }),
  ])
  const horizon = horizonFor(profile, manifest.segment)
  // The fill's price is already on the candles' basis. On the tick a board market has no fill, so
  // it enters where the shop sells now.
  const entry = input.entry ?? board?.price
  const exitPrice = exitPriceFor(entry, board)
  const result = await market.levels({
    instrument,
    asOf: settled,
    orderSession: orderSessionOf(manifest.calendar, input.now),
    signal,
    direction: 'buy',
    forHolding: true,
    horizon,
    candles: input.candles,
    ...(entry === undefined ? {} : { entry }),
    ...(exitPrice === undefined ? {} : { exitPrice }),
  })

  if (result.kind !== 'available') {
    return null
  }

  const carried = await ratchetOnBasis(market, input, { prior, levels: result.levels })

  return toPlanRow(market, {
    ...input,
    horizon,
    profile: toProfileStamp({ profile, saved }),
    takeProfitTranchePct: profile.takeProfitTranchePct,
    locale: deps.defaultLocale,
    levels: carried.levels,
    ...(carried.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: carried.standingTakeProfit }),
    caveats: [...input.caveats, ...result.caveats, ...carried.caveats],
  })
}

/** The fresh stop raised to the prior plan's, and its take-profit kept, both moved onto the same
 *  basis as the fresh levels. */
async function ratchetOnBasis(
  market: Market,
  input: RecordedPlanInput,
  from: { readonly prior: StoredSuggestion | null; readonly levels: TradeLevels }
): Promise<{
  readonly levels: TradeLevels
  readonly standingTakeProfit?: number
  readonly caveats: readonly Caveat[]
}> {
  const { plan, toBasis } = await toStandingPlan(from.prior, {
    market,
    instrument: input.instrument,
    gap: input.gap,
    asOf: input.settled,
    now: input.now,
    signal: input.signal,
  })
  const priorStop = plan === null ? undefined : planStopOf(plan)
  const ratcheted = ratchetStop(
    from.levels,
    priorStop === undefined ? undefined : toBasis(priorStop)
  )
  const kept = keepTakeProfit(ratcheted.levels, plan, {
    position: input.held,
    trails: market.trail !== undefined,
    toBasis,
  })

  return {
    levels: ratcheted.levels,
    caveats: [...ratcheted.caveats, ...kept.caveats],
    ...(kept.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: kept.standingTakeProfit }),
  }
}

interface PlanRowInput extends RecordedPlanInput {
  readonly horizon: InvestmentHorizon
  readonly profile: ProfileStamp
  readonly takeProfitTranchePct: number
  readonly locale: Locale
  readonly levels: TradeLevels
  readonly standingTakeProfit?: number
}

/** A levels-only row: no factors, no debate, no conviction the evidence earned. The composite is
 *  the unscored one rather than a neutral score, so nothing reads it as a read that happened. */
function toPlanRow(market: Market, input: PlanRowInput): StoredSuggestion {
  const { manifest } = market
  const { now, instrument, levels } = input
  const newest = input.candles[input.candles.length - 1]

  return {
    id: buildSuggestionId(now),
    createdAt: now,
    instrument,
    at: resolveDay(market, now),
    ...(newest === undefined ? {} : { evidenceThrough: newest.at }),
    authoredLocale: input.locale,
    profile: input.profile,
    horizon: input.horizon,
    strategyId: strategyId(manifest.id),
    strategyVersion: manifest.strategyVersion,
    // A recorded plan is the operator's own.
    focusKey: DEFAULT_FOCUS_KEY,
    calculationVersions: manifest.calculationVersions,
    conviction: 'low',
    citations: [],
    provenance: input.provenance,
    caveats: input.caveats,
    ...(input.held === undefined ? {} : { held: input.held }),
    ...(input.board?.board === undefined
      ? {}
      : {
          quote: {
            price: input.board.price,
            observedAt: input.board.observedAt,
            currency: manifest.currency,
            board: input.board.board,
          },
        }),
    ...(levels.reviewOnly === undefined ? {} : { reviewOnly: levels.reviewOnly }),
    factorScores: [],
    composite: UNSCORED_COMPOSITE,
    action: 'hold',
    direction: 'buy',
    holdReasonCodes: ['recorded-entry'],
    // Only the levels a `HoldSuggestion` declares: `atr` and `riskDistance` are sizing inputs, and
    // this row sizes nothing.
    entry: levels.entry,
    stop: levels.stop,
    target: levels.target,
    takeProfit: levels.takeProfit,
    riskReward: levels.riskReward,
    takeProfitTranchePct: input.takeProfitTranchePct,
    ...(input.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: input.standingTakeProfit }),
  }
}
