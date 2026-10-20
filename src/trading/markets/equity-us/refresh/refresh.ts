import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type {
  MarketRefreshAttempt,
  RefreshDataKind,
  RefreshKindResult,
} from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsBoardCache } from '@/trading/markets/equity-us/board'
import type {
  MarketDataRefreshRequest,
  MarketManifest,
  StaleKindsRequest,
  TradingCalendar,
} from '@/trading/markets/types'
import { assertNotAborted } from '@/core/errors'
import { reportRefreshStage } from '@/trading/kernel/market/refresh'
import { isSettled, resolveSettledDay } from '@/trading/markets/calendar'
import {
  US_ACCOUNTS_STALE_MS,
  US_EVIDENCE_SESSIONS,
  US_MARKET_REF,
  US_UNIVERSE_STALE_MS,
} from '@/trading/markets/equity-us/policy'
import { refreshUsAccounts } from '@/trading/markets/equity-us/refresh/accounts'
import { refreshUsBars } from '@/trading/markets/equity-us/refresh/bars'
import { refreshUsFundamentals } from '@/trading/markets/equity-us/refresh/fundamentals'
import { refreshUsMacro } from '@/trading/markets/equity-us/refresh/macro'
import {
  activeCount,
  isUsUniverseStale,
  refreshUsUniverse,
} from '@/trading/markets/equity-us/refresh/universe'
import { buildSkippedResult } from '@/trading/markets/refresh-result'

/** Kinds whose cadence no session count expresses, judged by the age of their last attempt. */
const WALL_CLOCK_MS: Readonly<Partial<Record<RefreshDataKind, number>>> = Object.freeze({
  instruments: US_UNIVERSE_STALE_MS,
  accounts: US_ACCOUNTS_STALE_MS,
})

interface UsRefreshInput {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly board: Pick<UsBoardCache, 'invalidate'>
  readonly request: MarketDataRefreshRequest
}

/** Kinds run in dependency order: the listing says who exists, fundamentals say who is large
 *  enough to be on the board, and the bars are fetched for exactly that set. */
export async function refreshUsMarket(
  input: UsRefreshInput
): Promise<readonly RefreshKindResult[]> {
  const { deps, request } = input
  const [stored, attempts] = await Promise.all([
    deps.marketDataStore.listInstruments({ market: US_MARKET_REF, signal: request.signal }),
    deps.marketDataStore.listRefreshAttempts({ market: US_MARKET_REF, signal: request.signal }),
  ])
  const instruments = await refreshInstruments(input, stored)
  const universe = instruments.universe

  if (universe.every((record) => record.status !== 'active')) {
    return [instruments.result]
  }

  const fundamentals = await runKind({ ...input, attempts }, 'fundamentals', () =>
    refreshUsFundamentals(deps, { universe, request })
  )
  const accounts = await runKind({ ...input, attempts }, 'accounts', () =>
    refreshUsAccounts(deps, { manifest: input.manifest, universe, request })
  )
  const storedFrom = attempts.find((attempt) => attempt.result.kind === 'bars')?.result.coveredFrom
  const bars = await runKind({ ...input, attempts }, 'bars', () =>
    refreshUsBars(deps, {
      manifest: input.manifest,
      universe,
      request,
      ...(storedFrom === undefined ? {} : { storedFrom }),
    })
  )

  input.board.invalidate()

  const macro = await runKind({ ...input, attempts }, 'macro', () => refreshUsMacro(input))

  return [instruments.result, fundamentals, accounts, bars, macro]
}

export async function usStaleKinds(
  calendar: TradingCalendar,
  request: StaleKindsRequest
): Promise<readonly RefreshDataKind[]> {
  assertNotAborted(request.signal)

  return request.attempts
    .filter((attempt) => !isKindCurrent(calendar, request.now, attempt))
    .map((attempt) => attempt.result.kind)
}

/** The listing follows a wall-clock cadence no session count expresses. Every other kind stands
 *  for the session it was settled against: a pass that ran before its own day closed recorded a
 *  forming tape under that day's name, and the history it covers must still reach the depth the
 *  readers need. */
function isKindCurrent(
  calendar: TradingCalendar,
  now: number,
  attempt: MarketRefreshAttempt
): boolean {
  const cadenceMs = WALL_CLOCK_MS[attempt.result.kind]

  if (cadenceMs !== undefined) {
    return now - attempt.attemptedAt <= cadenceMs
  }

  return (
    isSettled(calendar, attempt.asOf, attempt.attemptedAt) &&
    attempt.asOf >= resolveSettledDay(calendar, now) &&
    coversHistory(calendar, now, attempt)
  )
}

function coversHistory(
  calendar: TradingCalendar,
  now: number,
  attempt: MarketRefreshAttempt
): boolean {
  if (attempt.result.kind !== 'bars') {
    return true
  }

  const required = calendar.addTradingDays(calendar.dayAt(now), -US_EVIDENCE_SESSIONS)

  return attempt.result.coveredFrom !== undefined && attempt.result.coveredFrom <= required
}

async function refreshInstruments(
  input: UsRefreshInput,
  stored: readonly InstrumentRecord[]
): Promise<{ readonly result: RefreshKindResult; readonly universe: readonly InstrumentRecord[] }> {
  const { deps, request } = input

  if (!(request.forced || isUsUniverseStale(stored, request.now))) {
    return { result: buildSkippedResult('instruments', activeCount(stored)), universe: stored }
  }

  const startedTick = performance.now()

  reportRefreshStage(request.progress, { market: US_MARKET_REF, kind: 'instruments' })

  const outcome = await refreshUsUniverse(deps, {
    stored,
    now: request.now,
    signal: request.signal,
  })
  const result = { ...outcome.result, elapsedMs: performance.now() - startedTick }

  await settle(input, result)

  return { result, universe: outcome.universe }
}

/** A stored attempt stands in for a pass unless the operator forced the run. */
interface KindContext extends UsRefreshInput {
  readonly attempts: readonly MarketRefreshAttempt[]
}

async function runKind(
  input: KindContext,
  kind: RefreshDataKind,
  run: () => Promise<RefreshKindResult>
): Promise<RefreshKindResult> {
  const { attempts } = input
  const attempt = attempts.find((entry) => entry.result.kind === kind)

  if (
    !input.request.forced &&
    attempt !== undefined &&
    isKindCurrent(input.manifest.calendar, input.request.now, attempt)
  ) {
    return buildSkippedResult(kind, attempt.result.recordCount)
  }

  const startedTick = performance.now()
  const result = { ...(await run()), elapsedMs: performance.now() - startedTick }

  await settle(input, result)

  return result
}

/** Never from `finally`: a throw or abort must leave no row so the next boot repairs the
 *  interrupted kind. */
async function settle(input: UsRefreshInput, result: RefreshKindResult): Promise<void> {
  const { deps, manifest, request } = input

  // A kind that attempted nothing leaves no row, so the next pass asks again.
  if (result.targetCount === 0) {
    return
  }

  await deps.marketDataStore.upsertRefreshAttempt(
    {
      market: US_MARKET_REF,
      asOf: resolveSettledDay(manifest.calendar, request.now),
      attemptedAt: request.now,
      result,
    },
    request.signal
  )
}
