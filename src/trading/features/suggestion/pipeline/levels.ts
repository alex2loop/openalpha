import type {
  SuggestionPortfolioContext,
  SuggestionRunOptions,
} from '@/trading/features/suggestion/pipeline/types'
import type {
  PullbackStat,
  StoredSuggestion,
  SuggestionQuote,
} from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { LevelResult, MarketLevelRequest } from '@/trading/kernel/factor'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketManifest, MarketResolution, TradingCalendar } from '@/trading/markets/types'
import { ratchetHeldStop } from '@/trading/features/suggestion/exit-plan/ratchet'
import { outcomeWindowSessions } from '@/trading/features/suggestion/pipeline/outcome-window'
import { isBookFocus } from '@/trading/kernel/operator/focus'
import { isLiveObservation, orderSessionOf } from '@/trading/markets/calendar'
import { LEVEL_BARS_SESSIONS } from '@/trading/markets/levels'
import { isGappedPastClose } from '@/trading/markets/statistics'
import { exitPriceOf } from '@/trading/markets/stored-quote'
import { median } from '@/trading/markets/timeseries'
import { changeAgainstClose, PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

/** A month of sessions: long enough that one quiet week does not read as illiquidity, short enough
 *  to still describe how the name trades today. */
const SIZING_TURNOVER_SESSIONS = 20

/** One trading week: long enough for an ordinary dip to show up, short enough that an operator is
 *  still waiting on this idea rather than on a newer one. */
const PULLBACK_WINDOW_SESSIONS = 5

export interface PricedLevels {
  readonly result: LevelResult
  readonly quote?: SuggestionQuote
  /** The newest settled session the bars reached; absent when no series did. */
  readonly evidenceThrough?: TradingDay
  /** Median session turnover in the market's own currency; absent when no bar carried a usable one. */
  readonly medianTurnover?: number
  /** Absent when the series is shorter than one forward window. */
  readonly pullback?: PullbackStat
  /** The standing plan's stop on a held name, where this read sets a higher one. */
  readonly raisedStopFrom?: number
  /** On a held name framed as a sale or priced no levels, the exits its standing plan names. */
  readonly standingExit?: StoredSuggestion['standingExit']
  /** On a held name, the take-profit its standing plan set and this read keeps. */
  readonly standingTakeProfit?: number
}

/** The entry is the live quote when the market publishes one — a market whose entry is quoted in a
 *  different unit from its volatility series depends on it — and the last close otherwise. The
 *  quote travels back beside the levels so the suggestion can state the price it was built at. */
export async function buildLevelsFor(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  at: {
    readonly asOf: TradingDay
    readonly direction: 'buy' | 'reduce'
    readonly horizon: InvestmentHorizon
    /** The book this draft is judged against, for the stop a held name is already planned on. */
    readonly context: SuggestionPortfolioContext
  }
): Promise<PricedLevels> {
  const market = resolution.market
  const [bars, quote] = await readBarsAndQuote(options, resolution, at.asOf)
  const previousClose = priorClose(bars, quote, market.manifest)
  const observed = toObservedQuote(quote, market.manifest.currency, previousClose)

  if (bars?.kind !== 'available') {
    return unpricedLevels(options, resolution, { at, caveats: bars?.caveats ?? [], observed })
  }

  const marketLevels = await marketLevelsOf(options, resolution, { at, candles: bars.value, quote })
  const { result: ratcheted, ...heldExits } = await heldExitsOf(options, resolution, {
    at,
    result: marketLevels,
  })
  const sourceCaveats = [...bars.caveats, ...(quote?.caveats ?? [])]
  const newest = bars.value[bars.value.length - 1]
  const chase = await chasingGapCaveats(options, resolution, { at, quote, previousClose })
  const caveated =
    ratcheted.kind === 'available'
      ? { ...ratcheted, caveats: [...sourceCaveats, ...ratcheted.caveats, ...chase] }
      : { ...ratcheted, caveats: [...sourceCaveats, ...(ratcheted.caveats ?? [])] }

  // A reference series is another instrument's tape: neither its turnover nor its dips are this
  // market's, so both read as unmeasured.
  const ownBars = market.manifest.referenceBarsOnly === true ? [] : bars.value
  const medianTurnover = resolveMedianTurnover(ownBars)
  const pullback = resolvePullback(
    ownBars,
    outcomeWindowSessions(market.manifest.defaultCalendar, at.horizon)
  )

  return {
    result: caveated,
    ...(newest === undefined ? {} : { evidenceThrough: newest.at }),
    ...(observed === undefined ? {} : { quote: observed }),
    ...(medianTurnover === undefined ? {} : { medianTurnover }),
    ...(pullback === undefined ? {} : { pullback }),
    ...heldExits,
  }
}

/** Without a settled series there are no levels, but a held name still carries its plan's exits. */
async function unpricedLevels(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  input: {
    readonly at: Parameters<typeof ratchetHeldStop>[2]['at']
    readonly caveats: readonly Caveat[]
    readonly observed: SuggestionQuote | undefined
  }
): Promise<PricedLevels> {
  const result: LevelResult = {
    kind: 'unavailable',
    reasonCode: 'insufficient-data',
    caveats: input.caveats,
  }

  return {
    ...(await heldExitsOf(options, resolution, { at: input.at, result })),
    ...(input.observed === undefined ? {} : { quote: input.observed }),
  }
}

/** A focus call keeps the levels its own evidence produced: the held stop is the book's to carry,
 *  and a second opinion must neither raise it nor read it. */
function heldExitsOf(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  input: Parameters<typeof ratchetHeldStop>[2]
): ReturnType<typeof ratchetHeldStop> {
  return isBookFocus(options.request.focus)
    ? ratchetHeldStop(options, resolution, input)
    : Promise.resolve({ result: input.result })
}

interface MarketLevelsInput {
  readonly at: {
    readonly asOf: TradingDay
    readonly direction: 'buy' | 'reduce'
    readonly horizon: InvestmentHorizon
  }
  readonly candles: readonly Candle[]
  readonly quote: SourceResult<Quote> | undefined
}

/** The market's own levels over the settled bars, entered at the price an order placed now trades. */
function marketLevelsOf(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  input: MarketLevelsInput
): Promise<LevelResult> {
  const { request } = options
  const { at, candles, quote } = input
  const { calendar } = resolution.market.manifest

  return resolution.market.levels({
    instrument: resolution.instrument,
    asOf: at.asOf,
    signal: request.signal,
    direction: at.direction,
    horizon: at.horizon,
    candles,
    orderSession: orderSessionOf(calendar, request.now),
    ...tradedPricesOf(quote, at.direction, calendar),
  })
}

/** A dealer board fills a buy at its sell price and a sale at its buy price, and a buy's levels are
 *  watched on the buy price it will be sold at. A last trade is the price either way. */
function tradedPricesOf(
  quote: SourceResult<Quote> | undefined,
  direction: 'buy' | 'reduce',
  calendar: TradingCalendar
): Pick<MarketLevelRequest, 'entry' | 'exitPrice' | 'entrySession'> {
  if (quote?.kind !== 'available') {
    return {}
  }

  const exitPrice = exitPriceOf(quote.value)
  const entrySession = calendar.dayAt(quote.value.observedAt)

  return direction === 'reduce'
    ? { entry: exitPrice, entrySession }
    : { entry: quote.value.price, exitPrice, entrySession }
}

interface ChaseInput {
  readonly at: { readonly asOf: TradingDay; readonly direction: 'buy' | 'reduce' }
  readonly quote: SourceResult<Quote> | undefined
  readonly previousClose: number | undefined
}

/** A buy priced mid-rally, on the same line the screen demotes a rank at. Live and upward only:
 *  a close is what the levels were designed on, and buying into a fall is not a chase. */
async function chasingGapCaveats(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  input: ChaseInput
): Promise<readonly Caveat[]> {
  const { quote, previousClose } = input
  const { request } = options
  const market = resolution.market

  if (
    input.at.direction !== 'buy' ||
    quote?.kind !== 'available' ||
    previousClose === undefined ||
    !(quote.value.price > previousClose) ||
    !isLiveObservation(market.manifest.calendar, quote.value.observedAt, request.now)
  ) {
    return []
  }

  const statistics = await market.capabilities.statistics?.run({
    instrument: resolution.instrument,
    asOf: input.at.asOf,
    now: request.now,
    signal: request.signal,
  })
  const volatilityDaily =
    statistics?.kind === 'available' ? statistics.value.volatilityDaily : undefined

  if (
    volatilityDaily === undefined ||
    !isGappedPastClose(quote.value.price, previousClose, volatilityDaily)
  ) {
    return []
  }

  const gap = quote.value.price / previousClose - 1
  const day = market.manifest.calendar.dayAt(quote.value.observedAt)

  return [{ code: 'suggestion.chasing-gap', detail: { gap, day } }]
}

/** Median, not mean: one block trade should not make a thin name look tradeable. Turnover is taken
 *  as reported and reconstructed from close × volume only where the source omits it. A session that
 *  traded nothing counts as zero rather than dropping out, or a name that printed once in the window
 *  sizes like one that trades every day. */
function resolveMedianTurnover(candles: readonly Candle[]): number | undefined {
  return median(
    candles
      .slice(-SIZING_TURNOVER_SESSIONS)
      .map((candle) => candle.turnover ?? candle.close * candle.volume)
      .filter((value) => value >= 0)
  )
}

/** Waiting for a better price, scored against buying at the reference close, every reading priced
 *  at the one discount the reader is told to wait for. Pricing the wait at each window's own
 *  cheapest tick instead asks what a fill nobody can place would have paid: measured over 639 VN
 *  names on 2026-09-22 it read +3,55% against the +0,94% a resting order earned, and called waiting
 *  the better side on 635 of them against 494. */
function resolvePullback(
  candles: readonly Candle[],
  holdSessions: number
): PullbackStat | undefined {
  const windows = pullbackWindows(candles, holdSessions)
  const medianBestPct = median(windows.map((row) => row.depthPct))

  if (medianBestPct === undefined) {
    return undefined
  }

  // Never a premium: a name whose window typically opens no gap has no discount to rest under, and
  // a limit at the reference itself is what waiting means there.
  const discount = 1 + Math.min(medianBestPct, 0) / PERCENT_PER_UNIT

  return {
    waitSessions: PULLBACK_WINDOW_SESSIONS,
    holdSessions,
    medianBestPct,
    waitEdgePct:
      mean(windows.map((row) => waitReturnPct(row, row.referenceClose * discount))) -
      mean(windows.map((row) => row.buyNowPct)),
  }
}

/** What an order resting at `limit` returned over the holding window. A wait that never filled
 *  holds nothing and so earns nothing: charging the misses is the term every "buy the dip" argument
 *  leaves out, and it is why no fill rate is published beside this. One at the limit is ~50% for
 *  every name, because the limit is that name's own median depth. */
function waitReturnPct(row: PullbackWindow, limit: number): number {
  return limit <= 0 || row.bestPrice >= limit
    ? 0
    : ((row.exitClose - limit) / limit) * PERCENT_PER_UNIT
}

interface PullbackWindow {
  readonly depthPct: number
  readonly buyNowPct: number
  /** The close the window is measured from, and the price a limit is placed under. */
  readonly referenceClose: number
  /** The cheapest the window traded, which is what a limit has to reach to fill. */
  readonly bestPrice: number
  readonly exitClose: number
}

/** One row per session that has both a wait window and a full holding window after it, so the
 *  discount and the edge describe the same population rather than two overlapping ones. Both paths
 *  exit on the same session: the comparison is what the calendar paid, not what a longer hold
 *  would have. */
function pullbackWindows(
  candles: readonly Candle[],
  holdSessions: number
): readonly PullbackWindow[] {
  const rows: PullbackWindow[] = []

  for (let index = 0; index + holdSessions < candles.length; index += 1) {
    const reference = candles[index]?.close
    const exit = candles[index + holdSessions]?.close
    const lows = candles
      .slice(index + 1, index + 1 + PULLBACK_WINDOW_SESSIONS)
      .map((candle) => candle.low)
      .filter((low) => Number.isFinite(low) && low > 0)
    const best = lows.length === 0 ? undefined : Math.min(...lows)

    if (reference === undefined || !(reference > 0) || exit === undefined || best === undefined) {
      continue
    }

    rows.push({
      depthPct: ((best - reference) / reference) * PERCENT_PER_UNIT,
      buyNowPct: ((exit - reference) / reference) * PERCENT_PER_UNIT,
      referenceClose: reference,
      bestPrice: best,
      exitClose: exit,
    })
  }

  return rows
}

/** Callers guard the empty case, so an empty window returns zero rather than NaN. */
function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** The two reads share nothing, so neither waits behind the other. */
function readBarsAndQuote(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  asOf: TradingDay
): Promise<
  readonly [SourceResult<readonly Candle[]> | undefined, SourceResult<Quote> | undefined]
> {
  const { request } = options
  const { capabilities } = resolution.market

  return Promise.all([
    capabilities.bars?.run({
      instrument: resolution.instrument,
      asOf,
      now: request.now,
      sessions: LEVEL_BARS_SESSIONS,
      signal: request.signal,
    }),
    // Signals stay settled; the price the levels anchor to is the one the operator would trade at.
    // Each market's quote capability owns whether its session can answer and falls back to the
    // last close when it cannot.
    capabilities.quote?.run({
      instrument: resolution.instrument,
      asOf,
      now: request.now,
      signal: request.signal,
    }),
  ])
}

/** Measured against the close the quote's own session opened from, never the provider's own window:
 *  a continuous market publishes a rolling 24-hour move, so taken verbatim the same line reads as a
 *  session on one market and as yesterday-plus-a-bit on the next — BTC printed -1,00% for a session
 *  it spent up. The provider's figure stands only where there is no close to measure from. */
function toObservedQuote(
  quote: SourceResult<Quote> | undefined,
  currency: CurrencyCode,
  previousClose: number | undefined
): SuggestionQuote | undefined {
  if (quote?.kind !== 'available') {
    return undefined
  }

  const changePct = changeAgainstClose(quote.value.price, previousClose, quote.value.changePct)

  return {
    price: quote.value.price,
    observedAt: quote.value.observedAt,
    currency,
    ...(changePct === undefined ? {} : { changePct }),
    ...(quote.value.board === undefined ? {} : { board: quote.value.board }),
  }
}

/** The close the quote moved from: the session before the quote's own, which is the last stored bar
 *  while that session is still forming and the one before it once its bar has landed. Measuring
 *  against the quote's own close reports the session flat against itself. */
function priorClose(
  bars: SourceResult<readonly Candle[]> | undefined,
  quote: SourceResult<Quote> | undefined,
  manifest: MarketManifest
): number | undefined {
  // A reference series is another instrument in another unit: its close under this market's live
  // price would read as an overnight move the market never made.
  if (manifest.referenceBarsOnly === true) {
    return undefined
  }

  if (bars?.kind !== 'available' || quote?.kind !== 'available') {
    return undefined
  }

  const candles = bars.value
  const last = candles[candles.length - 1]
  const quoteDay = manifest.calendar.dayAt(quote.value.observedAt)

  return last?.at === quoteDay ? candles[candles.length - 2]?.close : last?.close
}
