import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  MarketDataRefreshRequest,
  MarketManifest,
  StaleKindsRequest,
} from '@/trading/markets/types'
import { assertNotAborted } from '@/core/errors'
import { reportRefreshStage } from '@/trading/kernel/market/refresh'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { US_MARKET_REF, US_UNIVERSE_STALE_MS } from '@/trading/markets/equity-us/policy'
import {
  activeCount,
  isUsUniverseStale,
  refreshUsUniverse,
} from '@/trading/markets/equity-us/refresh/universe'
import { buildSkippedResult } from '@/trading/markets/refresh-result'

/** Replaces the listing when it is stale or forced. The evidence kinds join this pass as they are
 *  added; each reads only what the listing stored. */
export async function refreshUsMarket(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: MarketDataRefreshRequest
): Promise<readonly RefreshKindResult[]> {
  const stored = await deps.marketDataStore.listInstruments({
    market: US_MARKET_REF,
    signal: request.signal,
  })

  if (!(request.forced || isUsUniverseStale(stored, request.now))) {
    return [buildSkippedResult('instruments', activeCount(stored))]
  }

  const startedTick = performance.now()

  reportRefreshStage(request.progress, { market: US_MARKET_REF, kind: 'instruments' })

  const outcome = await refreshUsUniverse(deps, {
    stored,
    now: request.now,
    signal: request.signal,
  })
  const instruments = { ...outcome.result, elapsedMs: performance.now() - startedTick }

  await settle({ deps, manifest, request }, instruments)

  return [instruments]
}

/** The listing follows a wall-clock cadence no session count expresses, measured from its attempt. */
export async function usStaleKinds(
  request: StaleKindsRequest
): Promise<readonly RefreshKindResult['kind'][]> {
  assertNotAborted(request.signal)

  return request.attempts
    .filter(
      (attempt) =>
        attempt.result.kind === 'instruments' &&
        request.now - attempt.attemptedAt > US_UNIVERSE_STALE_MS
    )
    .map((attempt) => attempt.result.kind)
}

interface SettleInput {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly request: MarketDataRefreshRequest
}

/** Never from `finally`: a throw or abort must leave no row so the next boot repairs the
 *  interrupted kind. */
async function settle(input: SettleInput, result: RefreshKindResult): Promise<void> {
  const { deps, manifest, request } = input

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
