import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { DayWindow } from '@/trading/markets/admissibility'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { admissibleCandles } from '@/trading/markets/admissibility'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import { settledOnly } from '@/trading/markets/equity-vn/evidence/evidence'
import {
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'
import {
  BOARD_KINDS,
  seriesClass,
  tradeableTargets,
} from '@/trading/markets/equity-vn/refresh/targets'
import { buildRejectedOutcome } from '@/trading/markets/refresh-result'

/** Sessions per window when a name's whole history is fetched, sized to that same ceiling: one deep
 *  window is answered per name, a run of short ones for the whole board at once. */
const BACKFILL_CHUNK_SESSIONS = 20

/** Below this many names the backfill asks per name instead — a market-wide window costs the same
 *  pages whether one name needs it or all of them do. */
export const BACKFILL_MINIMUM_TARGETS = 50

export type BarOutcome = TargetOutcome<readonly BarRecord[]>

type BarProgress = ReturnType<typeof createRefreshProgress>

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

/** The names listed on the board: only those share a market-wide window. */
export function boardTickers(scope: EvidenceScope): ReadonlySet<Ticker> {
  return new Set(tradeableTargets(scope.universe, BOARD_KINDS).map((target) => target.ticker))
}

/** Two answers for one name, kept only while both carried bars; `join` says what the bars become. */
export function joinOutcomes(
  held: BarOutcome,
  next: BarOutcome,
  join: (held: readonly BarRecord[], next: readonly BarRecord[]) => readonly BarRecord[]
): BarOutcome {
  const provenance = dedupeProvenance([...held.provenance, ...next.provenance])
  const caveats = dedupeCaveats([...held.caveats, ...next.caveats])

  if (held.value === undefined || next.value === undefined) {
    return { instrument: held.instrument, provenance, caveats }
  }

  return { instrument: held.instrument, value: join(held.value, next.value), provenance, caveats }
}

interface BarPass {
  readonly window: DayWindow
  /** The line to advance; absent, the call counts its own names. */
  readonly progress?: BarProgress
}

export function fetchAllBars(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[],
  { window, progress = createBarProgress(scope, targets.length) }: BarPass
): Promise<readonly BarOutcome[]> {
  return mapWithConcurrency(targets, VN_SOURCE_CONCURRENCY, async (instrument) => {
    const outcome = await fetchBars(scope, instrument, window)

    progress.advance(1)

    return outcome
  })
}

/** One line for a pass over `total` names fetched in `windows` windows. Each window advances it once
 *  per name and the line shows one name per `windows` advances, so it climbs from 0 to `total` once
 *  across the windows. Names refetched whole afterwards count on their own line. */
export function createWindowedProgress(
  scope: EvidenceScope,
  total: number,
  windows: number
): BarProgress {
  const progress = createBarProgress(scope, total)
  let steps = 0
  let shown = 0

  return {
    advance(completed): void {
      steps += completed

      const gained = Math.floor(steps / windows) - shown

      if (gained > 0) {
        progress.advance(gained)
        shown += gained
      }
    },
  }
}

function createBarProgress(scope: EvidenceScope, total: number): BarProgress {
  return createRefreshProgress(
    scope.request.progress,
    { market: VN_MARKET_REF, kind: 'bars' },
    total
  )
}

async function fetchBars(
  scope: EvidenceScope,
  instrument: InstrumentRef,
  window: DayWindow
): Promise<BarOutcome> {
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
