import type { Caveat } from '@/trading/kernel/caveat'
import type { VnEtfFactorId } from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { Ticker } from '@/trading/kernel/instrument'
import type { BarRecord, Candle } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import {
  ETF_BENCHMARK_BY_TICKER,
  MOMENTUM_SESSIONS,
  TREND_SESSIONS,
  TREND_SLOPE_SESSIONS,
  VOLATILITY_SESSIONS,
  WIDE_TRACKING_ERROR,
} from '@/trading/markets/equity-vn/policy'
import { adjustedCandles } from '@/trading/markets/equity-vn/screen'
import { alignedCloses, nSessionReturn, trendWithSlope } from '@/trading/markets/timeseries'

interface EtfEvidence {
  /** The index the fund replicates. Absent where no stored series serves it, and then both factors
   *  abstain: a fund measured against an index it does not track scores a number that describes
   *  nothing about the fund. */
  readonly benchmarkCloses?: readonly number[]
  /** Daily-return dispersion against the fund's own benchmark, as a fraction. Not scored — it reads
   *  the wrapper rather than the basket — but stated as a cost once it runs wide. */
  readonly trackingError?: number
  readonly provenance: readonly SourceProvenance[]
}

/** The funds a tracking-error pass measures. Declared here rather than imported: the cross-section
 *  that supplies them already imports this module, and importing its type back would close a
 *  cycle. */
interface BenchmarkedFund {
  readonly record: { readonly instrument: { readonly ticker: Ticker } }
  readonly bars: readonly BarRecord[]
}

/** ETFs declare their own factors. Running one through the stock policy would leave `quality` and
 *  `value` permanently absent, capping coverage at 0.75 and suppressing ETF conviction for a reason
 *  that has nothing to do with the ETF.
 *
 *  Both read the benchmark, because the benchmark is the whole of what a tracker returns. The
 *  wrapper's own dispersion rides on `index-trend` as a caveat rather than scoring: it is the leg
 *  the dispersion is measured against, and a cost the buyer pays is not a reading of the market. */
export function etfFactorInputs(evidence: EtfEvidence): readonly FactorInput<VnEtfFactorId>[] {
  const { provenance, benchmarkCloses } = evidence

  return [
    // An ETF's trend is its benchmark's trend — the same statistic the stock `trend` factor computes.
    {
      ...input('index-trend', benchmarkTrend(benchmarkCloses), { provenance }),
      caveats: trackingCaveats(evidence.trackingError),
    },
    input('index-momentum', benchmarkMomentum(benchmarkCloses), { provenance }),
  ]
}

/** What a wide-tracking wrapper costs, stated once on the fund's own suggestion. Silent below the
 *  bound: every tracker drifts from its basket, and only the drift a buyer pays for is worth a line. */
function trackingCaveats(dispersion: number | undefined): readonly Caveat[] {
  return dispersion === undefined || dispersion < WIDE_TRACKING_ERROR
    ? []
    : [{ code: 'suggestion.tracking-error-wide', detail: { drift: dispersion } }]
}

/** Every fund's dispersion against the index it declares, keyed by ticker. A fund with no declared
 *  benchmark, no stored index series, or too short an overlap is absent rather than zero. */
export function etfTrackingErrors(
  funds: readonly BenchmarkedFund[],
  benchmarks: ReadonlyMap<Ticker, readonly Candle[]>
): ReadonlyMap<Ticker, number> {
  const errors = new Map<Ticker, number>()

  for (const fund of funds) {
    const key = fund.record.instrument.ticker
    const benchmark = benchmarkCandles(key, benchmarks)
    const error =
      benchmark === undefined ? undefined : trackingError(adjustedCandles(fund.bars), benchmark)

    if (error !== undefined) {
      errors.set(key, error)
    }
  }

  return errors
}

/** The stored series a fund is measured against, or nothing: a fund with no declared benchmark, or
 *  one whose index has no bars yet, abstains rather than being measured against VN-Index. */
export function benchmarkCandles(
  fund: Ticker,
  benchmarks: ReadonlyMap<Ticker, readonly Candle[]>
): readonly Candle[] | undefined {
  const index = ETF_BENCHMARK_BY_TICKER.get(fund)

  return index === undefined ? undefined : benchmarks.get(index)
}

function benchmarkTrend(closes: readonly number[] | undefined): number | undefined {
  return closes === undefined
    ? undefined
    : trendWithSlope(closes, TREND_SESSIONS, TREND_SLOPE_SESSIONS)
}

function benchmarkMomentum(closes: readonly number[] | undefined): number | undefined {
  return closes === undefined ? undefined : nSessionReturn(closes, MOMENTUM_SESSIONS)
}

/** Daily return dispersion between the fund and the index it tracks, paired by trading day rather
 *  than array position — a fund session the index skipped (or the reverse) would otherwise shift
 *  every later pairing and read as tracking noise. Absent when the aligned overlap is too short to
 *  pair — a tracking error computed over three days is noise wearing a number. */
function trackingError(fund: readonly Candle[], index: readonly Candle[]): number | undefined {
  const aligned = alignedCloses(fund, index)

  if (aligned.a.length < VOLATILITY_SESSIONS + 1) {
    return undefined
  }

  const fundCloses = aligned.a.slice(-(VOLATILITY_SESSIONS + 1))
  const indexCloses = aligned.b.slice(-(VOLATILITY_SESSIONS + 1))
  const differences: number[] = []

  for (let position = 1; position < fundCloses.length; position += 1) {
    const fundBefore = fundCloses[position - 1]
    const fundNow = fundCloses[position]
    const indexBefore = indexCloses[position - 1]
    const indexNow = indexCloses[position]

    if (
      fundBefore === undefined ||
      fundNow === undefined ||
      indexBefore === undefined ||
      indexNow === undefined
    ) {
      return undefined
    }

    differences.push(fundNow / fundBefore - indexNow / indexBefore)
  }

  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length
  const variance =
    differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / differences.length

  return Math.sqrt(variance)
}

function input(
  id: VnEtfFactorId,
  raw: number | undefined,
  measured: {
    readonly provenance: readonly SourceProvenance[]
    readonly metrics?: readonly FactorMetric[]
  }
): FactorInput<VnEtfFactorId> {
  const metrics = measured.metrics ?? []

  return {
    id,
    ...(raw === undefined ? {} : { raw }),
    ...(metrics.length === 0 ? {} : { metrics }),
    provenance: measured.provenance,
    caveats: [],
  }
}
