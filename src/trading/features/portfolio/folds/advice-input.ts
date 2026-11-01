import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { RebalancePolicy } from '@/trading/features/portfolio/folds/policy'
import type { PortfolioAssessment, ValuedBook } from '@/trading/features/portfolio/types'
import type { EvidenceReduceReasonCode } from '@/trading/kernel/caveat'
import type { MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import type { UserProfile } from '@/trading/kernel/operator/profile'

export interface AdviceInput {
  readonly profile: UserProfile
  readonly valued: ValuedBook
  readonly assessment: PortfolioAssessment
  readonly candidates: readonly PortfolioCandidate[]
  readonly rebalancePolicy: RebalancePolicy
  /** The macro ceiling on deployment, per segment. Clamped to at most 1 before use: macro may reduce
   *  deployment, never license more risk. */
  readonly regimes: ReadonlyMap<PortfolioSegment, RegimeScale>
  /** Held names the newest verdict says to sell on evidence, keyed by `buildInstrumentKey`. A name
   *  here takes no increase, however far under target it sits. Required, not optional: an omitted
   *  map would open every name a verdict had closed, and silently. */
  readonly standingReduces: ReadonlyMap<string, EvidenceReduceReasonCode>
  /** Available cash each market's tradable venues hold, keyed by market. A segment whose market is
   *  absent here is one the operator trades by hand, so its budget is not bounded by cash at all. */
  readonly reachableCashBase: ReadonlyMap<MarketRef, number>
  /** What a buy draws from cash per unit of its value, the fee on top. */
  buyCashMultiple(market: MarketRef): number
  /** False when no profile has been stored, so `profile` is the seeded default. */
  readonly profileSaved: boolean
}
