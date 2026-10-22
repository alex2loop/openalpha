import type { SuggestionRunOptions } from '@/trading/features/suggestion/pipeline/types'
import type {
  StoredSuggestion,
  Suggestion,
  SuggestionIdentity,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { BookChange } from '@/trading/kernel/operator/book'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketResolution } from '@/trading/markets/types'
import { StorageError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { calendarSessionsBetween, resolveDay } from '@/trading/features/market-data/resolve'
import { bookHoldOf } from '@/trading/features/suggestion/pipeline/direction'
import {
  outcomeLookbackSessions,
  outcomeWindowSessions,
} from '@/trading/features/suggestion/pipeline/outcome-window'
import {
  isLapsedLimit,
  isStandingAnswer,
  lookbackOf,
} from '@/trading/features/suggestion/pipeline/standing-answer'
import { buildSuggestionId, isInconclusive } from '@/trading/features/suggestion/types'
import { isEvidenceReduceReason } from '@/trading/kernel/caveat'
import { strategyId } from '@/trading/kernel/instrument'
import { voidPrice } from '@/trading/markets/levels'
import { exitPriceOf } from '@/trading/markets/stored-quote'

export async function reuseOrCooldown(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>
): Promise<SuggestionRunResult | undefined> {
  const { deps, request } = options

  if (request.force === true) {
    return undefined
  }

  const asOf = resolveDay(resolution.market, request.now)
  const identity = identityOf(resolution, asOf, request.focus.key)
  const existing = await findReusable(options, resolution, identity)
  // An undecided row is not an answer, so it neither satisfies the gate nor starts a cooldown:
  // serving it back would let one outage stand as today's decision for this name.
  const answered = existing !== null && isStandingAnswer(existing, options)
  const superseded = answered && (await hasNewerEvidence(options, resolution, existing))

  if (answered && !superseded) {
    const standing = await resolveStanding(options, resolution, existing)

    return { kind: 'completed', suggestion: standing, reused: true }
  }

  const standingBuy = await findStandingBuy(options, resolution, identity)

  if (standingBuy !== undefined) {
    return { kind: 'completed', suggestion: standingBuy, reused: true }
  }

  const sessions = deps.policy.cooldownSessions

  if (sessions <= 0 || superseded) {
    return undefined
  }

  const calendar = resolution.market.manifest.calendar
  // Inclusive lookback, so it stops one session short: a row exactly `sessions` old names today as
  // `eligibleAfter`, and must not also be refused today.
  const recent = await deps.store.findRecentCompleted({
    ...lookbackOf(identity, calendar.addTradingDays(asOf, -sessions + 1)),
    signal: request.signal,
  })

  if (recent === null || !isStandingAnswer(recent, options)) {
    return undefined
  }

  return {
    kind: 'cooldown',
    previous: await resolveStanding(options, resolution, recent),
    eligibleAfter: calendar.addTradingDays(recent.at, sessions),
  }
}

/** One insert. A conflict means another writer won the same economic identity, so the winner is
 *  re-read and returned as a reuse rather than retried. An insert that wrote nothing and left
 *  nothing to read back is a lost write, not a completed suggestion. */
export async function persistSuggestion(
  options: SuggestionRunOptions,
  suggestion: Suggestion
): Promise<SuggestionRunResult> {
  const { deps, request } = options
  const stored: StoredSuggestion = {
    ...suggestion,
    id: buildSuggestionId(request.now),
    createdAt: request.now,
  }

  if (isInconclusive(stored)) {
    return { kind: 'completed', suggestion: stored, reused: false }
  }

  const created = await deps.store.create(stored, request.signal)

  if (created) {
    return { kind: 'completed', suggestion: stored, reused: false }
  }

  const existing = await readHolder(options, stored)

  // The identity is held by a row this run outranks — never decided, a shallower debate, forced past,
  // or read off an older close — so this run takes it over; a lost race means another writer did.
  const outranked = request.force === true || !isStandingAnswer(existing, options)
  const fresher =
    isStandingAnswer(stored, options) && evidenceDayOf(stored) > evidenceDayOf(existing)

  if (outranked || fresher) {
    const replaced = await deps.store.replace({
      previousId: existing.id,
      suggestion: stored,
      signal: request.signal,
    })

    if (replaced) {
      return { kind: 'completed', suggestion: stored, reused: false }
    }

    // The row read above is gone: its id was deleted by the writer that won the takeover.
    return { kind: 'completed', suggestion: await readHolder(options, stored), reused: true }
  }

  return { kind: 'completed', suggestion: existing, reused: true }
}

async function readHolder(
  options: SuggestionRunOptions,
  stored: StoredSuggestion
): Promise<StoredSuggestion> {
  const holder = await options.deps.store.findCompleted(
    {
      strategyId: stored.strategyId,
      strategyVersion: stored.strategyVersion,
      focusKey: stored.focusKey,
      market: stored.instrument.market,
      ticker: stored.instrument.ticker,
      asOf: stored.at,
    },
    options.request.signal
  )

  if (holder === null) {
    throw new StorageError(`suggestion ${stored.id} was neither written nor readable back`)
  }

  return holder
}

/** Today's row, or - where the day boundary is only a charting convention - the last one still
 *  inside the reuse window. Crossing 00:00 UTC an hour after a run must not turn that run's own
 *  suggestion into a cooldown notice. */
async function findReusable(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  identity: SuggestionIdentity
): Promise<StoredSuggestion | null> {
  const { deps, request } = options
  const calendar = resolution.market.manifest.calendar
  const today = await deps.store.findCompleted(identity, request.signal)

  if (today !== null || !calendar.continuous) {
    return today
  }

  // The window is read in days here because the store cursors on one: a window wider than a day
  // reaches a row the previous day alone would leave to the cooldown it has not earned yet.
  const windowDays = Math.ceil(deps.policy.reuseWindowMs / MS_PER_DAY)
  const recent = await deps.store.findRecentCompleted({
    ...lookbackOf(identity, calendar.addTradingDays(identity.asOf, -windowDays)),
    signal: request.signal,
  })

  return recent !== null && request.now - recent.createdAt < deps.policy.reuseWindowMs
    ? recent
    : null
}

/** A call that read an earlier close stops answering for its day once a later close is stored. */
async function hasNewerEvidence(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<boolean> {
  const through = evidenceDayOf(suggestion)
  const bars = await readBarsSince(options, resolution, through)

  return bars?.kind === 'available' && bars.value.some((candle) => candle.at > through)
}

function evidenceDayOf(suggestion: Suggestion): TradingDay {
  return suggestion.evidenceThrough ?? suggestion.at
}

/** On a market with no session boundary a fresh entry is the live quote, which moves far between
 *  runs, so the newest call on a name answers again while it is an open buy inside its outcome
 *  window that can still be taken as written: one idea keeps one set of levels. */
async function findStandingBuy(
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

  return (await isOpenBuyLive(options, resolution, latest)) ? latest : undefined
}

/** Not traded since, the live quote between its stop and its void price, and no settled session
 *  since the call through the stop. Anything unread answers no, which runs a fresh call. */
async function isOpenBuyLive(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<boolean> {
  const { minimumRiskReward } = resolution.market.manifest
  const { stop } = suggestion

  if (minimumRiskReward === undefined || stop === undefined) {
    return false
  }

  const [quote, bars, change] = await Promise.all([
    readQuote(options, resolution),
    readBarsSince(options, resolution, suggestion.at),
    bookChangeOf(options, resolution, suggestion),
  ])

  return (
    change !== 'instrument' &&
    quote?.kind === 'available' &&
    !isSetupVoid(suggestion, quote.value, minimumRiskReward) &&
    bars?.kind === 'available' &&
    bars.value.every((candle) => candle.at < suggestion.at || candle.low > stop)
  )
}

/** The stored suggestion as it stands now: against the price, and against a book the operator may
 *  have changed since. Both are marked rather than re-run - a debate to say so is spend the
 *  operator did not ask for; `force` is there for the fresh call. */
async function resolveStanding(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<StoredSuggestion> {
  const [standing, change] = await Promise.all([
    withLevelCaveats(options, resolution, suggestion),
    bookChangeOf(options, resolution, suggestion),
  ])
  const caveat = bookChangeCaveat(suggestion, change)

  return caveat === undefined ? standing : withCaveat(standing, caveat)
}

/** A trade on the name itself can invert its direction. Any other row moves NAV and cash, which
 *  only matters to a row the book decided - a buy sized from cash, a sale under the plan's own
 *  reasons, a hold the portfolio settled - so only those say so, and other names stay quiet. */
function bookChangeCaveat(suggestion: StoredSuggestion, change: BookChange): Caveat | undefined {
  if (change === 'instrument' && suggestion.action !== 'hold') {
    return { code: 'suggestion.position-changed' }
  }

  return change !== 'none' && isReadOffTheBook(suggestion)
    ? { code: 'suggestion.book-changed' }
    : undefined
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
    suggestion.action === 'hold' &&
    bookHoldOf(suggestion) === 'book-hold' &&
    !suggestion.holdReasonCodes.includes('reference-only')
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

function readBarsSince(
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

export function identityOf(
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  asOf: TradingDay,
  focusKey: FocusKey
): SuggestionIdentity {
  return {
    asOf,
    strategyId: strategyId(resolution.market.manifest.id),
    strategyVersion: resolution.market.manifest.strategyVersion,
    focusKey,
    market: resolution.instrument.market,
    ticker: resolution.instrument.ticker,
  }
}
