import type { SuggestionRunOptions } from '@/trading/features/suggestion/pipeline/types'
import type { StoredSuggestion, SuggestionIdentity } from '@/trading/features/suggestion/types'
import type { Caveat, HoldReasonCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { BookChange } from '@/trading/kernel/operator/book'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketResolution } from '@/trading/markets/types'
import { calendarSessionsBetween, resolveDay } from '@/trading/features/market-data/resolve'
import {
  entrySessionOf,
  holdingWindowOf,
} from '@/trading/features/suggestion/pipeline/outcome-holding'
import {
  outcomeLookbackSessions,
  outcomeWindowSessions,
} from '@/trading/features/suggestion/pipeline/outcome-window'
import {
  isLapsedLimit,
  isStandingAnswer,
  lookbackOf,
} from '@/trading/features/suggestion/pipeline/standing-answer'
import { isEvidenceReduceReason } from '@/trading/kernel/caveat'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { voidPrice } from '@/trading/markets/levels'
import { exitPriceOf } from '@/trading/markets/stored-quote'

/** The holds sized against NAV and cash, which a deposit or another name's trade can overturn. */
const WEIGHT_HOLD_REASONS: ReadonlySet<HoldReasonCode> = new Set<HoldReasonCode>([
  'zero-nav',
  'cap-exhausted',
  'sector-cap-exhausted',
  'etf-cap-exhausted',
  'segment-cap-exhausted',
  'cash-exhausted',
  'risk-budget-too-small',
  'open-risk-exhausted',
  'size-below-board-lot',
  'increase-unfunded',
  'fully-invested',
  'no-rebalance-needed',
])

/** On a market with no session boundary a fresh entry is the live quote, which moves far between
 *  runs, so the newest call on a name answers again while it is an open buy inside its outcome
 *  window that can still be taken as written: one idea keeps one set of levels. */
export async function findStandingBuy(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  identity: SuggestionIdentity
): Promise<StoredSuggestion | undefined> {
  const { deps, request } = options
  const { market } = resolution
  const { manifest } = market

  if (!manifest.calendar.continuous) {
    return undefined
  }

  const lookback = outcomeLookbackSessions(manifest.defaultCalendar)
  const latest = await deps.store.findRecentCompleted({
    ...lookbackOf(identity, manifest.calendar.addTradingDays(identity.asOf, -lookback)),
    signal: request.signal,
  })

  if (
    latest === null ||
    latest.action !== 'buy' ||
    latest.outcome !== undefined ||
    isLapsedLimit(latest, identity.asOf) ||
    !isStandingAnswer(latest, options) ||
    calendarSessionsBetween(market, latest.at, identity.asOf) >
      outcomeWindowSessions(manifest.defaultCalendar, latest.horizon)
  ) {
    return undefined
  }

  const [live, change] = await Promise.all([
    isOpenBuyLive(options, resolution, latest),
    bookChangeOf(options, resolution, latest),
  ])

  return live && change !== 'instrument' ? withBookChange(latest, change) : undefined
}

/** The live quote between its stop and its void price, and no settled session since the call
 *  through the stop. Anything unread answers no, which runs a fresh call. */
async function isOpenBuyLive(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: Extract<StoredSuggestion, { readonly action: 'buy' | 'reduce' }>
): Promise<boolean> {
  const { minimumRiskReward } = resolution.market.manifest

  if (minimumRiskReward === undefined) {
    return false
  }

  const [quote, bars] = await Promise.all([
    readQuote(options, resolution),
    readBarsSince(options, resolution, suggestion.at),
  ])

  if (quote?.kind !== 'available' || bars?.kind !== 'available') {
    return false
  }

  // The window the scorer would hold the call to, so a bar's lows before the call was made never
  // kill it.
  const { calendar, defaultCalendar } = resolution.market.manifest
  const window = holdingWindowOf({
    suggestion,
    bars: bars.value,
    maximumHoldingSessions: outcomeWindowSessions(defaultCalendar, suggestion.horizon),
    ...entrySessionOf(calendar, suggestion),
  })

  return (
    !isSetupVoid(suggestion, quote.value, minimumRiskReward) &&
    window.bars.every((candle) => candle.low > suggestion.stop)
  )
}

/** The stored suggestion as it stands now: against the price, and against a book the operator may
 *  have changed since. Both are marked rather than re-run - a debate to say so is spend the
 *  operator did not ask for; `force` is there for the fresh call. */
