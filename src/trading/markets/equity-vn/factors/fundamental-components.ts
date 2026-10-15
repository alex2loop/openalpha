// What each accounting line contributes to a fundamental rank, and how it is read off a filing.
// Separated from the ranking itself because these are readings of one company's accounts while
// `fundamental-ranks` is statistics over a population: nothing here knows what a peer looks like.

import type { FundamentalSnapshot } from '@/trading/kernel/market/market-data'

/** A snapshot states growth as a percentage; the yield it is compared against is a fraction. */
const PERCENT_SCALE = 100
/** Upper bound on the growth a price is credited with: one doubling. Past that the figure is a base
 *  effect, not a rate the market will keep paying for. */
const GROWTH_CREDIT_CAP_PCT = 100

/** Profitability, margin and fundamental trend on one axis. Return is on assets rather than equity
 *  because leverage differs thirty-fold across a market listing banks beside manufacturers, and
 *  leverage itself is a component here rather than the whole story — the solvency gate owns the
 *  level that disqualifies a name.
 *
 *  Six entries but four readings: both the profitability pair and the leverage pair are mutually
 *  exclusive, so every name produces the same count or the composite is not comparable across
 *  sectors. A fold over fewer components averages away less, so the sparse cohort lands wider than
 *  the rest and takes both tails of the board rank that follows — banks read two of these and held
 *  47% of the extremes against 16% for everyone else, on nothing but the missing lines. */
export const QUALITY_COMPONENTS: readonly RankComponent[] = Object.freeze([
  { weight: 1, select: (snapshot) => snapshot.returnOnAssetsPct },
  { weight: 1, select: grossProfitability },
  { weight: 1, select: unmarginedTurnover },
  { weight: 1, select: (snapshot) => snapshot.revenueGrowthYoyPct },
  { weight: 1, select: inverseDebtToEquity },
  { weight: 1, select: inverseAssetsToEquity },
])

/** Three yields against today's close, so no single accounting line decides the ranking: a one-off
 *  earnings print moves one component of three. Sales never go negative, which is what gives a
 *  loss-making name a value reading at all.
 *
 *  Earnings carry twice the weight of the other two: the measured VN value effect is an
 *  earnings-to-price effect, and book-to-price is the leg it beats. Both stay, because a single
 *  accounting line deciding the rank is what three components exist to prevent. */
export const VALUE_COMPONENTS: readonly RankComponent[] = Object.freeze([
  { weight: 2, select: earningsYield },
  { weight: 1, select: salesYield },
  { weight: 1, select: bookYield },
])

/** A component and its share of the composite. The weights are relative numbers — the fold
 *  renormalizes over whichever components a name actually produced. Each reads one snapshot
 *  against the close it is priced at, so a yield and a ratio share one signature and the
 *  composite needs no per-component special case. */
export interface RankComponent {
  readonly weight: number
  readonly select: (snapshot: FundamentalSnapshot, lastClose: number) => number | undefined
}

/** Gross profit per đồng of assets - the profitability leg with the longest measured record, and a
 *  different statistic from gross profit per đồng of revenue, which is what a margin reads. */
function grossProfitability(snapshot: FundamentalSnapshot): number | undefined {
  const { grossMarginPct } = snapshot
  const turnover = revenueOverAssets(snapshot)

  return grossMarginPct === undefined || turnover === undefined
    ? undefined
    : asFinite(grossMarginPct * turnover)
}

/** The same accounts one line short: an issuer booking no cost of goods files no gross margin, and
 *  what is left of the question is how much revenue its assets turn. Mutually exclusive with the
 *  leg above and ranked apart from it, because the two are different statistics - pooled into one
 *  percentile they order a name by which lines its provider happened to publish. Every name still
 *  produces exactly one of the pair, so none is scored over fewer components than its peers, and an
 *  issuer alone in its sector on this leg ranks against nobody and abstains. */
function unmarginedTurnover(snapshot: FundamentalSnapshot): number | undefined {
  return snapshot.grossMarginPct === undefined ? revenueOverAssets(snapshot) : undefined
}

/** Revenue over assets, through the DuPont identity rather than a line the provider withholds:
 *  return on assets over net margin. A loss-maker is measured, not dropped - the two carry the same
 *  sign, so their quotient is the turnover either way. Only a net margin of exactly zero has no
 *  quotient, and a non-finite result means the snapshot's lines disagree about their period. */
