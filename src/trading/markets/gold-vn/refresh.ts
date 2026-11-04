import type { RefreshKindResult, RefreshKindStatus } from '@/trading/kernel/market/refresh'
import type { MarketDataRefreshRequest } from '@/trading/markets/types'
import { reportRefreshStage } from '@/trading/kernel/market/refresh'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { GOLD_VN_MARKET_REF } from '@/trading/markets/gold-vn/policy'
import {
  backfillPremium,
  type PremiumBackfillDeps,
  type PremiumPass,
} from '@/trading/markets/gold-vn/premium-backfill'

/** The vendor history is the only writer: it is stamped at the counter's day boundary, where a live
 *  board read is stamped at whatever minute the run fired, and a population holding both ranks a day
 *  by how it was measured. */
export async function refreshPremium(
  refreshDeps: PremiumBackfillDeps,
  request: MarketDataRefreshRequest
): Promise<readonly RefreshKindResult[]> {
  reportRefreshStage(request.progress, { market: GOLD_VN_MARKET_REF, kind: 'premium' })

  const pass = await backfillPremium(refreshDeps, request)
  const result = buildPremiumResult(pass)

  // A pass with nothing wanted attempted nothing and leaves no row, as in every market.
  if (pass.attempted > 0) {
    await settleAttempt(refreshDeps, request, result)
  }

  return [result]
}

/** The row is what tells a read this market has been refreshed, so a pass that fetched leaves one
 *  whatever it wrote: without it every read refetches the vendor history. Never from `finally`: a
 *  throw or abort leaves no row, so the next pass repairs it. */
async function settleAttempt(
  refreshDeps: PremiumBackfillDeps,
  request: MarketDataRefreshRequest,
  result: RefreshKindResult
): Promise<void> {
  await refreshDeps.deps.marketDataStore.upsertRefreshAttempt(
    {
      market: GOLD_VN_MARKET_REF,
      asOf: resolveSettledDay(refreshDeps.calendar, request.now),
      attemptedAt: request.now,
      result,
    },
    request.signal
  )
}

/** One row for one series. A day the counter never published is not a target: counting it makes
 *  every pass a shortfall against days that cannot arrive, and names them as missing data the
 *  operator might go looking for. `fresh` then means nothing fetchable is left, whether because the
 *  window is full or because what it still lacks was never published. */
function buildPremiumResult(pass: PremiumPass): RefreshKindResult {
  const [coveredFrom] = [...pass.written].sort()
  const targetCount = pass.attempted - pass.unpublished.length

  return {
    kind: 'premium',
    status: statusOf(pass, targetCount),
    targetCount,
    successfulTargetCount: pass.written.length,
    missingTargets: [...pass.missing],
    recordCount: pass.written.length,
    ...(coveredFrom === undefined ? {} : { coveredFrom }),
    provenance: pass.provenance,
    caveats: pass.caveats,
  }
}

function statusOf(pass: PremiumPass, targetCount: number): RefreshKindStatus {
  if (targetCount === 0) {
    return 'fresh'
  }

  if (pass.fetchFailed) {
    return 'unavailable'
  }

  return pass.missing.length === 0 ? 'upserted' : 'partial'
}
