import type { Logger } from '@/core/logging/logger'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileStore } from '@/trading/features/profile/store'
import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { RefreshMarketDataResult } from '@/trading/kernel/market/refresh'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { isTapeServing, resolveSettledDay } from '@/trading/markets/calendar'

/** Names one tick reads: the burst the primary source was measured to serve unpaced, which covers a
 *  whole watchlist in one pass. The failover leg pages instead of aggregating and tires far sooner,
 *  but its breaker opens after three consecutive failures and skips the rest of the batch without
 *  touching the network. */
const MAXIMUM_TARGETS_PER_TICK = 20

/** Records the settled session for every followed name the given results cover, and hands those
 *  results back carrying a note for each name it could not record. The results are also the scope:
 *  `/refresh crypto` must not spend a VN provider's budget, and a miss under a market the pass never
 *  touched would have no block to be reported under. */
export type TradeSidesSweep = (
  results: readonly RefreshMarketDataResult[],
  signal: AbortSignal
) => Promise<readonly RefreshMarketDataResult[]>

/** A name whose settled session the sweep could not record. The tape serves that session only until
 *  the next open, so a miss the operator never sees is a hole no later pass can fill. */
interface MissedTradeSides {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly day: TradingDay
}

interface TradeSidesOperationDeps {
  readonly profiles: ProfileStore
  readonly portfolio: Pick<PortfolioService, 'positionsAt'>
  readonly markets: MarketRegistry
  readonly marketDataStore: MarketDataStore
  readonly logger: Logger
}

/** Records the aggressor split for every name the operator holds or watches, once its session has
 *  settled. Idempotent: a name whose settled day is already stored is skipped.
 *
 *  The cursor lives in this closure — never module scope, where two runs would share one scan
 *  position. Target order is stable, so a cursor-less sweep would re-read the same first page every
 *  tick: names past the ceiling would never be reached, and one name that always fails would
 *  starve every name behind it. */
export function createTradeSidesTick(deps: TradeSidesOperationDeps): TradeSidesSweep {
  let cursor = 0

  // Total by contract: the sweep rides a refresh the operator asked for, and an optional backfill
  // failing must not fail the refresh that carried it. A sweep that failed whole names nobody — it
  // never learned who — and says so in its own log line instead.
  return async (results, signal) => {
    try {
      const scope = results.map((result) => result.market)
      const outcome = await sweep(deps, { scope, cursor, signal })

      cursor = outcome.cursor

      return withMissedCaveats(results, outcome.missed)
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw err
      }

      deps.logger.warn('trading.trade_sides_sweep_failed', { err: formatErrForLog(err) })

      return results
    }
  }
}

/** A miss stands under its own market, beside that market's other notes. It belongs to no refresh
 *  kind — the sweep reads a per-name tape rather than a market-wide scope — so the market block is
 *  where it lands. */
function withMissedCaveats(
  results: readonly RefreshMarketDataResult[],
  missed: readonly MissedTradeSides[]
): readonly RefreshMarketDataResult[] {
  if (missed.length === 0) {
    return results
  }

  return results.map((result) => {
    const caveats = missed
      .filter((miss) => miss.market === result.market)
      .map(
        (miss): Caveat => ({
          code: 'market-data.trade-sides-missed',
          detail: { ticker: miss.ticker, day: miss.day },
        })
      )

    return caveats.length === 0
      ? result
      : { ...result, caveats: dedupeCaveats([...result.caveats, ...caveats]) }
  })
}

interface SweepOptions {
  readonly scope: readonly MarketRef[]
  readonly cursor: number
  readonly signal: AbortSignal
}

interface SweepOutcome {
  /** Where the next sweep resumes. */
  readonly cursor: number
  readonly missed: readonly MissedTradeSides[]
}

