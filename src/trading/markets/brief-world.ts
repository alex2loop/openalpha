import type { TradingDay } from '@/trading/kernel/instrument'
import type { CommodityHistory } from '@/trading/kernel/market/commodity'
import type {
  MACRO_SERIES_STALE_AFTER_DAYS,
  MacroSeriesId,
} from '@/trading/kernel/market/macro-series'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type {
  BriefReference,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { SourceResult, SourceUnavailable } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/brief-context'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { ticker } from '@/trading/kernel/instrument'
import { dedupeProvenance, provenanceOf } from '@/trading/kernel/source/source-result'
import { isStaleReading } from '@/trading/markets/brief-macro'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'
import { MACRO_COMPOSITE_REGION, mergeMacroValues } from '@/trading/markets/macro'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

const BRENT = ticker('BRENT')

/** Enough sessions back that a holiday run still leaves a point to quote. */
const BRENT_LOOKBACK_SESSIONS = 10

/** The reasons that mean this build routes no source for a read, as the web edition routes none for
 *  what a browser cannot reach; any other reason is a source that was asked and failed. */
const NOT_SERVED_REASONS: ReadonlySet<SourceUnavailable['reason']> = new Set([
  'unconfigured',
  'unsupported',
])

interface MacroReading {
  readonly value: number
  readonly at: TradingDay
}

/** One quoted figure: the row's label, the stale-table entry that ages it and the day it was
 *  observed, with the cells that state it. */
interface WorldFigure {
  readonly reference: BriefReference
  readonly series: keyof typeof MACRO_SERIES_STALE_AFTER_DAYS
  readonly at: TradingDay
  readonly cells: BriefSectionRow
}

/** The world figures a Vietnamese reader checks beside the macro block: the S&P 500, the US
 *  ten-year yield and Brent crude, each dated by its own observation and flagged once it is older
 *  than its series allows. They come from the macro and commodity reads; no row reads the
 *  `equity-us` market, so US stocks stay gated on the owner's US segment. A figure with no value
 *  adds no row, and a section with no row is absent, or omitted where this build serves none of the
 *  feeds behind it. Brent states a level only: the feed names no contract, so a move across a
 *  roll would print the gap between two contracts as a day's move. */
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
  const asOf = context.macro?.view.asOf ?? request.asOf
  const rows = [...macroRows(macro, asOf), ...brentRows(brent, asOf)]
  const failures = reads.filter((read) => read.kind === 'unavailable')
  const caveats = dedupeCaveats(failures.flatMap((failure) => failure.caveats))

  if (rows.length > 0) {
    return ready('world-markets', rows, {
      caveats,
      provenance: dedupeProvenance([...macro.flatMap(provenanceOf), ...provenanceOf(brent)]),
    })
  }

  return failures.length > 0 && failures.every((failure) => NOT_SERVED_REASONS.has(failure.reason))
    ? omitted('world-markets')
    : absent('world-markets', caveats)
}

function macroRows(
  reads: readonly SourceResult<MacroSnapshot>[],
  asOf: TradingDay
): readonly BriefSectionRow[] {
  const merged = mergeMacroValues(reads)
  const sp500 = readingOf(merged, 'us-equity-index')
  const yield10 = readingOf(merged, 'us-10y-yield')

  return [
    ...(sp500 === undefined
      ? []
      : [
          toWorldRow(
            {
              reference: 'sp500',
              series: 'us-equity-index',
              at: sp500.at,
              cells: { level: sp500.value },
            },
            asOf
          ),
        ]),
    ...(yield10 === undefined
      ? []
      : [
          toWorldRow(
            {
              reference: 'us-10y',
              series: 'us-10y-yield',
              at: yield10.at,
              cells: { valuePct: yield10.value / PERCENT_PER_UNIT },
            },
            asOf
          ),
        ]),
  ]
}

/** A value the provider did not date cannot be quoted as a world figure. */
function readingOf(
  merged: ReturnType<typeof mergeMacroValues>,
  id: MacroSeriesId
): MacroReading | undefined {
  const value = merged.values[id]
  const at = merged.observationDates[id]

  return value === undefined || at === undefined ? undefined : { value, at }
}

/** The last point's level and day. */
function brentRows(
  read: SourceResult<CommodityHistory>,
  asOf: TradingDay
): readonly BriefSectionRow[] {
  if (read.kind === 'unavailable') {
    return []
  }

  const latest = read.value.points.at(-1)

  return latest === undefined
    ? []
    : [
        toWorldRow(
          { reference: 'brent', series: 'brent', at: latest.day, cells: { level: latest.close } },
          asOf
        ),
      ]
}

function toWorldRow(figure: WorldFigure, asOf: TradingDay): BriefSectionRow {
  const { reference, series, at, cells } = figure

  return {
    reference,
    at,
    ...cells,
    ...(isStaleReading(series, at, asOf) ? { freshness: 'stale' } : {}),
  }
}
