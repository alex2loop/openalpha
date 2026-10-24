import type { Logger } from '@/core/logging/logger'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { CallScoredNotices } from '@/trading/features/suggestion/track-record/scored-notice'
import type { OutcomeResolutionBatch } from '@/trading/features/suggestion/track-record/types'
import type {
  ActionableStoredSuggestion,
  OutcomeResolution,
  SuggestionId,
  SuggestionOutcome,
} from '@/trading/features/suggestion/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { MarketCosts } from '@/trading/markets/cost'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { calendarSessionsBetween } from '@/trading/features/market-data/resolve'
import {
  outcomeLookbackSessions,
  outcomeWindowSessions,
} from '@/trading/features/suggestion/pipeline/outcome-window'
import {
  EXPIRY_BACKSTOP_MULTIPLE,
  resolveOutcome,
} from '@/trading/features/suggestion/pipeline/outcomes'
import { canResolveOutcomes } from '@/trading/features/suggestion/track-record/resolvable'
import { notifyCallScored } from '@/trading/features/suggestion/track-record/scored-notice'
import { UNFILLED_STATUS } from '@/trading/kernel/conviction'
import { RESTATEMENT_TOLERANCE } from '@/trading/markets/bar-restatement'
import { marketRoundTripRate } from '@/trading/markets/cost'
import { resolveTrailBounds } from '@/trading/markets/levels'

export interface OutcomeResolutionDeps extends MarketCosts {
  readonly markets: MarketRegistry
  readonly store: SuggestionStore
  readonly logger: Logger
  readonly notices: CallScoredNotices
}

/** One pass's reads. Every row of a market is scored against the same benchmark series, so it is
 *  read once per market and read day in a pass, at the full lookback any row can ask for. */
interface ResolvePass {
  readonly deps: OutcomeResolutionDeps
  readonly options: OperationTickOptions<SuggestionId>
  readonly benchmarks: Map<string, Promise<readonly Candle[] | undefined>>
}

interface BarWindow {
  readonly asOf: TradingDay
  readonly sessions: number
  readonly holdingSessions: number
  /** The window's own end rather than today: the holding window had already passed the lookback. */
  readonly anchored: boolean
}

/** Whether the series reaches the call's whole window, asked only of an anchored read: `unknown`
 *  is a provider that could not answer, which is not evidence the bars are gone. */
type SeriesCoverage = 'covered' | 'uncovered' | 'unknown'

interface WindowSeries {
  readonly suggestion: ActionableStoredSuggestion
  readonly market: Market
  readonly window: BarWindow
  readonly bars: readonly Candle[]
}

const PENDING_BARS: OutcomeResolution = Object.freeze({
  kind: 'pending',
  reason: 'insufficient-bars',
})

type Unscorable = Extract<OutcomeResolution, { readonly kind: 'unscorable' }>

const BARS_MISSING: Unscorable = Object.freeze({ kind: 'unscorable', reason: 'bars-missing' })
const SERIES_RESTATED: Unscorable = Object.freeze({ kind: 'unscorable', reason: 'series-restated' })

/** One sequential pass over a bounded page. Resolution is idempotent: `SuggestionStore.resolve` is
 *  guarded by `outcome_status IS NULL`, so a retried tick writes nothing. */
