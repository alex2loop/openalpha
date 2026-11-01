import type {
  FactorNormalization,
  FactorPolicy,
  UsEquityFactorId,
  UsEtfFactorId,
} from '@/trading/kernel/factor'
import {
  DEFAULT_HIGH_CONVICTION_AT,
  DEFAULT_MEDIUM_CONVICTION_AT,
  DEFAULT_MINIMUM_AGREEMENT,
  DEFAULT_MINIMUM_COVERAGE_FRACTION,
  RANK_HIGHER_IS_BULLISH,
  returnBand,
} from '@/trading/markets/factor-scoring'

const LINEAR = (bearishAt: number, bullishAt: number): FactorNormalization =>
  Object.freeze({ kind: 'linear', bearishAt, bullishAt })

/** One weighting per market: the screen ranking and the suggestion pipeline both score through this
 *  table, so neither can rate a name on evidence the other did not see.
 *
 *  Value and quality are ranked against the board, because that is the population a score is read
 *  against; momentum and volatility are measured against fixed bounds. A return is neutral at
 *  zero, so a name that fell the least of a falling board is not scored bullish. The four bounds
 *  sit at the board's measured 5th and 95th percentile (550 names on 2026-10-20: twelve-month
 *  return -32% and +127%, quarterly daily volatility 1.0% and 4.7%), so each clips about a twentieth
 *  of it. Re-measure over the whole board before changing one.
 *
 *  Half the weight is price-only. A name whose accounts are not available (no contact email for
 *  SEC, a foreign issuer) still scores on momentum and volatility, which is why the
 *  coverage floor is half and not the default: with it, price-only names are rated and the board
 *  says its coverage is partial; without it they would all read inconclusive. */
export const US_FACTOR_POLICY: FactorPolicy<UsEquityFactorId> = Object.freeze({
  weights: Object.freeze({
    value: 0.3,
    quality: 0.2,
    momentum: 0.3,
    volatility: 0.2,
  }),
  normalization: Object.freeze({
    value: RANK_HIGHER_IS_BULLISH,
    quality: RANK_HIGHER_IS_BULLISH,
    momentum: returnBand(-0.32, 1.27),
    volatility: LINEAR(0.047, 0.01),
  }),
  minimumCoverageFraction: 0.5,
  minimumAgreement: DEFAULT_MINIMUM_AGREEMENT,
  mediumConvictionAt: DEFAULT_MEDIUM_CONVICTION_AT,
  highConvictionAt: DEFAULT_HIGH_CONVICTION_AT,
})

/** A fund reads its own price path, which for a tracker is the index's. Every bound is absolute: a
 *  fund board is fifty names chosen to span the market, so a percentile of it would only separate
 *  one broad index from another. */
export const US_ETF_FACTOR_POLICY: FactorPolicy<UsEtfFactorId> = Object.freeze({
  weights: Object.freeze({
    'index-trend': 0.3,
    'index-momentum': 0.3,
    volatility: 0.2,
    'high-proximity': 0.2,
  }),
  normalization: Object.freeze({
    'index-trend': LINEAR(-0.1, 0.1),
    'index-momentum': returnBand(-0.1, 0.2),
    volatility: LINEAR(0.025, 0.0045),
    'high-proximity': LINEAR(0.85, 1),
  }),
  minimumCoverageFraction: DEFAULT_MINIMUM_COVERAGE_FRACTION,
  minimumAgreement: DEFAULT_MINIMUM_AGREEMENT,
  mediumConvictionAt: DEFAULT_MEDIUM_CONVICTION_AT,
  highConvictionAt: DEFAULT_HIGH_CONVICTION_AT,
})
