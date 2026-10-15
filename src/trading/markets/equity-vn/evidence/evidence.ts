import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  FlowSnapshot,
  FundamentalSnapshot,
  InstrumentRecord,
} from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { MarketDataRefreshRequest, TradingCalendar } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { isSameInstrument } from '@/trading/kernel/instrument'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import { isAdmissibleFlows } from '@/trading/markets/equity-vn/evidence/admissibility'
import {
  resolveCoveredFrom,
  resolveFetchWindow,
} from '@/trading/markets/equity-vn/evidence/fetch-window'
import { NO_DESK_DAYS, readFlows } from '@/trading/markets/equity-vn/evidence/flow-evidence'
import {
  VN_FLOW_SESSIONS,
  VN_FLOW_TAIL_SESSIONS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'
import { BOARD_KINDS, tradeableTargets } from '@/trading/markets/equity-vn/refresh/targets'
import { buildRejectedOutcome, toKindResult } from '@/trading/markets/refresh-result'
import { RATIO_BATCH_TICKERS } from '@/trading/sources/adapters/vndirect/client'

/** The invalidator half of the market's cross-section cache. Consuming only this method keeps
 *  evidence warming out of the capability module that owns the cache. */
export interface CrossSectionInvalidator {
  invalidate(): void
}

/** An absent value is an attempted target that returned nothing usable; it still contributes its
 *  caveats so the kind reports why it fell short. */
export interface EvidenceScope {
  readonly deps: MarketDeps
  readonly crossSection: CrossSectionInvalidator
  readonly universe: readonly InstrumentRecord[]
  readonly fromDay: TradingDay
  readonly calendar: TradingCalendar
  /** Whether the `asOf` session's tape has settled; until it has, a bar or flow row stamped `asOf`
   *  is still forming — the closing auction has not printed — and is never stored. */
  readonly asOfSettled: boolean
  /** When set, the only tickers this pass fetches: everything else was covered by the pass it
   *  repairs. The universe stays whole, so instrument classes and reference legs still resolve. */
  readonly repairTargets?: ReadonlySet<string>
  /** The earliest session the last settled pass of this kind covered, absent before the first. */
  readonly storedFrom?: TradingDay
  readonly request: MarketDataRefreshRequest
}

/** The provider has no market-wide ratio endpoint but answers a code list, so the sweep costs one
 *  request per batch rather than one per name. */
export async function refreshFundamentals(scope: EvidenceScope): Promise<RefreshKindResult> {
  const targets = tradeableTargets(scope.universe, ['equity'], scope.repairTargets)
  const batches = toBatches(targets, RATIO_BATCH_TICKERS)
  const progress = createRefreshProgress(
    scope.request.progress,
    { market: VN_MARKET_REF, kind: 'fundamentals' },
    targets.length
  )
  const outcomes = (
    await mapWithConcurrency(batches, VN_SOURCE_CONCURRENCY, async (batch) => {
      const results = await fetchFundamentals(scope, batch)

      progress.advance(batch.length)

      return results
    })
  ).flat()
  const records = outcomes.flatMap((outcome) =>
    outcome.value === undefined ? [] : [outcome.value]
  )

  await scope.deps.marketDataStore.upsertFundamentals(records, scope.request.signal)
  invalidateWhenWritten(scope, records.length)

  return toKindResult({
    kind: 'fundamentals',
    successStatus: 'upserted',
    outcomes,
    recordCount: records.length,
  })
}

/** One window for the whole pass, widened to the full factor window whenever any name's stored
 *  history does not reach the tail. Flows are upserted rather than replaced, so widening for one
 *  name re-covers days already stored as a no-op — where a bar write would have deleted them. */
export async function refreshFlows(scope: EvidenceScope): Promise<RefreshKindResult> {
  const targets = tradeableTargets(scope.universe, BOARD_KINDS, scope.repairTargets)
  const latest = await scope.deps.marketDataStore.listLatestFlowDays({
    market: VN_MARKET_REF,
    signal: scope.request.signal,
  })
  const historyFromDay = scope.calendar.addTradingDays(scope.request.asOf, -VN_FLOW_SESSIONS)
  const window = resolveFetchWindow({
    calendar: scope.calendar,
    latestByTicker: latest,
    targets,
    asOf: scope.request.asOf,
    tailSessions: VN_FLOW_TAIL_SESSIONS,
    historyFromDay,
    ...(scope.storedFrom === undefined ? {} : { storedFrom: scope.storedFrom }),
  })
  const fromDay = window.rebuild.length === 0 ? window.tailFromDay : historyFromDay
  const deskDays = await scope.deps.marketDataStore.listDeskDays({
    market: VN_MARKET_REF,
    fromDay,
    signal: scope.request.signal,
  })
  const progress = createRefreshProgress(
    scope.request.progress,
    { market: VN_MARKET_REF, kind: 'flows' },
    targets.length
  )
  const outcomes = await mapWithConcurrency(targets, VN_SOURCE_CONCURRENCY, async (instrument) => {
    const outcome = await fetchFlows(scope, {
      instrument,
      fromDay,
      deskDays: deskDays.get(instrument.ticker) ?? NO_DESK_DAYS,
    })

    progress.advance(1)

    return outcome
  })
  const records = outcomes.flatMap((outcome) => outcome.value ?? [])

  await scope.deps.marketDataStore.upsertFlows(records, scope.request.signal)
  invalidateWhenWritten(scope, records.length)

  return toKindResult({
    kind: 'flows',
    successStatus: 'upserted',
    outcomes,
    recordCount: records.length,
    coveredFrom: resolveCoveredFrom(scope.storedFrom, fromDay),
  })
}

/** A same-day reader holding the pre-refresh pass would keep serving the population this write
 *  replaced. */
export function invalidateWhenWritten(scope: EvidenceScope, recordCount: number): void {
  if (recordCount > 0) {
    scope.crossSection.invalidate()
  }
}

function toBatches<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const batches: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }

  return batches
}