export async function resolvePendingOutcomes(
  deps: OutcomeResolutionDeps,
  options: OperationTickOptions<SuggestionId>
): Promise<OutcomeResolutionBatch> {
  const page = await deps.store.listPendingActionable({
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    limit: options.batchSize,
    signal: options.signal,
  })
  const pass: ResolvePass = { deps, options, benchmarks: new Map() }
  const results: OutcomeResolution[] = []

  // Sequential, not concurrent: each row costs one bar fetch, and a page of them issued at once
  // would spike the same provider the interactive surfaces share.
  for (const suggestion of page.items) {
    results.push(await resolveIsolated(pass, suggestion))
  }

  return { results, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
}

/** A row that throws stays pending for the next tick instead of aborting the page, which would
 *  block every higher id behind it on each pass. */
async function resolveIsolated(
  pass: ResolvePass,
  suggestion: ActionableStoredSuggestion
): Promise<OutcomeResolution> {
  try {
    return await resolveOne(pass, suggestion)
  } catch (err: unknown) {
    if (isAbortError(err) || pass.options.signal.aborted) {
      throw err
    }

    pass.deps.logger.warn('trading.outcome_resolve_failed', {
      id: suggestion.id,
      market: suggestion.instrument.market,
      ticker: suggestion.instrument.ticker,
      err: formatErrForLog(err),
    })

    return PENDING_BARS
  }
}

async function resolveOne(
  pass: ResolvePass,
  suggestion: ActionableStoredSuggestion
): Promise<OutcomeResolution> {
  const { deps, options } = pass
  const market = deps.markets.find(suggestion.instrument.market)
  const barsCapability = market?.capabilities.bars

  if (market === null || barsCapability === undefined || !canResolveOutcomes(market)) {
    return PENDING_BARS
  }

  const window = barWindow(market, suggestion, options.now)

  if (window === null) {
    return PENDING_BARS
  }

  const bars = await barsCapability.run({
    instrument: suggestion.instrument,
    asOf: window.asOf,
    now: options.now,
    // The trail's own history rides in front, so its first level reads a full series.
    sessions: window.sessions + (market.trail?.sessions ?? 0),
    signal: options.signal,
  })
  const coverage = window.anchored ? coverageOf(bars, suggestion.at) : 'covered'

  if (coverage === 'uncovered') {
    return await closeUnscorable(pass, suggestion, BARS_MISSING)
  }

  if (coverage === 'unknown' || bars.kind !== 'available') {
    return PENDING_BARS
  }

  return await scoreSeries(pass, { suggestion, market, window, bars: bars.value })
}

async function scoreSeries(pass: ResolvePass, series: WindowSeries): Promise<OutcomeResolution> {
  const { deps, options } = pass
  const { suggestion, market, window } = series

  if (isRestatedSince(series)) {
    return await closeUnscorable(pass, suggestion, SERIES_RESTATED)
  }

  const [benchmarkBars, trailBounds] = await Promise.all([
    loadBenchmark(pass, market, window),
    resolveTrailBounds(market, {
      instrument: suggestion.instrument,
      asOf: window.asOf,
      now: options.now,
      signal: options.signal,
    }),
  ])
  const resolution = resolveOutcome({
    suggestion,
    bars: series.bars,
    maximumHoldingSessions: window.holdingSessions,
    elapsedSessions: window.sessions - 1,
    ...(benchmarkBars === undefined ? {} : { benchmarkBars }),
    ...(suggestion.quote === undefined
      ? {}
      : { entrySession: market.manifest.calendar.dayAt(suggestion.quote.observedAt) }),
    roundTripFeeFraction: marketRoundTripRate(deps, market.manifest.id),
    now: options.now,
    ...(market.trail === undefined ? {} : { trail: market.trail }),
    trailBounds,
    ...(market.priceLimit === undefined ? {} : { priceLimit: market.priceLimit }),
  })

  if (resolution.kind === 'resolved') {
    await storeOutcome(pass, series, resolution.outcome)
  }

  if (resolution.kind === 'unscorable') {
    return await closeUnscorable(pass, suggestion, resolution)
  }

  return resolution
}

/** Keeps the result and, when the store took it, tells the operator once: a retried tick finds the
 *  row already closed and writes and says nothing. */
async function storeOutcome(
  pass: ResolvePass,
  series: WindowSeries,
  outcome: SuggestionOutcome
): Promise<void> {
  const { deps, options } = pass
  const { suggestion, market } = series

  if (!(await deps.store.resolve(suggestion.id, outcome, options.signal))) {
    return
  }

  await notifyCallScored(
    { ...deps.notices, logger: deps.logger },
    { suggestion, market, outcome },
    options
  )
}

/** A series that stops short of the call's own session would make every fetched bar look like
 *  session one, and one with nothing after it has nothing to score. A failed read, or a stale
 *  cache served because the provider failed, is `unknown` even where the cause is permanent (a name
 *  not yet listed on that date): an outage looks the same, and a close cannot be undone. */
function coverageOf(bars: SourceResult<readonly Candle[]>, at: TradingDay): SeriesCoverage {
  if (bars.kind === 'unavailable') {
    return bars.reason === 'empty' ? 'uncovered' : 'unknown'
  }

  if (isStaleCache(bars)) {
    return 'unknown'
  }

  const first = bars.value.at(0)
  const last = bars.value.at(-1)

  return first !== undefined && last !== undefined && first.at <= at && last.at > at
    ? 'covered'
    : 'uncovered'
}

/** A quote prints inside its own session's range, so an adjusted bar for that session that no
 *  longer spans it, past rounding, was re-based after the call by a dividend or split: every level
 *  the call names sits on a scale the series has left. A raw series is never re-based. */
function isRestatedSince(series: WindowSeries): boolean {
  const { quote } = series.suggestion

  if (quote === undefined) {
    return false
  }

  const session = series.market.manifest.calendar.dayAt(quote.observedAt)
  const bar = series.bars.find((candle) => candle.at === session)

  return (
    bar?.adjustment === 'adjusted' &&
    (quote.price < bar.low * (1 - RESTATEMENT_TOLERANCE) ||
      quote.price > bar.high * (1 + RESTATEMENT_TOLERANCE))
  )
}

/** No result is stated, so the row leaves the pending set without entering a scored population: its
 *  series cannot be read, or its order never filled. Closing is the failure direction chosen for a
 *  series every provider answered for and cannot serve, or one re-based under the call: leaving the
 *  row open would re-ask on every tick for ever. */
async function closeUnscorable(
  pass: ResolvePass,
  suggestion: ActionableStoredSuggestion,
  resolution: Unscorable
): Promise<OutcomeResolution> {
  const { deps, options } = pass
  const closed = await deps.store.closeUnscorable({
    id: suggestion.id,
    status: resolution.reason === 'never-filled' ? UNFILLED_STATUS : 'expired',
    now: options.now,
    signal: options.signal,
  })

  if (closed) {
    deps.logger.info('trading.outcome_unscorable', {
      id: suggestion.id,
      market: suggestion.instrument.market,
      ticker: suggestion.instrument.ticker,
      at: suggestion.at,
      reason: resolution.reason,
    })
  }

  return resolution
}

/** The window must reach back to the suggestion's own session, because the holding window is
 *  counted forward from it. A trailing window that starts later would make every fetched bar look
 *  like session one.
 *
 *  Sized from the calendar's projection, not from stored bars: only one market persists a bar
 *  series, so an observed-session count would be zero - and permanently pending - everywhere else.
 *  A projection over-counts across a holiday, which only widens the fetch; `resolveOutcome` settles
 *  on the bars the source actually returned, and reads the projection only as its far-out backstop
 *  against a series that never completes.
 *
 *  A call whose session is further back than the lookback is read at the end of its own window
 *  instead of today, just far enough past it for that backstop to have fired. The scorer takes only
 *  the bars inside the holding window, so the later ones change nothing: the row is graded as it
 *  would have been when the window closed, rather than waiting for a trailing read that can no
 *  longer reach it. */
function barWindow(
  market: Market,
  suggestion: ActionableStoredSuggestion,
  now: number
): BarWindow | null {
  const { calendar, defaultCalendar } = market.manifest
  const holdingSessions = outcomeWindowSessions(defaultCalendar, suggestion.horizon)
  const asOf = calendar.dayAt(now)
  const sessions = calendarSessionsBetween(market, suggestion.at, asOf)

  if (sessions < 2) {
    return null
  }

  if (sessions <= outcomeLookbackSessions(defaultCalendar)) {
    return { asOf, sessions, holdingSessions, anchored: false }
  }

  const anchor = calendar.addTradingDays(
    suggestion.at,
    holdingSessions * EXPIRY_BACKSTOP_MULTIPLE + 1
  )

  return {
    asOf: anchor,
    sessions: calendarSessionsBetween(market, suggestion.at, anchor),
    holdingSessions,
    anchored: true,
  }
}

/** A benchmark the market declines to name, or one whose own series is unavailable, yields no
 *  comparison — never a comparison against a different index. */
function loadBenchmark(
  pass: ResolvePass,
  market: Market,
  window: BarWindow
): Promise<readonly Candle[] | undefined> {
  const benchmark = market.manifest.benchmark

  if (benchmark === undefined || market.capabilities.bars === undefined) {
    return Promise.resolve(undefined)
  }

  // An anchored row reads the series as of its own window's end, so the day is part of the key.
  const key = `${market.manifest.id}:${window.asOf}`
  const known = pass.benchmarks.get(key)

  if (known !== undefined) {
    return known
  }

  const read = readBenchmark(pass, { market, benchmark, asOf: window.asOf })

  pass.benchmarks.set(key, read)

  return read
}

interface BenchmarkQuery {
  readonly market: Market
  readonly benchmark: InstrumentRef
  readonly asOf: TradingDay
}

async function readBenchmark(
  pass: ResolvePass,
  query: BenchmarkQuery
): Promise<readonly Candle[] | undefined> {
  const { market } = query
  const bars = await market.capabilities.bars?.run({
    instrument: query.benchmark,
    asOf: query.asOf,
    now: pass.options.now,
    // One close before the furthest-back window, which is where the benchmark starts for a call
    // made before its session opened or on a day the market was shut.
    sessions: outcomeLookbackSessions(market.manifest.defaultCalendar) + 1,
    signal: pass.options.signal,
  })

  // A stale cache served because the provider failed may end sessions short of the exit.
  return bars?.kind === 'available' && !isStaleCache(bars) ? bars.value : undefined
}

function isStaleCache(bars: { readonly caveats: readonly { readonly code: string }[] }): boolean {
  return bars.caveats.some((caveat) => caveat.code === 'source.stale-cache')
}
