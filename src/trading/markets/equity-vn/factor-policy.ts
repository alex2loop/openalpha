import type {
  FactorNormalization,
  FactorPolicy,
  VnEquityFactorId,
  VnEtfFactorId,
} from '@/trading/kernel/factor'
import { BANK_SECTOR } from '@/trading/markets/equity-vn/policy'
import {
  DEFAULT_MINIMUM_COVERAGE_FRACTION,
  RANK_HIGHER_IS_BULLISH,
  RANK_LOWER_IS_BULLISH,
} from '@/trading/markets/factor-scoring'

const LINEAR = (bearishAt: number, bullishAt: number): FactorNormalization =>
  Object.freeze({ kind: 'linear', bearishAt, bullishAt })

/** One weighting per market. Screen ranking and the suggestion pipeline both score through this
 *  table, so neither can rate a name on evidence the other did not see. They cut it at different
 *  points and are meant to: a screen rating reads the conviction band, while a draft only asks
 *  whether the composite is distinguishable from neutral, which is `BULLISH_DRAFT_RATIO` of it. A
 *  name between the two reads `hold` on the board and still drafts a buy.
 *
 *  A ranked field normalizes across the screened board, because that is the population the score is
 *  read against. Over the whole stored universe every survivor lands in one corner of the scale,
 *  since a gate admits one end of what the rank spans: the board turns over four times what the
 *  rest of the market does, which `speculative-turnover` read as a bearish tilt on all of it, and
 *  0,9% of the board could draft a buy. That population is stable enough to rank over — 100 to 113
 *  names across 20 sessions, mostly the same ones — and a rejected name ranks against it too, so
 *  asking about one by ticker answers against the board rather than abstaining.
 *
 *  A linear bound is a winsorization limit, not a scale: it exists to stop one outlier dominating,
 *  so it sits near the 1st and 99th percentile of the screened population and clips a few names.
 *  Bounds an ordinary name reaches quantize the factor instead — every leader reads +1.00 and the
 *  weight stops separating anyone. Measured over the full stored history on 2026-09-21, each bound
 *  below clips under 2%; `high-proximity` states its own exception. A bound fitted to a handful of
 *  sessions is fitted to a regime, not to the board — `trend`'s own dispersion moves eightfold
 *  across a year — so re-measure over the whole series before changing one.
 *
 *  A benchmark-relative return is deliberately absent: subtracting one index figure from every
 *  name's own return shifts the whole board by a constant and cannot change its order, which is
 *  what `trend` already measures — the only price-path factor here read against a name's own
 *  history.
 *
 *  Four legs were removed rather than retuned, so do not re-add any. `momentum` went because the
 *  published VN four-factor model builds on size, earnings-to-price and twelve-month turnover in
 *  place of the Carhart leg, reporting momentum with very little effect in this market, and because
 *  `trend` reads the same recent path — the two agreed on 81.9% of signs over 40 sampled sessions,
 *  which is ~110 names re-counted rather than 4404 independent ones.
 *
 *  `liquidity` went because it was scored for tradeability, which the turnover gate and the sizing
 *  ceiling already enforce, while it paid for that twice over as a return factor: on the screened
 *  board it read 0,72 correlated with log capitalisation, and the same published model finds a
 *  turnover leg subsumes a separate liquidity one entirely. The VN evidence on the sign is split —
 *  several local studies find liquid names earning more — so this is the better-identified reading
 *  taken over the older one, not a settled fact.
 *
 *  `size` and `sector-strength` went on the 75 weekly boards from 2025-01 to 2026-07 that
 *  `scripts/research-vn-factor-history.ts` seeds: both ranked backwards in both halves (rank IC
 *  -0.19 and -0.12), and the composite ranked better without each. `size` ran in one regime that
 *  large caps led, so it is dropped rather than flipped. A removed weight goes nowhere: the
 *  composite divides by the fired total.
 *
 *  `quality` is read at weight 0. On the same boards, each quarter dated from its first filing, it
 *  ranked -0.04 and the composite rose from 0.07 to 0.11 without it. It stays for the accounts read:
 *  the profit and health lines, the Piotroski and Beneish flags, the theme shortlist, and a long
 *  holding's thesis sale where no annual report scores. */