export async function resolveStanding(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<StoredSuggestion> {
  const [standing, change] = await Promise.all([
    withLevelCaveats(options, resolution, suggestion),
    bookChangeOf(options, resolution, suggestion),
  ])

  return withBookChange(standing, change)
}

/** A trade on the name itself can invert its direction. Any other row moves NAV and cash, which
 *  only matters to a row decided on them - a buy sized from cash, a sale under the plan's own
 *  reasons, a hold sized against NAV and cash or a plan sale under one lot - so only those say so. */
function withBookChange(standing: StoredSuggestion, change: BookChange): StoredSuggestion {
  if (!isBookCall(standing)) {
    return standing
  }

  if (change === 'instrument' && standing.action !== 'hold') {
    return withCaveat(standing, { code: 'suggestion.position-changed' })
  }

  return change !== 'none' && isReadOffTheBook(standing)
    ? withCaveat(standing, { code: 'suggestion.book-changed' })
    : standing
}

function isReadOffTheBook(suggestion: StoredSuggestion): boolean {
  if (suggestion.action === 'buy') {
    return true
  }

  if (suggestion.action === 'reduce') {
    return (
      suggestion.reduceReasonCode === undefined ||
      !isEvidenceReduceReason(suggestion.reduceReasonCode)
    )
  }

  return (
    suggestion.action === 'hold' && (isWeightHold(suggestion) || isPlanSaleUnderALot(suggestion))
  )
}

function isWeightHold(suggestion: Extract<StoredSuggestion, { readonly action: 'hold' }>): boolean {
  return suggestion.holdReasonCodes.some((code) => WEIGHT_HOLD_REASONS.has(code))
}

/** A plan sale that rounded under one lot is filed as a hold, but its size was a share of NAV. */
function isPlanSaleUnderALot(
  suggestion: Extract<StoredSuggestion, { readonly action: 'hold' }>
): boolean {
  return (
    suggestion.holdReasonCodes.includes('sale-below-board-lot') &&
    suggestion.reduceReasonCode !== undefined &&
    !isEvidenceReduceReason(suggestion.reduceReasonCode)
  )
}

function bookChangeOf(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<BookChange> {
  return options.deps.portfolio.bookChangeSince(
    resolution.instrument,
    suggestion.createdAt,
    options.request.signal
  )
}

async function withLevelCaveats(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<StoredSuggestion> {
  const minimumRiskReward = resolution.market.manifest.minimumRiskReward

  if (minimumRiskReward === undefined || suggestion.stop === undefined) {
    return suggestion
  }

  const quote = await readQuote(options, resolution)

  if (quote?.kind !== 'available') {
    return withCaveat(suggestion, { code: 'suggestion.standing-unverified' })
  }

  return isSetupVoid(suggestion, quote.value, minimumRiskReward)
    ? withCaveat(suggestion, { code: 'suggestion.levels-void' })
    : suggestion
}

function readQuote(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
): Promise<SourceResult<Quote>> | undefined {
  const { request } = options

  return resolution.market.capabilities.quote?.run({
    instrument: resolution.instrument,
    asOf: resolveDay(resolution.market, request.now),
    now: request.now,
    signal: request.signal,
  })
}

export function readBarsSince(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  since: TradingDay
): Promise<SourceResult<readonly Candle[]>> | undefined {
  const { request } = options
  const { market } = resolution
  const asOf = resolveDay(market, request.now)

  return market.capabilities.bars?.run({
    instrument: resolution.instrument,
    asOf,
    now: request.now,
    sessions: calendarSessionsBetween(market, since, asOf),
    signal: request.signal,
  })
}

/** Whether the stored levels still describe a trade worth taking now. The stop sits on the far side
 *  of the entry, so which way the pair was framed is read off it - a hold carries levels without
 *  carrying the direction they were built for. A buy is read at the price a fresh order pays and a
 *  sale at what the holder is paid, which on a dealer board are its two sides. Price through the
 *  stop leaves no risk to measure; past the void price what is left to win no longer pays the
 *  floor. */
function isSetupVoid(
  suggestion: StoredSuggestion,
  quote: Quote,
  minimumRiskReward: number
): boolean {
  const { entry, stop, target } = suggestion

  if (entry === undefined || stop === undefined || target === undefined) {
    return false
  }

  const isBuy = stop < entry
  const price = isBuy ? quote.price : exitPriceOf(quote)
  const risk = isBuy ? price - stop : stop - price
  // A row stamped before the tranche exits whole at its target.
  const takeProfit = suggestion.takeProfit ?? target
  const bound = voidPrice({ stop, target, takeProfit }, minimumRiskReward)

  // `!(risk > 0)` rather than `risk <= 0`: a malformed stored level reads as void instead of
  // passing on a comparison nothing can be true of.
  return !(risk > 0) || (isBuy ? price > bound : price < bound)
}

function withCaveat(suggestion: StoredSuggestion, caveat: Caveat): StoredSuggestion {
  return { ...suggestion, caveats: [...suggestion.caveats, caveat] }
}
