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
import { keepTakeProfit, ratchetStop } from '@/trading/features/suggestion/exit-plan/ratchet'
import { toHeldPosition } from '@/trading/features/suggestion/pipeline/concentration'
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
  const heldSince = held?.openedOn === undefined ? {} : { heldSince: held.openedOn }
  const [standing, series, board] = await Promise.all([
    deps.store.findLatestExitPlan({
      market: instrument.market,
      ticker: instrument.ticker,
      ...heldSince,
      signal,
    }),
    bars.run({ instrument, asOf: settled, now, sessions: LEVEL_BARS_SESSIONS, signal }),
    readBoard(market, { ...options, settled }),
  ])

  if (
    standing !== null &&
    standing.strategyVersion === market.manifest.strategyVersion &&
    !isSpent(standing, watchedPrice(market, { series, board }))
  ) {
    return { kind: 'standing', plan: standing }
  }

  if (series.kind !== 'available') {
    return { kind: 'unplanned', reason: 'no-levels' }
  }

  const plan = await buildRecordedPlan(deps, market, {
    ...options,
    ...(held === undefined ? {} : { held }),
    ...heldSince,
    ...(board === undefined ? {} : { board }),
    settled,
    candles: series.value,
    provenance: series.provenance,
    caveats: series.caveats,
  })

  if (plan === null) {
    return { kind: 'unplanned', reason: 'no-levels' }
  }

  const created = await deps.store.create(plan, signal)

  return created ? { kind: 'planned', plan } : { kind: 'unplanned', reason: 'row-exists' }
}

/** The price a stored plan's levels are watched on: the board's buying price where the market's
 *  bars are another instrument's tape, the settled close otherwise. */
function watchedPrice(
  market: Market,
  reads: {
    readonly series: SourceResult<readonly Candle[]>
    readonly board: Quote | undefined
  }
): number | undefined {
  if (market.manifest.referenceBarsOnly === true) {
    return reads.board === undefined ? undefined : exitPriceOf(reads.board)
  }

  return reads.series.kind === 'available' ? reads.series.value.at(-1)?.close : undefined
}

/** Only a recorded plan is judged here: a call resolves on the outcome tick and drops out on its
 *  own. A price at or past the target, or at or under the stop as the tick has trailed it, has
 *  spent the plan; an unknown price leaves it standing rather than replacing a plan on no evidence. */
function isSpent(plan: StoredSuggestion, price: number | undefined): boolean {
  const stop = planStopOf(plan)

  if (
    !isRecordedPlan(plan) ||
    price === undefined ||
    stop === undefined ||
    plan.target === undefined
  ) {
    return false
  }

  return price >= plan.target || price <= stop
}

interface RecordedPlanInput extends PlanRecordedEntryOptions {
  /** Absent only when the book no longer holds the name by the time the plan is written. */
  readonly held?: HeldPosition
  /** The day that holding opened: the floor a new stop may not sit under comes from its plans. */
  readonly heldSince?: TradingDay
  /** The dealer board the levels sit on, where the market quotes one. */
  readonly board?: Quote
  readonly settled: TradingDay
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
      ...(input.heldSince === undefined ? {} : { heldSince: input.heldSince }),
      signal,
    }),
  ])
  const horizon = horizonFor(profile, manifest.segment)
  // On the tick a board market has no fill, so it enters where the shop sells now.
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

  const ratcheted = ratchetStop(result.levels, prior === null ? undefined : planStopOf(prior))
  const kept = keepTakeProfit(ratcheted.levels, prior, {
    position: input.held,
    trails: market.trail !== undefined,
  })

  return toPlanRow(market, {
    ...input,
    horizon,
    profile: toProfileStamp({ profile, saved }),
    takeProfitTranchePct: profile.takeProfitTranchePct,
    locale: deps.defaultLocale,
    levels: ratcheted.levels,
    ...(kept.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: kept.standingTakeProfit }),
    caveats: [...input.caveats, ...result.caveats, ...ratcheted.caveats, ...kept.caveats],
  })
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
