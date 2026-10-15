import type { Locale } from '@/core/types/locale'
import type { FactorMetric, FactorMetricUnit } from '@/trading/kernel/factor-metric'
import type { QuotedIn } from '@/trading/render/money'
import { FACTOR_METRIC_UNITS } from '@/trading/kernel/factor-metric'
import {
  formatCount,
  formatFraction,
  formatMultiple,
  formatPercent,
  formatPercentRank,
  formatRatio,
  renderDeclaredValue,
} from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { formatFlowIn, formatPriceIn } from '@/trading/render/money'

/** Piotroski's checks. Printed beside the passed count, because a bare "3" reads as a score out
 *  of whatever the reader guesses, and a debate persona once read it as three of three. */
const ACCOUNTS_CHECK_COUNT = 9

/** One renderer per unit rather than a chain of tests on the id: a metric's unit already decides
 *  how it reads, so adding a metric only names its unit. Every entry takes the market's quote
 *  convention even where it ignores it, so a price metric reads on the same scale as the levels
 *  beside it and a money metric carries the currency they are quoted in. */
const METRIC_FORMATTERS: Readonly<
  Record<FactorMetricUnit, (locale: Locale, value: number, quote?: Partial<QuotedIn>) => string>
> = Object.freeze({
  ratio: formatRatio,
  multiple: formatMultiple,
  fraction: formatFraction,
  percent: formatPercent,
  'percent-rank': formatPercentRank,
  count: formatCount,
  'checks-of-nine': (locale, value) => `${formatCount(locale, value)}/${ACCOUNTS_CHECK_COUNT}`,
  currency: (locale, value, quote) => formatFlowIn(locale, value, quote?.currency),
  price: (locale, value, quote) => formatPriceIn(locale, value, quote),
})

/** The quantities behind a rank, in the units they are published in. A normalized score cannot be
 *  checked against a filing; these can, which is the whole reason they travel. */
export function renderMetricLine(
  locale: Locale,
  metrics: readonly FactorMetric[] | undefined,
  quote?: Partial<QuotedIn>
): string | undefined {
  const facts = metricFacts(locale, metrics, quote === undefined ? {} : { quote })

  return facts.length === 0 ? undefined : facts.join(INLINE_SEPARATOR)
}

/** One name's readings have the page to themselves; a board's are read down a column, where the
 *  prose buries the number and every row restates the same window. */
type MetricLabelWidth = 'full' | 'short'

interface MetricFactOptions {
  readonly quote?: Partial<QuotedIn>
  readonly labels?: MetricLabelWidth
}

/** One fact per reading, for a surface that decides where they are joined. A reading never splits:
 *  its label and its number are one thing to read. */
export function metricFacts(
  locale: Locale,
  metrics: readonly FactorMetric[] | undefined,
  options: MetricFactOptions = {}
): readonly string[] {
  if (metrics === undefined) {
    return []
  }

  return metrics.map(
    (metric) =>
      `${metricLabel(locale, metric, options.labels ?? 'full')} ` +
      formatMetric(locale, metric, options.quote)
  )
}

/** A windowed metric names its span in either width — the same title over a different number of
 *  sessions is a different reading. The short form drops the prose around the span, never the span,
 *  and keeps the exclusion where a window ends before the latest close. */
function metricLabel(locale: Locale, metric: FactorMetric, width: MetricLabelWidth): string {
  const prefix = width === 'short' ? 'trading.metric-short' : 'trading.metric'

  return renderDeclaredValue(
    locale,
    `${prefix}.${metric.id}`,
    metric.sessions === undefined ? undefined : { sessions: metric.sessions }
  )
}

function formatMetric(locale: Locale, metric: FactorMetric, quote?: Partial<QuotedIn>): string {
  return formatUnitValue(
    locale,
    { unit: FACTOR_METRIC_UNITS[metric.id], value: metric.value },
    quote
  )
}

export interface UnitValue {
  readonly unit: FactorMetricUnit
  readonly value: number
}

export function formatUnitValue(
  locale: Locale,
  reading: UnitValue,
  quote?: Partial<QuotedIn>
): string {
  return METRIC_FORMATTERS[reading.unit](locale, reading.value, quote)
}
