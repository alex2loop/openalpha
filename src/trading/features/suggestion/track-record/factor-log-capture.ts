import type {
  FactorLogCaptureResult,
  FactorLogEntry,
  FactorLogSkipReason,
  FactorLogStore,
} from '@/trading/features/suggestion/track-record/factor-log-types'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { canResolveOutcomes } from '@/trading/features/suggestion/track-record/resolvable'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

interface CaptureDeps {
  readonly markets: MarketRegistry
  readonly store: FactorLogStore
}

interface CaptureOptions {
  readonly now: number
  readonly signal: AbortSignal
}

type Skip = {
  readonly market: MarketRef
  readonly reason: FactorLogSkipReason
  readonly error?: unknown
}
type Captured = { readonly market: MarketRef; readonly day: TradingDay; readonly rows: number }

/** One board per market per settled session. A market whose evidence has not caught up with the
 *  session (the header dates the board earlier than the day asked for) is left for the next tick
 *  rather than logged against a day its scores do not describe. A market whose capture throws is
 *  reported as skipped and does not stop the markets after it. */
export async function captureBoards(
  deps: CaptureDeps,
  options: CaptureOptions
): Promise<FactorLogCaptureResult> {
  const captured: Captured[] = []
  const skipped: Skip[] = []

  for (const market of deps.markets.list()) {
    const result = await captureIsolated(deps, market, options)

    if ('reason' in result) {
      skipped.push(result)
    } else {
      captured.push(result)
    }
  }

  return { captured, skipped }
}

async function captureIsolated(
  deps: CaptureDeps,
  market: Market,
  options: CaptureOptions
): Promise<Captured | Skip> {
  try {
    return await captureMarket(deps, market, options)
  } catch (err: unknown) {
    if (isAbortError(err) || options.signal.aborted) {
      throw err
    }

    return { market: market.manifest.id, reason: 'capture-failed', error: err }
  }
}

async function captureMarket(
  deps: CaptureDeps,
  market: Market,
  options: CaptureOptions
): Promise<Captured | Skip> {
  const id = market.manifest.id
  const screen = market.capabilities.screen

  if (screen === undefined || !canResolveOutcomes(market)) {
    return { market: id, reason: 'no-screen' }
  }

  const day = resolveSettledDay(market.manifest.calendar, options.now)

  if (await deps.store.hasDay(id, day, options.signal)) {
    return { market: id, reason: 'already-captured' }
  }

  const board = await screen.run({
    market: id,
    limit: SURFACE_LIMITS.maximumFactorLogRows,
    asOf: day,
    now: options.now,
    signal: options.signal,
  })

  if (board.candidates.length === 0) {
    return { market: id, reason: 'universe-empty' }
  }

  if (board.dataThroughDay !== undefined && board.dataThroughDay < day) {
    return { market: id, reason: 'evidence-lagging' }
  }

  const entries = board.candidates.flatMap((candidate) => toEntry(market, day, candidate))
  const rows = await deps.store.insertMany(entries, options.signal)

  return { market: id, day, rows }
}

/** A candidate the market could not score, or could not price at the close of the day it is logged
 *  against, carries nothing a forward return could be measured from: a close from an earlier
 *  session is not that day's entry. */
function toEntry(market: Market, day: TradingDay, candidate: ScreenCandidate): FactorLogEntry[] {
  const close = candidate.previousClose?.at === day ? candidate.previousClose.price : undefined

  if (close === undefined || close <= 0 || candidate.composite.coverageBelowMinimum) {
    return []
  }

  return [
    {
      instrument: candidate.instrument,
      day,
      strategyVersion: market.manifest.strategyVersion,
      horizon: market.manifest.horizon,
      close,
      composite: candidate.composite,
      factors: candidate.factors.map((factor) => ({
        id: factor.id,
        score: factor.score,
        ...(factor.weight === undefined ? {} : { weight: factor.weight }),
      })),
      signals: candidate.signals ?? [],
    },
  ]
}
