import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { DayWindow } from '@/trading/markets/admissibility'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { admissibleCandles } from '@/trading/markets/admissibility'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import { settledOnly } from '@/trading/markets/equity-vn/evidence/evidence'
import {
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'
import { seriesClass } from '@/trading/markets/equity-vn/refresh/targets'
import { buildRejectedOutcome } from '@/trading/markets/refresh-result'

/** Sessions per window when a name's whole history is fetched, sized to that same ceiling: one deep
 *  window is answered per name, a run of short ones for the whole board at once. */
const BACKFILL_CHUNK_SESSIONS = 20

/** Below this many names the backfill asks per name instead — a market-wide window costs the same
 *  pages whether one name needs it or all of them do. */
export const BACKFILL_MINIMUM_TARGETS = 50

export type BarOutcome = TargetOutcome<readonly BarRecord[]>

/** Oldest first, so the merged series is already in the order every reader expects. */
export function chunkWindows(calendar: TradingCalendar, window: DayWindow): readonly DayWindow[] {
  const chunks: DayWindow[] = []
  let fromDay = window.fromDay

  while (fromDay <= window.toDay) {
    const step = calendar.addTradingDays(fromDay, BACKFILL_CHUNK_SESSIONS)
    const toDay = step > window.toDay ? window.toDay : step

    chunks.push({ fromDay, toDay })
    fromDay = calendar.addTradingDays(toDay, 1)
  }

  return chunks
}

export function fullWindow(scope: EvidenceScope): DayWindow {
  return { fromDay: scope.fromDay, toDay: scope.request.asOf }
}

export function fetchAllBars(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[],
  window: DayWindow
): Promise<readonly TargetOutcome<readonly BarRecord[]>[]> {
  const progress = createRefreshProgress(
    scope.request.progress,
    { market: VN_MARKET_REF, kind: 'bars' },
    targets.length
  )

  return mapWithConcurrency(targets, VN_SOURCE_CONCURRENCY, async (instrument) => {
    const outcome = await fetchBars(scope, instrument, window)

    progress.advance(1)

    return outcome
  })
}

async function fetchBars(
  scope: EvidenceScope,
  instrument: InstrumentRef,
  window: DayWindow
): Promise<TargetOutcome<readonly BarRecord[]>> {
  const result = await scope.deps.sources.resolve({
    kind: 'bars',
    context: {
      market: VN_MARKET_REF,
      instrument,
      ...seriesClass(scope.universe, instrument),
      ...window,
      limit: VN_EVIDENCE_SESSIONS,
    },
    signal: scope.request.signal,
  })

  if (result.kind === 'unavailable') {
    return buildRejectedOutcome(instrument, reportedCaveats(result.caveats, 'bars'))
  }

  const stamp = result.provenance[0]
  const candles = admissibleCandles(result.value, window)

  if (stamp === undefined || candles === null) {
    return buildRejectedOutcome(instrument, [
      ...result.caveats,
      buildPayloadRejectedCaveat(result.provenance, 'bars'),
    ])
  }

  return {
    instrument,
    value: settledOnly(candles, scope).map((candle) => ({
      sourceId: stamp.sourceId,
      fetchedAt: stamp.fetchedAt,
      instrument,
      candle,
      ...(candle.turnover === undefined ? {} : { turnover: candle.turnover }),
    })),
    provenance: result.provenance,
    caveats: result.caveats,
  }
}
