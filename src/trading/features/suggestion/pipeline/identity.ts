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
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketResolution } from '@/trading/markets/types'
import { StorageError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { calendarSessionsBetween, resolveDay } from '@/trading/features/market-data/resolve'
import { isBookHold } from '@/trading/features/suggestion/pipeline/direction'
import {
  outcomeLookbackSessions,
  outcomeWindowSessions,
} from '@/trading/features/suggestion/pipeline/outcome-window'
import {
  buildSuggestionId,
  isRecordedPlan,
  isUndecidedHold,
} from '@/trading/features/suggestion/types'
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
  const answered = existing !== null && isStandingAnswer(existing, deps)
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

  if (recent === null || !isStandingAnswer(recent, deps)) {
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
  const created = await deps.store.create(stored, request.signal)

  if (created) {
    return { kind: 'completed', suggestion: stored, reused: false }
  }

  const existing = await readHolder(options, stored)

  // The identity is held by a row this run outranks — never decided, a shallower debate, forced past,
  // or read off an older close — so this run takes it over; a lost race means another writer did.
  const outranked = request.force === true || !isStandingAnswer(existing, deps)
  const fresher = isStandingAnswer(stored, deps) && evidenceDayOf(stored) > evidenceDayOf(existing)

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
    !isStandingAnswer(latest, deps) ||
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

  const [quote, bars, traded] = await Promise.all([
    readQuote(options, resolution),
    readBarsSince(options, resolution, suggestion.at),
    hasTradedSince(options, resolution, suggestion),
  ])

  return (
    !traded &&
    quote?.kind === 'available' &&
    !isSetupVoid(suggestion, quote.value, minimumRiskReward) &&
    bars?.kind === 'available' &&
    bars.value.every((candle) => candle.at < suggestion.at || candle.low > stop)
  )
}

/** The stored suggestion as it stands now: against the price, and against a book the operator may
 *  have traded since. Both are marked rather than re-run - the setup is dead either way, and a
 *  debate to say so is spend the operator did not ask for; `force` is there for the fresh call. */
async function resolveStanding(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<StoredSuggestion> {
  const [standing, traded] = await Promise.all([
    withLevelCaveats(options, resolution, suggestion),
    hasTradedSince(options, resolution, suggestion),
  ])

  return traded ? withCaveat(standing, { code: 'suggestion.position-changed' }) : standing
}

/** Only an actionable row is asked: its direction came from the weight gap and whether the name was
 *  held, so a fill since the call can invert it. Every row moves NAV and cash, which would flag
 *  every name after any trade - the size a reused row carries is what the caveat covers. */
async function hasTradedSince(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  suggestion: StoredSuggestion
): Promise<boolean> {
  if (suggestion.action === 'hold') {
    return false
  }

  return options.deps.portfolio.hasTradedSince(
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

function lookbackOf(
  identity: SuggestionIdentity,
  sinceDay: TradingDay
): Omit<SuggestionIdentity, 'asOf'> & { readonly sinceDay: TradingDay } {
  return {
    market: identity.market,
    ticker: identity.ticker,
    strategyId: identity.strategyId,
    strategyVersion: identity.strategyVersion,
    focusKey: identity.focusKey,
    sinceDay,
  }
}

/** What a run may serve back as today's answer and cool down on. An undecided row is not an answer,
 *  so serving it back would let one outage stand as today's decision; a recorded plan is levels the
 *  system wrote, not a call, so it may neither answer nor block one; a restated call prices levels on
 *  a basis the market no longer publishes, and an unfilled call has no trade behind it to stand on.
 *  The three sites that ask —
 *  reuse, cooldown, and the persist takeover — read this one predicate so they cannot drift. */
function isStandingAnswer(
  suggestion: StoredSuggestion,
  deps: SuggestionRunOptions['deps']
): boolean {
  return !(
    isUndecidedHold(suggestion) ||
    isRecordedPlan(suggestion) ||
    isRestatedCall(suggestion) ||
    isUnfilledCall(suggestion) ||
    isShallowerDebate(suggestion, deps)
  )
}

function isRestatedCall(suggestion: StoredSuggestion): boolean {
  return suggestion.action !== 'hold' && suggestion.restatedAt !== undefined
}

function isUnfilledCall(suggestion: StoredSuggestion): boolean {
  return suggestion.action !== 'hold' && suggestion.unfilledAt !== undefined
}

/** Its order stood through `until` and is gone, even before the daemon closes the row. */
function isLapsedLimit(suggestion: StoredSuggestion, asOf: TradingDay): boolean {
  return (
    suggestion.action === 'buy' &&
    suggestion.restingEntry !== undefined &&
    suggestion.restingEntry.until < asOf
  )
}

/** Depth ratchets up, never down: a full-debate request re-runs past a lean verdict and supersedes
 *  it, while a lean request happily reuses a full one. A row with no stored debate was decided by
 *  the deterministic gates, and a hold the book decided by neither - no depth can overturn either,
 *  so both satisfy any request. */
function isShallowerDebate(
  suggestion: StoredSuggestion,
  deps: SuggestionRunOptions['deps']
): boolean {
  return (
    deps.policy.debateMode === 'full' &&
    suggestion.debate?.mode === 'lean' &&
    !isBookHold(suggestion)
  )
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