export const VN_FACTOR_POLICY: FactorPolicy<VnEquityFactorId> = Object.freeze({
  weights: Object.freeze({
    trend: 0.15,
    quality: 0,
    value: 0.15,
    // The fourth leg of the measured VN model, and the one that explained most of its anomalies.
    // Ranked inside size groups, never across the board: the published leg carries its alpha only
    // under a size-neutral sort, and an unconditional one has the size effect cancel it out.
    'speculative-turnover': 0.15,
    'foreign-flow': 0.1,
    'proprietary-flow': 0.05,
    // Anchoring: names near their 52-week high drift further on good news; documented in the VN
    // anomaly set.
    'high-proximity': 0.1,
  }),
  normalization: Object.freeze({
    trend: LINEAR(-0.2, 0.2),
    quality: RANK_HIGHER_IS_BULLISH,
    value: RANK_HIGHER_IS_BULLISH,
    'speculative-turnover': RANK_LOWER_IS_BULLISH,
    'foreign-flow': LINEAR(-0.3, 0.3),
    // A third of the foreign bound beside it, though both read a net over the same turnover: a
    // proprietary desk works a fraction of the size a foreign one does. Sharing the wider bound
    // spent 17% of the scale and the factor separated nobody.
    'proprietary-flow': LINEAR(-0.09, 0.09),
    // The board's own 5th percentile, and the one bound here that clips more than a few percent:
    // 8,6% of names sit under 45% of their 52-week high, and a bound deep enough to separate them
    // would spend the scale on drawdowns. At 0.75 it pinned 48% at -1.00 and separated nobody.
    'high-proximity': LINEAR(0.45, 1),
  }),
  minimumCoverageFraction: DEFAULT_MINIMUM_COVERAGE_FRACTION,
  // Fitted with the cut points below, for a fifth of the board contested.
  minimumAgreement: 0.58,
  // Pooled p75 / p95 of |composite| over the same 75 weekly boards. Refit after touching weights or
  // gates.
  mediumConvictionAt: 0.26,
  highConvictionAt: 0.44,
})

/** ETFs declare their own factors. Scoring one through the stock policy would leave quality and
 *  value permanently absent, capping coverage at 0.75 and suppressing ETF conviction for a reason
 *  that has nothing to do with the ETF.
 *
 *  Every bound here is absolute: a VN fund board is two dozen names of which most never trade, so a
 *  percentile of that population spends the scale separating names no order can reach.
 *
 *  Both legs read the index, because the index is the whole of what a tracker returns. Two wrapper
 *  legs were removed rather than retuned on 2026-09-22, so do not re-add either. `liquidity` was
 *  already charged twice by the turnover gate and the sizing ceiling, and pinned 17 of 19 funds at
 *  -1.00. `tracking-error` measured the wrapper rather than the basket: it ranked 0.675 against
 *  `liquidity` beside it, and it gave two funds on one index opposite verdicts — +0.11 against
 *  -0.26 on the same VN30 — which is a verdict on how thinly a wrapper trades wearing a verdict on
 *  the market. It is still measured, and `WIDE_TRACKING_ERROR` states it as a cost on the
 *  suggestion. Refitting it to a 60-session window was measured too and is worse: the refit hands
 *  most funds a positive offset that overrides a falling index. */
