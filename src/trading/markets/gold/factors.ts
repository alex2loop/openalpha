import type { Caveat } from '@/trading/kernel/caveat'
import type { GoldFactorId } from '@/trading/kernel/factor'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceContext } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { EvidenceSeries } from '@/trading/markets/evidence'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import { provenanceOf } from '@/trading/kernel/source/source-result'
import { lastSettledDay } from '@/trading/markets/bars'
import { createTradingCalendar } from '@/trading/markets/calendar'
import { optionalRaw, percentileWithin, toSeries } from '@/trading/markets/evidence'
import {
  EVIDENCE_SESSIONS,
  GOLD_MARKET_REF,
  MACRO_REFERENCE_RANGES,
  RATIO_CHANGE_RANGE,
  RATIO_LOOKBACK_SESSIONS,
  SILVER_TICKER,
  TREND_LOOKBACK_SESSIONS,
  WORLD_GOLD_CALENDAR,
} from '@/trading/markets/gold/policy'
import { MACRO_COMPOSITE_REGION, mergeMacroValues } from '@/trading/markets/macro'
import { nSessionReturn, trendDistance } from '@/trading/markets/timeseries'

const WORLD_CALENDAR = createTradingCalendar(WORLD_GOLD_CALENDAR)

interface GoldEvidenceRequest {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  /** First day of the evidence window; the caller derives it from its own trading calendar, which
   *  is the only thing that knows how many calendar days `EVIDENCE_SESSIONS` sessions span. */
  readonly fromDay: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

interface GoldEvidence {
  readonly candles: readonly Candle[]
  readonly bars: EvidenceSeries<readonly Candle[]>
  readonly silver: EvidenceSeries<readonly Candle[]>
  readonly macro: EvidenceSeries<Readonly<Partial<Record<MacroSeriesId, number>>>>
  readonly caveats: readonly Caveat[]
}

/** The one evidence read both gold markets share: world bars for trend and levels, silver bars for
 *  the ratio, and the macro snapshot the remaining factors read. Source
 *  caveats pass through unchanged; nothing here rewrites or drops one. */
export async function loadGoldEvidence(
  deps: MarketDeps,
  request: GoldEvidenceRequest
): Promise<GoldEvidence> {
  const silverRef: InstrumentRef = { market: GOLD_MARKET_REF, ticker: SILVER_TICKER }
  const [bars, silver, macro] = await Promise.all([
    readBars(deps, barsContext(request.instrument, request), request.signal),
    readBars(deps, barsContext(silverRef, request), request.signal),
    deps.macro.get(MACRO_COMPOSITE_REGION, request.asOf, request.signal),
  ])
  const { values } = mergeMacroValues(macro)
  const macroValues: EvidenceSeries<Readonly<Partial<Record<MacroSeriesId, number>>>> = {
    ...(Object.keys(values).length === 0 ? {} : { value: values }),
    provenance: macro.flatMap(provenanceOf),
    caveats: macro.flatMap((read) => read.caveats),
  }

  return {
    bars,
    silver,
    macro: macroValues,
    candles: bars.value ?? [],
    caveats: [...bars.caveats, ...silver.caveats, ...macroValues.caveats],
  }
}

/** The seven world-gold inputs. Domestic gold scores these unchanged and adds `local-premium`; a
 *  factor whose input is unavailable arrives with `raw` absent, which abstains rather than zeroes. */
export function goldFactorInputs(evidence: GoldEvidence): readonly FactorInput<GoldFactorId>[] {
  const closes = evidence.candles.map((candle) => candle.close)

  return [
    macroFactor(evidence, 'real-rate', 'us-real-rate'),
    macroFactor(evidence, 'usd', 'usd-index'),
    macroFactor(evidence, 'inflation', 'us-inflation-yoy'),
    {
      id: 'gold-silver-ratio',
      ...optionalRaw(goldSilverRatioChange(evidence)),
      provenance: [...evidence.bars.provenance, ...evidence.silver.provenance],
      caveats: [],
    },
    {
      id: 'trend',
      ...optionalRaw(trendDistance(closes, TREND_LOOKBACK_SESSIONS)),
      provenance: evidence.bars.provenance,
      caveats: [],
    },
    // No completed source contract publishes central-bank or ETF net demand, so this factor
    // abstains until one does. Scoring it as zero would read as "demand is neutral".
    { id: 'official-demand', provenance: [], caveats: [] },
    {
      id: 'safe-haven',
      ...optionalRaw(evidence.macro.value?.['us-volatility']),
      provenance: evidence.macro.provenance,
      caveats: [],
    },
  ]
}

function macroFactor(
  evidence: GoldEvidence,
  id: GoldFactorId,
  series: MacroSeriesId
): FactorInput<GoldFactorId> {
  const range = MACRO_REFERENCE_RANGES[series]
  const value = evidence.macro.value?.[series]

  return {
    id,
    ...optionalRaw(
      value === undefined || range === undefined ? undefined : percentileWithin(value, range)
    ),
    provenance: evidence.macro.provenance,
    caveats: [],
  }
}

/** Ratio change over the ratio lookback, aligned day by day: an unmatched session is dropped, never
 *  carried forward, so the change never reflects a date gap. */
function goldSilverRatioChange(evidence: GoldEvidence): number | undefined {
  const silverByDay = new Map(
    (evidence.silver.value ?? []).map((candle) => [candle.at, candle.close])
  )
  const ratios: number[] = []

  for (const candle of evidence.candles) {
    const silverClose = silverByDay.get(candle.at)

    if (silverClose !== undefined && silverClose > 0 && candle.close > 0) {
      ratios.push(candle.close / silverClose)
    }
  }

  const change = nSessionReturn(ratios, RATIO_LOOKBACK_SESSIONS)

  return change === undefined ? undefined : percentileWithin(change, RATIO_CHANGE_RANGE)
}

/** Ends on the world's last settled session: COMEX trades through the operator's day, and a bar
 *  read before it settles carries a partial range and a close that is still moving. */
function barsContext(instrument: InstrumentRef, request: GoldEvidenceRequest): SourceContext {
  return {
    market: GOLD_MARKET_REF,
    instrument,
    fromDay: request.fromDay,
    toDay: lastSettledDay(request, WORLD_CALENDAR),
    limit: EVIDENCE_SESSIONS,
  }
}

async function readBars(
  deps: MarketDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<EvidenceSeries<readonly Candle[]>> {
  return toSeries(await deps.sources.resolve({ kind: 'bars', context, signal }))
}
