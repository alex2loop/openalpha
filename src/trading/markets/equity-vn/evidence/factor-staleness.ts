import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorId, VnEquityFactorId } from '@/trading/kernel/factor'
import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  BarRecord,
  FlowSnapshot,
  FundamentalSnapshot,
} from '@/trading/kernel/market/market-data'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import { REFRESH_STALE_SESSIONS } from '@/trading/markets/equity-vn/policy'
import { newestFlowDay } from '@/trading/markets/equity-vn/tape/flows'

/** How far each source may sit behind the tape before the factors it feeds say so. A caveat firing
 *  inside a source's own publication cadence reports that cadence rather than the evidence: the
 *  foreign desk prints within the session, the proprietary desk only after the close, and ratios
 *  restate on the cadence they are refetched on. */
const FOREIGN_LAG_TOLERANCE_SESSIONS = 0
export const PROPRIETARY_LAG_TOLERANCE_SESSIONS = 1
const FUNDAMENTAL_LAG_TOLERANCE_SESSIONS = REFRESH_STALE_SESSIONS.fundamentals
/** An index prints with its session, as the fund tracking it does. */
const BENCHMARK_LAG_TOLERANCE_SESSIONS = 0

/** The factors priced off the fundamental snapshot rather than the tape. */
const FUNDAMENTAL_FACTOR_IDS: readonly VnEquityFactorId[] = Object.freeze([
  'quality',
  'value',
  'speculative-turnover',
])

/** The three legs staleness judges, declared here rather than imported: the evidence type lives
 *  with the factors that consume this pass, and importing it back would close a cycle. */
interface DatedEvidence {
  readonly bars: readonly BarRecord[]
  readonly flows: readonly FlowSnapshot[]
  readonly fundamental: FundamentalSnapshot | null
  /** The newest session of the index a fund is scored on: every fund factor reads that series
   *  rather than the fund's own tape. */
  readonly benchmarkAt?: TradingDay
}

/** Which of a name's factors read a source that is behind its tape: all of them, or the named ones. */
export type StaleFactors = 'all' | readonly FactorId[]

/** Every factor input, with a caveat added to each one whose own source is behind the tape. The
 *  input keeps its raw value: a lagging leg is still the best reading there is, and saying so is
 *  what lets conviction fall without the factor abstaining outright. */
export function withStaleCaveats<K extends FactorId>(
  inputs: readonly FactorInput<K>[],
  evidence: DatedEvidence,
  freshFrom: TradingDay
): readonly FactorInput<K>[] {
  const stale = staleFactorsOf(evidence, freshFrom)

  if (stale !== 'all' && stale.length === 0) {
    return inputs
  }

  return inputs.map((entry) =>
    stale === 'all' || stale.includes(entry.id)
      ? { ...entry, caveats: [...entry.caveats, staleInputCaveat(entry.id)] }
      : entry
  )
}

/** Every factor when the name's own tape is behind the session reported — nothing is current when
 *  the bars are not — or when a fund's index is behind the fund's own tape. Otherwise the factors
 *  whose own source lags that tape, each by its own publication calendar: measuring against
 *  `freshFrom` instead would let a leg ending a session before it go unreported. */
export function staleFactorsOf(evidence: DatedEvidence, freshFrom: TradingDay): StaleFactors {
  const tape = evidence.bars[evidence.bars.length - 1]?.candle.at

  if (tape === undefined) {
    return []
  }

  if (
    tape < freshFrom ||
    isLagging(evidence.benchmarkAt, evidence.bars, BENCHMARK_LAG_TOLERANCE_SESSIONS)
  ) {
    return 'all'
  }

  const stale: FactorId[] = []
  const foreignAt = newestFlowDay(evidence.flows, (flow) => flow.foreignNetValue)
  const proprietaryAt = newestFlowDay(evidence.flows, (flow) => flow.proprietaryNetValue)

  if (isLagging(foreignAt, evidence.bars, FOREIGN_LAG_TOLERANCE_SESSIONS)) {
    stale.push('foreign-flow')
  }

  if (isLagging(proprietaryAt, evidence.bars, PROPRIETARY_LAG_TOLERANCE_SESSIONS)) {
    stale.push('proprietary-flow')
  }

  if (isLagging(evidence.fundamental?.asOf, evidence.bars, FUNDAMENTAL_LAG_TOLERANCE_SESSIONS)) {
    stale.push(...FUNDAMENTAL_FACTOR_IDS)
  }

  return stale
}

/** Absent is not lagging: a source that reported nothing leaves its factor abstaining, and a
 *  staleness caveat on an abstention describes evidence never offered. Lag is counted in the name's
 *  own sessions — the stored bars are the calendar, so a halted name is not charged for days it did
 *  not trade — and a source publishing on its own cadence is not stale inside that cadence. */
function isLagging(
  at: TradingDay | undefined,
  bars: readonly BarRecord[],
  toleranceSessions: number
): boolean {
  if (at === undefined) {
    return false
  }

  return bars.filter((bar) => bar.candle.at > at).length > toleranceSessions
}

function staleInputCaveat(id: FactorId): Caveat {
  return { code: 'factor.input-stale', detail: { factor: id } }
}