export const ETF_FACTOR_POLICY: FactorPolicy<VnEtfFactorId> = Object.freeze({
  weights: Object.freeze({
    'index-trend': 0.3,
    'index-momentum': 0.3,
  }),
  normalization: Object.freeze({
    'index-trend': LINEAR(-0.1, 0.1),
    // Symmetric, so an index going nowhere scores nothing. The bearish anchor is this board's
    // measured 1st percentile of the 60-session return, and its mirror clips nothing above.
    'index-momentum': LINEAR(-0.15, 0.15),
  }),
  minimumCoverageFraction: DEFAULT_MINIMUM_COVERAGE_FRACTION,
  // Fitted, not defaulted, and high because a two-leg composite's agreement is bimodal: it reads
  // exactly 1.00 whenever both legs share a sign, so the bar only ever separates the readings where
  // the 50-session trend and the 60-session return actually conflict. At the shared default it
  // called 4.6% of the low band contested against the 20% that band is designed to hold.
  minimumAgreement: 0.9,
  // Fitted on the benchmarks rather than on a board of funds, because after the wrapper legs came
  // off the composite is a function of the index alone: every fund tracking one index scores the
  // same number, so a cross-section of 19 names carries 8 distinct values and cannot resolve a 5%
  // top band. The population is each index's own history — 1616 scored index-sessions across 9
  // benchmarks, measured 2026-09-22 — which is also the right question for a tracker: how strong
  // this reading is against what this index family does, not against seven other indices today.
  //
  // The shared defaults were far too loose for that distribution. Its median strength is 0.237, so
  // a 0.18 medium bar called over half of every board medium-or-better and a 0.32 high bar named
  // roughly a quarter. These are its p75 and p95, which is the 25%/5% split the calibration targets
  // declare. Re-measure before trusting them far: one stored year is one regime, though the window's
  // two halves agree (p75 0.354 against 0.391) and no single index drives the pool (per-index p75
  // spans 0.288 to 0.505).
  mediumConvictionAt: 0.37,
  highConvictionAt: 0.59,
})

/** The annual-report reads. Piotroski's nine checks decide a long holding's thesis sale and print
 *  on the quality line; Beneish's M-score names warning signs. Neither moves a buy's conviction.
 *  Measured on this board for fiscal 2020-2024 with `immaterialIssueShare`, the weak bucket
 *  trailed the rest in four of five years; a buy gate is not yet decided. */
export const VN_ACCOUNTS_POLICY = Object.freeze({
  /** At or below this many passed checks the business reads as weakening. The practitioner cut;
   *  `scripts/research-vn-accounts-score.ts` is what moves it. */
  weakAtScore: 3,
  /** Days past the statutory deadline before a year counts as audited: the provider writes the
   *  row from the unaudited fourth quarter and updates it in place, with no flag saying which. HOSE
   *  warns an issuer fifteen days late, so a report still missing then is a late filing. */
  finalGraceDays: 15,
  /** Share issues below this fraction of start-of-year assets pass the no-new-equity check: an
   *  employee plan alone failed it in 242 of 2,702 measured name-years. */
  immaterialIssueShare: 0.01,
  /** Above this M-score the report names its warning signs. Beneish (1999)'s own cut. */
  warningSignsAtMScore: -1.78,
  /** No gross margin and no current ratio: the checks do not exist for a bank, a broker or an
   *  insurer. */
  unscoredSectors: Object.freeze([BANK_SECTOR, 'financial-services', 'insurance']),
  /** Not fetched at all: a broker's or an insurer's report carries no line anything reads. A bank
   *  is fetched for its loan book. */
  unfetchedSectors: Object.freeze(['financial-services', 'insurance']),
  /** Sectors whose report prints but does not decide a thesis sale: measured within the sector, a
   *  weak report did not trail the sector's own stocks. */
  readingOnlySectors: Object.freeze(['real-estate']),
  /** A bank's bad debt growing this much in a year is said in words: a ratio can fall on fast
   *  lending alone. Information only; 24 listed banks are too few to measure a sell rule on. */
  bankBadDebtGrowthAt: 0.1,
  /** Years the history compounds growth over and sums flows across; a run shorter than this has no
   *  trend. The cuts below are practitioner thresholds, information only: none moves conviction,
   *  gates a buy or sells. */
  trendYears: 5,
  /** Inventory growth this far above sales growth in one year is said in words. */
  inventoryGrowthGap: 0.2,
  /** Operating cash flow below this multiple of profit across the trend. */
  minimumCashConversion: 0.5,
  /** Free cash flow negative in at least this many years of the trend. */
  negativeFreeCashYears: 3,
  /** Cash raised from share issues across the trend, as a share of the base year's assets. */
  materialRaiseShare: 0.1,
  /** Cash dividends across the trend below this share of its profit are not set against free cash
   *  flow: a token payout is not what a negative free cash flow is funding. */
  materialPayoutShare: 0.25,
  /** Interest cover falling this many years running and ending under the floor below. */
  interestCoverFallingYears: 2,
  minimumInterestCover: 3,
})
