import type { Caveat } from '@/trading/kernel/caveat'
import type { Ticker } from '@/trading/kernel/instrument'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import { currencyCode } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import {
  US_INDEX_TICKERS,
  US_MARKET_REF,
  US_MINIMUM_UNIVERSE_SIZE,
  US_UNIVERSE_STALE_MS,
} from '@/trading/markets/equity-us/policy'

const USD = currencyCode('USD')
/** Nasdaq publishes both headline indices' levels but lists neither, so they are manifest facts. */
const INDEX_SOURCE_ID = sourceId('nasdaq')

interface RefreshUniverseOptions {
  /** Every record the market holds, delisted ones included, so a name that left can be kept as
   *  delisted rather than forgotten, and one missed once can be told from one missed twice. */
  readonly stored: readonly InstrumentRecord[]
  readonly now: number
  readonly signal: AbortSignal
}

interface UniverseRefreshOutcome {
  readonly result: RefreshKindResult
  /** The records after a successful replacement, the prior scope otherwise. */
  readonly universe: readonly InstrumentRecord[]
}

/** The whole scope is validated before anything is written. `replaceInstruments` is atomic scope
 *  replacement, so a partial universe would delist every name the provider happened to omit. */
export async function refreshUsUniverse(
  deps: MarketDeps,
  options: RefreshUniverseOptions
): Promise<UniverseRefreshOutcome> {
  const result = await deps.sources.resolve({
    kind: 'instruments',
    context: { market: US_MARKET_REF },
    signal: options.signal,
  })

  if (result.kind === 'unavailable') {
    return buildFailedAttempt(options.stored, [], reportedCaveats(result.caveats))
  }

  const fetched = result.value.filter((record) => record.status === 'active')

  if (fetched.length < US_MINIMUM_UNIVERSE_SIZE) {
    return buildFailedAttempt(options.stored, result.provenance, [
      ...result.caveats,
      { code: 'refresh.validation-failed', detail: { kind: 'instruments' } },
    ])
  }

  const records = assembleUniverse(fetched, options)

  await deps.marketDataStore.replaceInstruments({
    market: US_MARKET_REF,
    records,
    signal: options.signal,
  })

  return {
    result: {
      kind: 'instruments',
      status: 'replaced',
      targetCount: 1,
      successfulTargetCount: 1,
      missingTargets: [],
      recordCount: activeCount(records),
      provenance: result.provenance,
      caveats: result.caveats,
    },
    universe: records,
  }
}

/** Gates instrument replacement only, never the evidence cadence. A fetch instant in the future is a
 *  broken clock or a bad record, which is stale rather than permanently fresh. */
export function isUsUniverseStale(universe: readonly InstrumentRecord[], now: number): boolean {
  if (universe.length === 0) {
    return true
  }

  const newest = universe.reduce((latest, row) => Math.max(latest, row.fetchedAt), 0)
  const ageMs = now - newest

  return ageMs < 0 || ageMs > US_UNIVERSE_STALE_MS
}

export function activeCount(records: readonly InstrumentRecord[]): number {
  return records.filter((record) => record.status === 'active').length
}

/** What to report for a read that produced nothing usable: an unexplained loss gets the
 *  provider-agnostic code. */
function reportedCaveats(caveats: readonly Caveat[]): readonly Caveat[] {
  return caveats.length > 0
    ? caveats
    : [{ code: 'source.no-available-provider', detail: { sourceKind: 'instruments' } }]
}

/** An index and a stock can share a symbol (`COMP` is also a NYSE stock): the scope keys on the
 *  ticker, so the index the manifest names wins and the stock is left out. */
function assembleUniverse(
  fetched: readonly InstrumentRecord[],
  options: RefreshUniverseOptions
): readonly InstrumentRecord[] {
  const indices = new Set<Ticker>(US_INDEX_TICKERS)
  const listed = fetched.filter((record) => !indices.has(record.instrument.ticker))
  const present = new Set<Ticker>(listed.map((record) => record.instrument.ticker))
  const stocks = options.stored.filter((record) => !indices.has(record.instrument.ticker))
  const lastRead = lastListingRead(stocks)
  const absent = stocks
    .filter((record) => !present.has(record.instrument.ticker))
    .map((record) => (isFirstMiss(record, lastRead) ? record : delist(record)))

  return [...listed, ...absent, ...indexRecords(options.now)]
}

/** When the previous successful read was taken: every name it listed carries that instant. */
function lastListingRead(stocks: readonly InstrumentRecord[]): number | undefined {
  return stocks.reduce<number | undefined>(
    (latest, record) =>
      record.status === 'active' ? Math.max(latest ?? record.fetchedAt, record.fetchedAt) : latest,
    undefined
  )
}

/** The screener leaves a row out now and then, and a name marked delisted stops its bars and
 *  refuses its price until the next weekly read. A name the previous read still listed keeps its
 *  record through one miss; a second read without it delists it. */
function isFirstMiss(record: InstrumentRecord, lastRead: number | undefined): boolean {
  return record.status === 'active' && record.fetchedAt === lastRead
}

function delist(record: InstrumentRecord): InstrumentRecord {
  return { ...record, status: 'delisted' }
}

function indexRecords(fetchedAt: number): readonly InstrumentRecord[] {
  return US_INDEX_TICKERS.map((code) => ({
    instrument: { market: US_MARKET_REF, ticker: code },
    name: code,
    kind: 'index' as const,
    status: 'active' as const,
    currency: USD,
    sourceId: INDEX_SOURCE_ID,
    fetchedAt,
  }))
}

function buildFailedAttempt(
  stored: readonly InstrumentRecord[],
  provenance: readonly SourceProvenance[],
  caveats: readonly Caveat[]
): UniverseRefreshOutcome {
  return {
    result: {
      kind: 'instruments',
      status: stored.length > 0 ? 'retained' : 'unavailable',
      targetCount: 1,
      successfulTargetCount: 0,
      missingTargets: [],
      recordCount: activeCount(stored),
      provenance,
      caveats,
    },
    universe: stored,
  }
}
