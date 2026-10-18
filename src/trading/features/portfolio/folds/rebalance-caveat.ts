import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { RebalancePolicy } from '@/trading/features/portfolio/folds/policy'
import type { Caveat, CaveatDetail } from '@/trading/kernel/caveat'
import type { CurrencyCode, PortfolioSegment } from '@/trading/kernel/instrument'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import { FULL_DEPLOYMENT_SCALE } from '@/trading/markets/macro-risk'
import { FRACTION_QUANTUM } from '@/trading/render/number'

interface UnderfundedInput {
  /** The unfunded appetite per segment, as a fraction of NAV. Per segment because each gets its own
   *  slice of the deployable pool, so one segment running out says nothing about another. */
  readonly shortfallBySegment: ReadonlyMap<PortfolioSegment, number>
  readonly nav: number
  readonly baseCurrency: CurrencyCode
  readonly policy: RebalancePolicy
}

/** Reported in money: a share of NAV is the fold's unit, but the operator answers this one by
 *  deciding whether to move that much cash. A gap smaller than the smallest change the policy
 *  trades is rounding residue, not a shortfall they could fund. */
export function underfundedCaveats(input: UnderfundedInput): readonly Caveat[] {
  return [...input.shortfallBySegment]
    .filter(([, shortfall]) => shortfall >= input.policy.minimumChangePctNav)
    .map(([segment, shortfall]) => ({
      code: 'portfolio.increases-underfunded' as const,
      detail: {
        segment,
        shortfallBase: shortfall * input.nav,
        baseCurrency: input.baseCurrency,
      },
    }))
}

/** The name is off target by less than one tradeable lot, so the plan trades nothing and the gap
 *  survives the run. Said out loud, or the plan reports a convergence it is not making. */
export function increaseBelowMinimumCaveat(
  candidate: PortfolioCandidate,
  shortfall: number,
  minimum: number
): Caveat {
  return {
    code: 'portfolio.increase-below-minimum',
    detail: belowMinimumDetail(candidate, shortfall, minimum),
  }
}

/** Stated rather than silent: a name missing from the plan reads as one already at target, and a
 *  suppressed buy is the opposite of that. */
export function standingReduceCaveat(candidate: PortfolioCandidate): Caveat {
  return {
    code: 'portfolio.reduce-standing',
    detail: { ticker: candidate.instrument.ticker },
  }
}

export function reductionBelowMinimumCaveat(
  candidate: PortfolioCandidate,
  excess: number,
  minimum: number
): Caveat {
  return {
    code: 'portfolio.reduction-below-minimum',
    detail: belowMinimumDetail(candidate, excess, minimum),
  }
}

function belowMinimumDetail(
  candidate: PortfolioCandidate,
  gap: number,
  minimum: number
): CaveatDetail {
  return { ticker: candidate.instrument.ticker, gap, minimum }
}

/** Whether a gap survives being rendered. Below the resolution the sentence prints at, the name is
 *  at its target for every purpose the operator has, and stating a drift of `0%` reads as the plan
 *  arguing with itself. */
export function isReportableGap(gap: number): boolean {
  return gap >= FRACTION_QUANTUM
}

/** A segment the operator turned off is sized by nothing, so the ceiling its macro read would impose
 *  constrains nothing either — and a warning beside a target of zero buries the ones that bind. */
export function withRegimeCaveats(
  regimes: ReadonlyMap<PortfolioSegment, RegimeScale>,
  disabled: ReadonlySet<string>
): ReadonlyMap<PortfolioSegment, RegimeScale> {
  return new Map(
    [...regimes].map(([segment, regime]) => [
      segment,
      {
        ...regime,
        caveats: disabled.has(segment)
          ? regime.caveats
          : [...regime.caveats, ...regimeRiskCaveat(segment, regime)],
      },
    ])
  )
}

/** The ceiling a segment's macro read imposed, stated only where it bit. A scale of 1 caps nothing,
 *  and warning about a constraint that did not apply teaches the reader to skip the line that
 *  matters. The codes travel, not a rendered block: a caveat carrying prose renders in the wrong
 *  locale and buries a whole section inside a warning line. */
function regimeRiskCaveat(segment: PortfolioSegment, regime: RegimeScale): readonly Caveat[] {
  if (regime.regime === undefined || regime.scale >= FULL_DEPLOYMENT_SCALE) {
    return []
  }

  return [
    {
      code: 'portfolio.regime-risk',
      detail: {
        segment,
        regime: regime.regime,
        deployment: regime.scale,
      },
    },
  ]
}