/** One outcome per instrument the batch asked for, so the kind still counts one target per name: a
 *  code the response omitted is a rejected target, never a silently absent one. */
async function fetchFundamentals(
  scope: EvidenceScope,
  batch: readonly InstrumentRef[]
): Promise<readonly TargetOutcome<FundamentalSnapshot>[]> {
  const result = await scope.deps.sources.resolve({
    kind: 'fundamentals',
    context: { market: VN_MARKET_REF, tickers: batch.map((instrument) => instrument.ticker) },
    signal: scope.request.signal,
  })

  if (result.kind === 'unavailable') {
    const caveats = reportedCaveats(result.caveats, 'fundamentals')

    return batch.map((instrument) => buildRejectedOutcome(instrument, caveats))
  }

  return batch.map((instrument) => {
    const snapshot = result.value.find((value) => isSameInstrument(value.instrument, instrument))

    return snapshot === undefined
      ? buildRejectedOutcome<FundamentalSnapshot>(instrument, [
          ...result.caveats,
          buildPayloadRejectedCaveat(result.provenance, 'fundamentals'),
        ])
      : {
          instrument,
          value: snapshot,
          provenance: result.provenance,
          caveats: result.caveats,
        }
  })
}

interface FlowBounds {
  readonly instrument: InstrumentRef
  readonly fromDay: TradingDay
  readonly deskDays: ReadonlySet<TradingDay>
}

async function fetchFlows(
  scope: EvidenceScope,
  bounds: FlowBounds
): Promise<TargetOutcome<readonly FlowSnapshot[]>> {
  const { instrument } = bounds
  const window = { fromDay: bounds.fromDay, toDay: scope.request.asOf }
  const result = await readFlows(
    scope.deps.sources,
    { instrument, ...window, deskDays: bounds.deskDays },
    scope.request.signal
  )

  if (result.kind === 'unavailable') {
    return buildRejectedOutcome(instrument, reportedCaveats(result.caveats, 'flows'))
  }

  if (!isAdmissibleFlows(result.value, instrument, window)) {
    return buildRejectedOutcome(instrument, [
      ...result.caveats,
      buildPayloadRejectedCaveat(result.provenance, 'flows'),
    ])
  }

  return {
    instrument,
    value: settledOnly(result.value, scope),
    provenance: result.provenance,
    caveats: result.caveats,
  }
}

/** A row stamped `asOf` while its session is still trading is forming, and forming rows are
 *  never stored. */
export function settledOnly<T extends { readonly at: TradingDay }>(
  rows: readonly T[],
  scope: EvidenceScope
): readonly T[] {
  return scope.asOfSettled ? rows : rows.filter((row) => row.at < scope.request.asOf)
}
