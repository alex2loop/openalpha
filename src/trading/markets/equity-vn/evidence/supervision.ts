import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { SupervisionLevel, SupervisionSnapshot } from '@/trading/kernel/market/supervision'
import type { MarketDeps } from '@/trading/markets/deps'
import type { VnExchange } from '@/trading/markets/equity-vn/policy'
import { flightCache } from '@/core/utils/concurrency'
import { canonicalJson, hashString } from '@/core/utils/hash'
import { severest } from '@/trading/kernel/market/supervision'
import { ADMITTED_EXCHANGES, VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { toVnExchange } from '@/trading/markets/equity-vn/tradeability'
import { CAVEAT_SUBJECT_SEPARATOR } from '@/trading/render/format'

/** Which boards this pass actually read, kept as coverage rather than as caveats: what the gap
 *  means depends on the names the caller judged, and the population is known only there. */
export interface SupervisionCoverage {
  /** Boards some provider answered for. A board absent from it was not checked at all. */
  readonly covered: ReadonlySet<VnExchange>
  /** Boards read from the exchange's own publication rather than from a redistributor. */
  readonly published: ReadonlySet<VnExchange>
}

export interface SupervisionRead {
  /** Only the supervised names. A ticker absent from it is unsupervised as far as this read can
   *  tell, which is why an unavailable read carries a caveat rather than an empty map alone. */
  readonly levels: ReadonlyMap<Ticker, SupervisionLevel>
  readonly coverage: SupervisionCoverage
  readonly caveats: readonly Caveat[]
}

interface LastGoodRead {
  readonly asOf: TradingDay
  readonly read: SupervisionRead
}

export interface SupervisionCache {
  get(asOf: TradingDay, signal: AbortSignal): Promise<SupervisionRead>
  /** Forgets every held read, not the last good one a failed read falls back to. */
  clear(): void
}

/** One live read per board day and per refresh pass: the lists change by announcement, and a
 *  whole-board pass reads them on every sweep for no new answer. `days` is the cross-section
 *  cache's own slot count, so both hold the same board days. A read that missed a board is held
 *  too, so a provider that keeps refusing is asked once per pass, not once per board; the caller
 *  gets the last good read in its place, marked as carried, or the incomplete read itself while
 *  there is none. The last good read is never older than a newer day's. */
export function supervisionCache(deps: MarketDeps, days: number): SupervisionCache {
  const reads = flightCache<SupervisionRead>(days)
  let last: LastGoodRead | undefined

  return {
    async get(asOf, signal) {
      const read = await reads.share(asOf, signal, () => loadSupervision(deps, { signal }))

      if (isCompleteRead(read)) {
        last = last === undefined || asOf >= last.asOf ? { asOf, read } : last

        return read
      }

      return last === undefined ? read : carriedRead(last)
    },
    clear: reads.clear,
  }
}

/** The providers are merged rather than failed over: they overlap on HOSE and only one carries
 *  HNX. Degradation, not a block: a provider that cannot answer leaves its board's gates open and
 *  says so, because emptying the board on an outage is a worse answer than ranking a supervised
 *  name. */
async function loadSupervision(
  deps: MarketDeps,
  options: { readonly signal: AbortSignal }
): Promise<SupervisionRead> {
  const results = await deps.sources.resolveAll({
    kind: 'supervision',
    context: { market: VN_MARKET_REF },
    signal: options.signal,
  })
  const snapshots = results.flatMap((result) => (result.kind === 'available' ? [result.value] : []))

  // A provider that could not answer is reported by the coverage the caller derives, in the terms
  // a reader needs: which board went unchecked. Naming the vendor too states one outage twice, at
  // two severities, and the log already holds the vendor.
  const caveats = results.flatMap((result) => (result.kind === 'available' ? result.caveats : []))

  return { levels: foldLevels(snapshots), coverage: coverageOf(snapshots), caveats }
}

function isCompleteRead(read: SupervisionRead): boolean {
  return ADMITTED_EXCHANGES.every((exchange) => read.coverage.covered.has(exchange))
}

/** Complete coverage, so no unchecked-board caveat repeats what the one added line already says. */
function carriedRead(last: LastGoodRead): SupervisionRead {
  return {
    ...last.read,
    caveats: [
      ...last.read.caveats,
      { code: 'source.supervision-carried', detail: { asOf: last.asOf } },
    ],
  }
}

/** What the gates read of the exchange's lists, as one string that moves when a name enters or
 *  leaves one, changes level, or a board stops being covered. A board rebuilt for the day reads
 *  the same held lists, so a screen kept under one stamp is the screen a fresh read would give. */
export function toSupervisionStamp(read: SupervisionRead): string {
  return hashString(
    canonicalJson({
      levels: [...read.levels].sort(([left], [right]) => (left < right ? -1 : 1)),
      covered: [...read.coverage.covered].sort(),
      published: [...read.coverage.published].sort(),
    })
  )
}

/** What the read missed over the boards the caller's population actually occupies. Derived per
 *  caller rather than once per pass: an ETF board is HOSE-only, and an HNX outage that touched no
 *  name it ranked is a gap in nothing. */
export function supervisionCaveats(
  coverage: SupervisionCoverage,
  population: ReadonlySet<VnExchange>
): readonly Caveat[] {
  const boards = ADMITTED_EXCHANGES.filter((exchange) => population.has(exchange))
  const unchecked = boards.filter((exchange) => !coverage.covered.has(exchange))

  if (boards.length === 0) {
    return []
  }

  // Not one of them was checked, which one line says better than naming every board in turn.
  if (unchecked.length === boards.length) {
    return [{ code: 'source.supervision-unavailable' }]
  }

  return [
    ...exchangeCaveats('source.supervision-partial', unchecked),
    ...exchangeCaveats(
      'source.supervision-unofficial',
      boards.filter(
        (exchange) => coverage.covered.has(exchange) && !coverage.published.has(exchange)
      )
    ),
  ]
}

function foldLevels(
  snapshots: readonly SupervisionSnapshot[]
): ReadonlyMap<Ticker, SupervisionLevel> {
  const levels = new Map<Ticker, SupervisionLevel>()

  for (const { records } of snapshots) {
    for (const { instrument, level } of records) {
      levels.set(instrument.ticker, severest(levels.get(instrument.ticker), level))
    }
  }

  return levels
}

function coverageOf(snapshots: readonly SupervisionSnapshot[]): SupervisionCoverage {
  return {
    covered: coveredExchanges(snapshots),
    published: coveredExchanges(snapshots.filter((snapshot) => snapshot.authoritative)),
  }
}

/** A board spelled as no admitted exchange covers nothing, so it never enters the set and can
 *  never satisfy a lookup. */
function coveredExchanges(snapshots: readonly SupervisionSnapshot[]): ReadonlySet<VnExchange> {
  return new Set(
    snapshots.flatMap((snapshot) =>
      snapshot.boards.flatMap((board) => {
        const exchange = toVnExchange(board)

        return exchange === undefined ? [] : [exchange]
      })
    )
  )
}

function exchangeCaveats(code: CaveatCode, exchanges: readonly VnExchange[]): readonly Caveat[] {
  return exchanges.length === 0
    ? []
    : [{ code, detail: { exchanges: exchanges.join(CAVEAT_SUBJECT_SEPARATOR) } }]
}
