import type {
  IndexCode,
  IndexContribution,
  IndexContributions,
  IndexContributorsReading,
} from '@/trading/kernel/market/index-reading'
import type { IndexRequest } from '@/trading/kernel/market/market-capability'
import type {
  SourceProvenance,
  SourceResult,
  SourceUnavailable,
} from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketCapabilities, TradingCalendar } from '@/trading/markets/types'
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/core/utils/time'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { ticker } from '@/trading/kernel/instrument'
import { available } from '@/trading/kernel/source/source-result'
import { isTapeServing, resolveSettledDay } from '@/trading/markets/calendar'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

/** How many names each side lists. */
const CONTRIBUTORS_PER_SIDE = 5
/** How long a list read while the session trades stands before the next request asks again. */
const LIVE_CONTRIBUTORS_TTL_MS = MS_PER_MINUTE
/** The wait behind the pacer plus the provider's one attempt; the transport's own limit ends it
 *  sooner, this only bounds a read nobody can cancel because several callers share it. */
const CONTRIBUTORS_READ_TIMEOUT_MS = 10 * MS_PER_SECOND

/** The slice of the market's day a list belongs to: which instant range one read serves, and the
 *  session it describes. */
interface ReadWindow {
  readonly key: string
  readonly asOf: IndexContributorsReading['asOf']
}

interface Slot {
  readonly key: string
  readonly reading: IndexContributorsReading
  readonly provenance: readonly SourceProvenance[]
}

/** The feed serves the session running and, once it has finished, that session's final list until
 *  the next one opens. While it trades a list is good for a minute; after the close it is read
 *  once and kept until then. Callers asking together share one read, and a read that fails answers
 *  with the last list held, or with the failure when none is. One slot per index, so nothing grows. */
export function createIndexContributors(
  deps: MarketDeps,
  calendar: TradingCalendar
): NonNullable<MarketCapabilities['indexContributors']> {
  const slots = new Map<IndexCode, Slot>()
  const read = sharedRead(deps)

  return {
    kind: 'indexContributors',
    async run(request: IndexRequest): Promise<SourceResult<IndexContributorsReading>> {
      const { index } = request
      const window = readWindow(calendar, request.now)
      const held = slots.get(index)

      if (held?.key === window.key) {
        return available(held.reading, held.provenance)
      }

      const result = await read(index)

      if (result.kind !== 'available') {
        return held === undefined ? result : lastHeld(held, result)
      }

      const slot = {
        key: window.key,
        reading: rankContributions(result.value, window.asOf),
        provenance: result.provenance,
      }

      slots.set(index, slot)

      return available(slot.reading, slot.provenance, result.caveats)
    },
  }
}

/** One read per index at a time, run under its own timeout rather than any caller's signal: it is
 *  shared, so whichever caller arrived first cancelling must not fail the rest. */
function sharedRead(
  deps: MarketDeps
): (index: IndexCode) => Promise<SourceResult<IndexContributions>> {
  const reads = new Map<IndexCode, Promise<SourceResult<IndexContributions>>>()

  return (index) => {
    const joined = reads.get(index)

    if (joined !== undefined) {
      return joined
    }

    const pass = deps.sources
      .resolve({
        kind: 'indexContributors',
        context: { market: VN_MARKET_REF, ticker: ticker(index) },
        signal: AbortSignal.timeout(CONTRIBUTORS_READ_TIMEOUT_MS),
      })
      .finally(() => reads.delete(index))

    reads.set(index, pass)

    return pass
  }
}

/** A failed read answers with the list held, said to be the last reading. */
function lastHeld(held: Slot, failed: SourceUnavailable): SourceResult<IndexContributorsReading> {
  return available(held.reading, held.provenance, [
    ...failed.caveats,
    sourcedCaveat('source.stale-cache', failed.attemptedSourceIds, {
      sourceKind: 'indexContributors',
    }),
  ])
}

/** After the tape settles the list is the session's final one, until the next open; before that it
 *  is a session in progress, dated today. */
function readWindow(calendar: TradingCalendar, now: number): ReadWindow {
  const settled = resolveSettledDay(calendar, now)

  return isTapeServing(calendar, settled, now)
    ? { key: `settled:${settled}`, asOf: settled }
    : { key: `live:${Math.floor(now / LIVE_CONTRIBUTORS_TTL_MS)}`, asOf: calendar.dayAt(now) }
}

function rankContributions(
  contributions: IndexContributions,
  asOf: IndexContributorsReading['asOf']
): IndexContributorsReading {
  const up = side(
    contributions.rows,
    (row) => row.point > 0,
    (a, b) => b.point - a.point
  )
  const down = side(
    contributions.rows,
    (row) => row.point < 0,
    (a, b) => a.point - b.point
  )

  return {
    index: contributions.index,
    asOf,
    up,
    down,
    upSum: sumOf(up),
    downSum: sumOf(down),
  }
}

function side(
  rows: readonly IndexContribution[],
  keep: (row: IndexContribution) => boolean,
  strongest: (left: IndexContribution, right: IndexContribution) => number
): readonly IndexContribution[] {
  return rows.filter(keep).sort(strongest).slice(0, CONTRIBUTORS_PER_SIDE)
}

function sumOf(rows: readonly IndexContribution[]): number {
  return rows.reduce((total, row) => total + row.point, 0)
}
