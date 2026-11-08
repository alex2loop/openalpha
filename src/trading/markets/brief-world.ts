import type { TradingDay } from '@/trading/kernel/instrument'
import type { CommodityHistory } from '@/trading/kernel/market/commodity'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { SourceResult, SourceUnavailable } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/brief-context'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { ticker } from '@/trading/kernel/instrument'
import { dedupeProvenance, provenanceOf } from '@/trading/kernel/source/source-result'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'
import { MACRO_COMPOSITE_REGION, mergeMacroValues } from '@/trading/markets/macro'
import { dayChangePct, PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

const BRENT = ticker('BRENT')

/** Enough sessions back that a holiday run still leaves two points for the move. */
const BRENT_LOOKBACK_SESSIONS = 10

/** The reasons that say this build routes no source for a read, as the web edition routes none for
 *  what a browser cannot reach, where every other reason is a source that was asked and failed. */
const NOT_SERVED_REASONS: ReadonlySet<SourceUnavailable['reason']> = new Set([
  'unconfigured',
  'unsupported',
])

interface MacroReading {
  readonly value: number
  readonly at: TradingDay
}

/** The overnight figures a Vietnamese reader checks beside the macro block: the S&P 500, the US
 *  ten-year yield and Brent crude, each dated by its own observation. They come from the macro and
 *  commodity reads; no row reads the `equity-us` market, so US stocks stay gated on the owner's
 *  US segment. A figure with no value adds no row, and a section with no row is absent, or omitted
 *  where this build serves none of the feeds behind it. */
export async function buildWorldMarkets(context: BriefContext): Promise<BriefSectionResult> {
  const { deps, calendar, request } = context
  const [macro, brent] = await Promise.all([
    deps.macro.get(MACRO_COMPOSITE_REGION, request.asOf, request.signal),
    deps.sources.resolve({
      kind: 'commodityPrices',
      context: {
        ticker: BRENT,
        fromDay: calendar.addTradingDays(request.asOf, -BRENT_LOOKBACK_SESSIONS),
      },
      signal: request.signal,
    }),
  ])
  const reads = [...macro, brent]
  const rows = [...macroRows(macro), ...brentRows(brent)]
  const failures = reads.filter((read) => read.kind === 'unavailable')
  const caveats = dedupeCaveats(failures.flatMap((failure) => failure.caveats))

  if (rows.length > 0) {
    return ready('world-markets', rows, {
      caveats,
      provenance: dedupeProvenance([...macro.flatMap(provenanceOf), ...provenanceOf(brent)]),
    })
  }

  return failures.every((failure) => NOT_SERVED_REASONS.has(failure.reason))
    ? omitted('world-markets')
    : absent('world-markets', caveats)
}

function macroRows(reads: readonly SourceResult<MacroSnapshot>[]): readonly BriefSectionRow[] {
  const merged = mergeMacroValues(reads)
  const sp500 = readingOf(merged, 'us-equity-index')
  const yield10 = readingOf(merged, 'us-10y-yield')

  return [
    ...(sp500 === undefined ? [] : [{ reference: 'sp500', at: sp500.at, level: sp500.value }]),
    ...(yield10 === undefined
      ? []
      : [{ reference: 'us-10y', at: yield10.at, valuePct: yield10.value / PERCENT_PER_UNIT }]),
  ]
}

/** A value the provider did not date cannot be quoted as an overnight figure. */
function readingOf(
  merged: ReturnType<typeof mergeMacroValues>,
  id: MacroSeriesId
): MacroReading | undefined {
  const value = merged.values[id]
  const at = merged.observationDates[id]

  return value === undefined || at === undefined ? undefined : { value, at }
}

/** The last point and its move against the one before; a single point states no move. */
function brentRows(read: SourceResult<CommodityHistory>): readonly BriefSectionRow[] {
  if (read.kind === 'unavailable') {
    return []
  }

  const { points } = read.value
  const latest = points.at(-1)

  if (latest === undefined) {
    return []
  }

  const changePct = dayChangePct(latest.close, points.at(-2)?.close)

  return [
    {
      reference: 'brent',
      at: latest.day,
      level: latest.close,
      ...(changePct === undefined ? {} : { changePct }),
    },
  ]
}
