import type { FactorComposite, FactorResult } from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { Ticker } from '@/trading/kernel/instrument'
import type { PreviousClose, ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/name-evidence'
import { factorComposite } from '@/trading/kernel/factor'
import { exposureSectorOf } from '@/trading/kernel/instrument'
import { VOLATILITY_SESSIONS } from '@/trading/markets/equity-vn/policy'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'
import { nSessionReturn, realizedVolatility, sessionChange } from '@/trading/markets/timeseries'

const PERCENT_PER_UNIT = 100
/** About a trading month: the move a browsing board prints beside the price. */
const MONTH_SESSIONS = 20

export interface RankedFactors extends FactorComposite {
  readonly factors: readonly FactorResult[]
}

/** `failedGates` decides who clears the gates; this decides order. There is no second weight
 *  table: the market supplies the identical scored result the suggestion pipeline uses, so
 *  "ranked first" and "strong enough to suggest" cannot disagree about what strong means. */
interface RankOptions {
  /** A foreign account cannot buy a name with no room, so the rank is published with a caution. */
  readonly foreignOperator: boolean
}

/** The per-name reads the rank is built from, bundled so the walk stays at three parameters. */
export interface RankedEvidence {
  readonly factorsByTicker: ReadonlyMap<Ticker, RankedFactors>
  /** The plain values a board prints beside the factors. */
  readonly readingsByTicker?: ReadonlyMap<Ticker, readonly FactorMetric[]>
}

export function rankSurvivors(
  survivors: readonly NameEvidence[],
  evidence: RankedEvidence,
  options: RankOptions
): readonly ScreenCandidate[] {
  const scored = survivors.map((name) => {
    const ticker = name.record.instrument.ticker
    const scoredFactors = evidence.factorsByTicker.get(ticker)

    return {
      candidate: {
        instrument: name.record.instrument,
        composite:
          scoredFactors === undefined ? UNSCORED_COMPOSITE : factorComposite(scoredFactors),
        factors: scoredFactors?.factors ?? [],
        ...rowExtras(name, evidence.readingsByTicker?.get(ticker) ?? []),
        ...(options.foreignOperator && name.foreignRoomExhausted === true
          ? { caution: 'foreign-room-exhausted' as const }
          : {}),
      },
      turnover: name.turnover ?? 0,
    }
  })

  // Score descending, then turnover, then ticker: a total order over the population, so paging is
  // stable across reruns of the same day. A name whose window could not be measured sorts as zero
  // turnover: a tie-break needs a total order, and an unmeasured name is not the most traded one.
  return scored
    .sort(
      (a, b) =>
        b.candidate.composite.score - a.candidate.composite.score ||
        b.turnover - a.turnover ||
        a.candidate.instrument.ticker.localeCompare(b.candidate.instrument.ticker)
    )
    .map((entry) => entry.candidate)
}

/** What a row carries only when the market had it, kept out of the shape otherwise. */
function rowExtras(name: NameEvidence, metrics: readonly FactorMetric[]): Partial<ScreenCandidate> {
  const { record, closes, turnover, lockPrice, tapeReadings } = name
  const sector = exposureSectorOf(record.kind, record.sector)
  const marketCap = name.fundamental?.marketCap
  const previousClose = lastAdjustedClose(name)
  const volatilityDaily = realizedVolatility(closes, VOLATILITY_SESSIONS)
  const monthChange = nSessionReturn(closes, MONTH_SESSIONS)
  const foreignNet = name.flowReads.foreignNet?.value

  return {
    name: record.name,
    ...(sector === undefined ? {} : { sector }),
    ...(marketCap === undefined ? {} : { marketCap }),
    ...(turnover === undefined ? {} : { turnover }),
    ...(monthChange === undefined ? {} : { monthChangePct: monthChange * PERCENT_PER_UNIT }),
    ...(foreignNet === undefined ? {} : { foreignNet }),
    ...(previousClose === undefined ? {} : { previousClose }),
    ...(lockPrice === undefined ? {} : { lockPrice }),
    ...(volatilityDaily === undefined ? {} : { volatilityDaily }),
    ...(tapeReadings.length === 0
      ? {}
      : { signals: tapeReadings.map((reading) => reading.signal) }),
    ...(metrics.length === 0 ? {} : { readings: metrics }),
  }
}

/** The newest bar of the very series the factors were scored on, so the board reports the close its
 *  rank was built from rather than an unadjusted row the model never saw — and what that session
 *  moved, which the series holds and a close measured against its own live quote cannot show. */
function lastAdjustedClose(name: NameEvidence): PreviousClose | undefined {
  const { closes, lastAdjustedAt } = name
  const price = closes.at(-1)

  if (price === undefined || lastAdjustedAt === undefined) {
    return undefined
  }

  const change = sessionChange(closes)

  return {
    price,
    at: lastAdjustedAt,
    ...(change === undefined ? {} : { changePct: change * PERCENT_PER_UNIT }),
  }
}
