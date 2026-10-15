/** The measured quantities behind one factor's score, in the units an operator would look them up
 *  in. A normalized score cannot be checked against a filing; these can. */
export const FACTOR_METRIC_IDS = Object.freeze([
  'pe',
  'average-profit-pe',
  'pb',
  'earnings-growth',
  'revenue-growth',
  'value-percentile',
  'return-on-equity',
  'return-on-assets',
  'debt-to-equity',
  'gross-margin',
  'quality-percentile',
  'accounts-score',
  'return-on-invested-capital',
  'interest-cover',
  'net-debt-to-ebitda',
  'bad-debt-ratio',
  'watch-list-ratio',
  'provision-cover',
  'casa-share',
  'cost-to-income',
  'capital-adequacy',
  'net-interest-to-assets',
  'ranked-peers',
  'trend-average',
  'year-high',
  'breakout-trigger',
  'funding-daily',
  'trailing-low',
  'relative-volume',
] as const)
export type FactorMetricId = (typeof FACTOR_METRIC_IDS)[number]

/** A rank is its own unit, not a percent that happens to run 0-100: it is quantized by how many
 *  peers the sector has, so the decimals a percent prints are noise the reading never carried. A
 *  multiple is not a ratio either: a P/E is read as a number and a reading against its own baseline
 *  is read as `2,31×`, which is what keeps it from being taken for a quantity. `fraction` and
 *  `percent` print identically and differ by a hundredfold: a fraction is a 0-1 share, a percent is
 *  already percent-valued (12.5). The producer declares which it publishes; a name ending in `Pct`
 *  has already been wrong once. */
export type FactorMetricUnit =
  | 'ratio'
  | 'multiple'
  | 'fraction'
  | 'percent'
  | 'percent-rank'
  | 'count'
  | 'checks-of-nine'
  | 'currency'
  | 'price'

/** How to read each metric's value. Derived from the id rather than carried per reading: the unit
 *  is a property of the quantity, so a second copy on every row could only ever disagree. */
export const FACTOR_METRIC_UNITS = Object.freeze({
  pe: 'ratio',
  'average-profit-pe': 'ratio',
  pb: 'ratio',
  'earnings-growth': 'percent',
  'revenue-growth': 'percent',
  'value-percentile': 'percent-rank',
  'return-on-equity': 'percent',
  'return-on-assets': 'percent',
  'debt-to-equity': 'ratio',
  'gross-margin': 'percent',
  'quality-percentile': 'percent-rank',
  'accounts-score': 'checks-of-nine',
  'return-on-invested-capital': 'fraction',
  'interest-cover': 'multiple',
  'net-debt-to-ebitda': 'ratio',
  'bad-debt-ratio': 'fraction',
  'watch-list-ratio': 'fraction',
  'provision-cover': 'multiple',
  'casa-share': 'fraction',
  'cost-to-income': 'fraction',
  'capital-adequacy': 'fraction',
  'net-interest-to-assets': 'fraction',
  'ranked-peers': 'count',
  'trend-average': 'price',
  'year-high': 'price',
  'breakout-trigger': 'price',
  'funding-daily': 'percent',
  'trailing-low': 'price',
  'relative-volume': 'multiple',
} as const satisfies Readonly<Record<FactorMetricId, FactorMetricUnit>>)

export interface FactorMetric {
  readonly id: FactorMetricId
  readonly value: number
  /** Sessions the quantity was measured over, where it is a window rather than a point reading. The
   *  same title over a different span is a different number, so the label states it. */
  readonly sessions?: number
}