function revenueOverAssets(snapshot: FundamentalSnapshot): number | undefined {
  const { netMarginPct, returnOnAssetsPct } = snapshot

  if (netMarginPct === undefined || netMarginPct === 0 || returnOnAssetsPct === undefined) {
    return undefined
  }

  return asFinite(returnOnAssetsPct / netMarginPct)
}

function asFinite(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined
}

/** Leverage, negated so less of it ranks higher, and split in two like the profitability pair
 *  above: a debt-free company reads 0 on the published ratio and -1 on the DuPont one, because
 *  assets over equity is never below one. Pooled into one percentile the pair orders a name by
 *  which line its provider published, putting every DuPont reading under the 61% to 100% of each
 *  VN sector whose debt-to-equity is below one. */
function inverseDebtToEquity(snapshot: FundamentalSnapshot): number | undefined {
  const { debtToEquity } = snapshot

  return debtToEquity === undefined ? undefined : -debtToEquity
}

/** No VN source publishes a debt-to-equity ratio for a bank, so the balance sheet is read through
 *  the DuPont identity instead: assets to equity is return on equity over return on assets.
 *  Mutually exclusive with the leg above, so every name still produces exactly one of the pair. A
 *  non-positive return on assets makes the quotient meaningless rather than large. */
function inverseAssetsToEquity(snapshot: FundamentalSnapshot): number | undefined {
  const { debtToEquity, returnOnEquityPct, returnOnAssetsPct } = snapshot

  if (
    debtToEquity !== undefined ||
    returnOnEquityPct === undefined ||
    returnOnAssetsPct === undefined ||
    returnOnAssetsPct <= 0
  ) {
    return undefined
  }

  return -(returnOnEquityPct / returnOnAssetsPct)
}

/** The yield the price buys, discounted by the growth already priced in: `EY / (1 + g)`. A name
 *  growing 20% keeps five sixths of its yield; one growing nothing keeps all of it. Subtracting the
 *  growth instead charged 0.20 against yields that run 0.05-0.15, so the rank read as "slowest
 *  grower" rather than "cheapest". A loss-making name has no yield to discount.
 *
 *  Free cash flow is the truer numerator, and this read it until no VN source turned out to publish
 *  it: vndirect's ratio set carries no cash-flow code, and its statement endpoint is an
 *  undocumented numeric item taxonomy. Guessing an item code there would store the wrong number as
 *  evidence, so the factor uses the yield the source does state. */
function earningsYield(snapshot: FundamentalSnapshot, lastClose: number): number | undefined {
  const { earningsPerShare, earningsGrowthYoyPct } = snapshot

  if (
    earningsPerShare === undefined ||
    earningsPerShare <= 0 ||
    earningsGrowthYoyPct === undefined
  ) {
    return undefined
  }

  const growthPct = Math.min(Math.max(earningsGrowthYoyPct, 0), GROWTH_CREDIT_CAP_PCT)

  return earningsPerShare / lastClose / (1 + growthPct / PERCENT_SCALE)
}

/** Priced against the same close as its siblings, unlike the source's stored P/S. `priceToSales`
 *  and `marketCap` share one close, so their quotient is revenue and carries no price; over the
 *  share count it is a sales per share this can price today. */
function salesYield(snapshot: FundamentalSnapshot, lastClose: number): number | undefined {
  const { priceToSales, marketCap, sharesOutstanding } = snapshot

  if (priceToSales === undefined || priceToSales <= 0) {
    return undefined
  }
  if (marketCap === undefined || marketCap <= 0) {
    return undefined
  }
  if (sharesOutstanding === undefined || sharesOutstanding <= 0) {
    return undefined
  }

  return marketCap / priceToSales / sharesOutstanding / lastClose
}

/** Book value per share against today's close. The snapshot states the per-share figure, so
 *  unlike its two siblings there is no provider close to divide back out. */
function bookYield(snapshot: FundamentalSnapshot, lastClose: number): number | undefined {
  const { bookValuePerShare } = snapshot

  return bookValuePerShare === undefined || bookValuePerShare <= 0
    ? undefined
    : bookValuePerShare / lastClose
}