async function sweep(deps: TradeSidesOperationDeps, options: SweepOptions): Promise<SweepOutcome> {
  const { scope, signal } = options
  const now = Date.now()
  const targets = await resolveTargets({ deps, scope, now, signal })

  if (targets.length === 0) {
    return { cursor: 0, missed: [] }
  }

  const start = options.cursor % targets.length
  const take = Math.min(MAXIMUM_TARGETS_PER_TICK, targets.length)
  const missed: MissedTradeSides[] = []

  for (let taken = 0; taken < take; taken++) {
    const target = targets[(start + taken) % targets.length]

    if (signal.aborted || target === undefined) {
      return { cursor: options.cursor, missed }
    }

    const recorded = await recordOne({ deps, target, now, signal })

    if (!recorded) {
      missed.push(toMiss(target))
    }
  }

  return { cursor: start + take, missed }
}

interface TradeSidesTarget {
  readonly instrument: InstrumentRef
  readonly market: Market
  readonly settledDay: TradingDay
}

interface ResolveTargetsOptions {
  readonly deps: TradeSidesOperationDeps
  readonly scope: readonly MarketRef[]
  readonly now: number
  readonly signal: AbortSignal
}

async function resolveTargets(
  options: ResolveTargetsOptions
): Promise<readonly TradeSidesTarget[]> {
  const { deps, scope, now, signal } = options
  const [profile, positions] = await Promise.all([
    deps.profiles.find(signal),
    deps.portfolio.positionsAt({ now, signal }),
  ])
  const followed = new Map<string, InstrumentRef>()

  for (const instrument of [
    ...(profile?.watchlist ?? []),
    ...positions.map((row) => row.instrument),
  ]) {
    if (scope.includes(instrument.market)) {
      followed.set(buildInstrumentKey(instrument), instrument)
    }
  }

  return [...followed.values()].flatMap((instrument) => toTarget(deps, instrument, now))
}

function toMiss(target: TradeSidesTarget): MissedTradeSides {
  return {
    market: target.instrument.market,
    ticker: target.instrument.ticker,
    day: target.settledDay,
  }
}

/** A market with no `tradeSides` capability contributes no target, rather than one that will always
 *  fail, and neither does one whose settled tape is not the one a provider would answer with. */
function toTarget(
  deps: TradeSidesOperationDeps,
  instrument: InstrumentRef,
  now: number
): readonly TradeSidesTarget[] {
  const market = deps.markets.find(instrument.market)

  if (market?.capabilities.tradeSides === undefined) {
    return []
  }

  const calendar = market.manifest.calendar
  const settledDay = resolveSettledDay(calendar, now)

  if (!isTapeServing(calendar, settledDay, now)) {
    return []
  }

  return [{ instrument, market, settledDay }]
}

interface RecordOptions {
  readonly deps: TradeSidesOperationDeps
  readonly target: TradeSidesTarget
  readonly now: number
  readonly signal: AbortSignal
}

/** One name's failure costs that name alone: this is a best-effort backfill of an optional evidence
 *  kind, so a provider refusing one symbol must not cost every symbol behind it in the tick. */
async function recordOne(options: RecordOptions): Promise<boolean> {
  try {
    return await record(options)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    options.deps.logger.warn('trading.trade_sides_skipped', {
      ticker: options.target.instrument.ticker,
      market: options.target.instrument.market,
      day: options.target.settledDay,
      err: formatErrForLog(err),
    })

    return false
  }
}

/** Whether the target's settled session is recorded — already stored, or stored by this call. */
async function record(options: RecordOptions): Promise<boolean> {
  const { deps, target, now, signal } = options
  const stored = await deps.marketDataStore.listTradeSides({
    instrument: target.instrument,
    fromDay: target.settledDay,
    toDay: target.settledDay,
    signal,
  })

  if (stored.length > 0) {
    return true
  }

  const result = await target.market.capabilities.tradeSides?.run({
    instrument: target.instrument,
    asOf: target.settledDay,
    now,
    signal,
  })

  if (result?.kind === 'available') {
    await deps.marketDataStore.upsertTradeSides([result.value], signal)

    return true
  }

  // Degraded, not expected: a target only exists while its tape is still being served, so a
  // provider answering with nothing here is a session at risk of being lost at the next open.
  deps.logger.warn('trading.trade_sides_unavailable', {
    ticker: target.instrument.ticker,
    day: target.settledDay,
    reason: result?.kind === 'unavailable' ? result.reason : 'unsupported',
  })

  return false
}
