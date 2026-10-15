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
}

/** Every factor input, with a caveat added to each one whose own source is behind the tape. The
 *  input keeps its raw value: a lagging leg is still the best reading there is, and saying so is
 *  what lets conviction fall without the factor abstaining outright. */
export function withStaleCaveats<K extends FactorId>(
  inputs: readonly FactorInput<K>[],
  evidence: DatedEvidence,
  freshFrom: TradingDay
): readonly FactorInput<K>[] {
  const stale = staleFactorIds(inputs, evidence, freshFrom)

  if (stale.size === 0) {
    return inputs
  }

  return inputs.map((entry) =>
    stale.has(entry.id)
      ? { ...entry, caveats: [...entry.caveats, staleInputCaveat(entry.id)] }
      : entry
  )
}

/** Every factor when the name's own tape is behind the session reported — nothing is current when
 *  the bars are not. Otherwise the factors whose own source lags that tape, each by its own
 *  publication calendar: measuring against `freshFrom` instead would let a leg ending a session
 *  before it go unreported. */
function staleFactorIds<K extends FactorId>(
  inputs: readonly FactorInput<K>[],
  evidence: DatedEvidence,
  freshFrom: TradingDay
): ReadonlySet<FactorId> {
  const tape = evidence.bars[evidence.bars.length - 1]?.candle.at
  const stale = new Set<FactorId>()

  if (tape === undefined) {
    return stale
  }

  if (tape < freshFrom) {
    for (const entry of inputs) {
      stale.add(entry.id)
    }

    return stale
  }

  const foreignAt = newestFlowDay(evidence.flows, (flow) => flow.foreignNetValue)
  const proprietaryAt = newestFlowDay(evidence.flows, (flow) => flow.proprietaryNetValue)

  if (isLagging(foreignAt, evidence.bars, FOREIGN_LAG_TOLERANCE_SESSIONS)) {
    stale.add('foreign-flow')
  }

  if (isLagging(proprietaryAt, evidence.bars, PROPRIETARY_LAG_TOLERANCE_SESSIONS)) {
    stale.add('proprietary-flow')
  }

  if (isLagging(evidence.fundamental?.asOf, evidence.bars, FUNDAMENTAL_LAG_TOLERANCE_SESSIONS)) {
    for (const id of FUNDAMENTAL_FACTOR_IDS) {
      stale.add(id)
    }
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
