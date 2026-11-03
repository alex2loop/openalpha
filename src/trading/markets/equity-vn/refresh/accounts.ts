import type { InstrumentRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  AnnualAccounts,
  FiledAccounts,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import type { VnMacroCrossSection } from '@/trading/markets/equity-vn/evidence/macro-evidence'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { hasCashFlow, isBankLines } from '@/trading/kernel/market/annual-accounts'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { periodIndexOf } from '@/trading/markets/accounts-trailing'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { watchedQuarter } from '@/trading/markets/equity-vn/accounts/quarter-watch'
import { isAccountsFetched, isFetchedBeforeFinal } from '@/trading/markets/equity-vn/accounts/score'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import { invalidateWhenWritten } from '@/trading/markets/equity-vn/evidence/evidence'
import {
  ACCOUNTS_REFETCH_MS,
  QUARTER_WATCH_REFETCH_MS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'
import { fillCashFlow } from '@/trading/markets/equity-vn/refresh/cash-flow-fill'
import { followedTickersIn, heldTickersIn } from '@/trading/markets/held-tickers'
import {
  buildRejectedOutcome,
  buildSkippedResult,
  toKindResult,
} from '@/trading/markets/refresh-result'

interface TargetInput {
  readonly scope: EvidenceScope
  /** The names a report can act on. */
  readonly wanted: ReadonlySet<string>
  readonly stored: ReadonlyMap<Ticker, readonly AnnualAccounts[]>
  readonly quarters: ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>
}

/** The names a report can act on: the screened board, where every buy comes from, and the book,
 *  whose long-horizon sale reads the score. A watched name off the board fails admission before
 *  any gate reads it. Runs after macro, so the cross-section it reads is the one macro just built;
 *  a write drops it for the next reader. */
export async function refreshAccounts(
  scope: EvidenceScope,
  crossSection: VnMacroCrossSection
): Promise<RefreshKindResult> {
  const { request } = scope
  const storeOptions = { market: VN_MARKET_REF, signal: request.signal }
  const [wanted, stored, quarters] = await Promise.all([
    wantedNames(scope, crossSection),
    scope.deps.marketDataStore.listAnnualAccounts(storeOptions),
    scope.deps.marketDataStore.listQuarterlyAccounts(storeOptions),
  ])
  const targets = dueTargets({ scope, wanted, stored, quarters })

  if (targets.length === 0) {
    return buildSkippedResult('accounts', storedReportCount(stored))
  }

  const progress = createRefreshProgress(
    request.progress,
    { market: VN_MARKET_REF, kind: 'accounts' },
    targets.length
  )
  const outcomes = await mapWithConcurrency(targets, VN_SOURCE_CONCURRENCY, async (instrument) => {
    const outcome = await fetchAccounts(scope, instrument)
    const filled = await withCashFlowFill(scope, outcome, quarters.get(instrument.ticker) ?? [])

    progress.advance(1)

    return filled
  })
  const filed: FiledAccounts = {
    annual: outcomes.flatMap((outcome) => outcome.value?.annual ?? []),
    quarters: outcomes.flatMap((outcome) => outcome.value?.quarters ?? []),
  }
  const recordCount = filed.annual.length + filed.quarters.length

  await scope.deps.marketDataStore.upsertAccounts(filed, request.signal)
  invalidateWhenWritten(scope, recordCount)

  return toKindResult({
    kind: 'accounts',
    successStatus: 'upserted',
    outcomes,
    recordCount,
  })
}

/** The screened board and the book, or, where statements are one request per name and the whole
 *  board is too many, the book, the watchlist and the names the visitor looked at. */
async function wantedNames(
  scope: EvidenceScope,
  crossSection: VnMacroCrossSection
): Promise<ReadonlySet<string>> {
  const { request, deps } = scope
  const read = { now: request.now, signal: request.signal }

  if (deps.viewedInstruments !== undefined) {
    const [{ followed }, viewed] = await Promise.all([
      followedTickersIn(deps, VN_MARKET_REF, read),
      deps.viewedInstruments(read),
    ])

    return new Set([
      ...followed,
      ...viewed
        .filter((instrument) => instrument.market === VN_MARKET_REF)
        .map((instrument) => instrument.ticker),
    ])
  }

  const [cross, held] = await Promise.all([
    crossSection.get(resolveSettledDay(scope.calendar, request.now), request.signal),
    heldTickersIn(deps, VN_MARKET_REF, read),
  ])

  return new Set([
    ...cross.names.filter((name) => name.screened).map((name) => name.record.instrument.ticker),
    ...held,
  ])
}

/** A forced refresh asks again for every covered name, due or not. */
function dueTargets(input: TargetInput): readonly InstrumentRef[] {
  const { scope, stored, quarters } = input

  return scope.universe
    .filter((record) => isTarget(record, input))
    .filter((record) => scope.repairTargets?.has(record.instrument.ticker) ?? true)
    .filter(
      (record) =>
        scope.request.forced ||
        isDue(stored.get(record.instrument.ticker), quarters.get(record.instrument.ticker), scope)
    )
    .map((record) => record.instrument)
}

function isTarget(record: InstrumentRecord, input: TargetInput): boolean {
  return (
    record.status === 'active' &&
    isAccountsFetched(record) &&
    input.wanted.has(record.instrument.ticker)
  )
}

/** Years and quarters arrive in one read, so the newest fetch of either dates both. */
function isDue(
  reports: readonly AnnualAccounts[] | undefined,
  quarters: readonly QuarterlyAccounts[] | undefined,
  scope: EvidenceScope
): boolean {
  if (reports === undefined || reports.length === 0) {
    return true
  }

  const { now } = scope.request
  const settled = resolveSettledDay(scope.calendar, now)
  const lastRead = Math.max(...[...reports, ...(quarters ?? [])].map((report) => report.fetchedAt))
  const awaited = awaitedQuarter(quarters?.at(-1), settled)

  // A partial quarter is asked once per settled session: an interval from the run's start would
  // miss by the minutes yesterday's fetch took, and skip a day.
  return (
    now - lastRead >= ACCOUNTS_REFETCH_MS ||
    isFetchedBeforeFinal(reports, settled) ||
    (awaited === 'missing' && now - lastRead >= QUARTER_WATCH_REFETCH_MS) ||
    (awaited === 'partial' && resolveSettledDay(scope.calendar, lastRead) < settled)
  )
}

/** What the watched quarter still lacks: the whole report, or the primary provider's own cash flow.
 *  A bank files no corporate cash flow, so its quarter is never partial. */
function awaitedQuarter(
  newest: QuarterlyAccounts | undefined,
  day: TradingDay
): 'missing' | 'partial' | undefined {
  const watched = watchedQuarter(day)

  if (watched === undefined) {
    return undefined
  }

  if (newest === undefined || periodIndexOf(newest) < periodIndexOf(watched)) {
    return 'missing'
  }

  const awaitsCashFlow =
    !(hasCashFlow(newest.lines) || isBankLines(newest.lines)) ||
    newest.cashFlowSourceId !== undefined

  return periodIndexOf(newest) === periodIndexOf(watched) && awaitsCashFlow ? 'partial' : undefined
}

function storedReportCount(stored: ReadonlyMap<Ticker, readonly AnnualAccounts[]>): number {
  return [...stored.values()].reduce((sum, reports) => sum + reports.length, 0)
}

/** A failed fill never rejects the name's primary rows; a throw here is a bug, not a source
 *  failure, and propagates. */
async function withCashFlowFill(
  scope: EvidenceScope,
  outcome: TargetOutcome<FiledAccounts>,
  stored: readonly QuarterlyAccounts[]
): Promise<TargetOutcome<FiledAccounts>> {
  if (outcome.value === undefined) {
    return outcome
  }

  const fill = await fillCashFlow({ scope, filed: outcome.value, stored })

  return { ...outcome, value: fill.filed, caveats: [...outcome.caveats, ...fill.caveats] }
}

/** No report back is a rejected target, never a silently absent one. */
async function fetchAccounts(
  scope: EvidenceScope,
  instrument: InstrumentRef
): Promise<TargetOutcome<FiledAccounts>> {
  const result = await scope.deps.sources.resolve({
    kind: 'accounts',
    context: { market: VN_MARKET_REF, instrument },
    signal: scope.request.signal,
  })

  if (result.kind === 'unavailable') {
    return buildRejectedOutcome(instrument, reportedCaveats(result.caveats, 'accounts'))
  }

  if (result.value.annual.length === 0 && result.value.quarters.length === 0) {
    return buildRejectedOutcome(instrument, [
      ...result.caveats,
      buildPayloadRejectedCaveat(result.provenance, 'accounts'),
    ])
  }

  return {
    instrument,
    value: result.value,
    provenance: result.provenance,
    caveats: result.caveats,
  }
}
