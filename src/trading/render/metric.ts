import type { Locale } from '@/core/types/locale'
import type { FactorMetric, FactorMetricUnit } from '@/trading/kernel/factor-metric'
import type { QuotedIn } from '@/trading/render/money'
import { t } from '@/i18n'
import { FACTOR_METRIC_IDS, FACTOR_METRIC_UNITS } from '@/trading/kernel/factor-metric'
import {
  formatCount,
  formatFraction,
  formatMultiple,
  formatPercent,
  formatPercentRank,
  formatRatio,
  formatSignedPercent,
  renderDeclaredValue,
} from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { formatFlowIn, formatPriceIn, formatSignedFlowIn } from '@/trading/render/money'

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
  'signed-percent': formatSignedPercent,
  'percent-rank': formatPercentRank,
  count: formatCount,
  'checks-of-nine': (locale, value) => `${formatCount(locale, value)}/${ACCOUNTS_CHECK_COUNT}`,
  currency: (locale, value, quote) => formatFlowIn(locale, value, quote?.currency),
  'signed-currency': (locale, value, quote) => formatSignedFlowIn(locale, value, quote?.currency),
  price: (locale, value, quote) => formatPriceIn(locale, value, quote),
})

/** The quantities behind a rank, in the units they are published in. A normalized score cannot be
 *  checked against a filing; these can, which is the whole reason they travel. */
export function renderMetricLine(
  locale: Locale,
  metrics: readonly FactorMetric[] | undefined,
  options: MetricLineOptions = {}
): string | undefined {
  const facts = metricFacts(locale, metrics, options)

  return facts.length === 0 ? undefined : facts.join(options.separator ?? INLINE_SEPARATOR)
}

/** One name's readings have the page to themselves; a board's are read down a column, where the
 *  prose buries the number and every row restates the same window. */
type MetricLabelWidth = 'full' | 'short'

interface MetricFactOptions {
  readonly quote?: Partial<QuotedIn>
  readonly labels?: MetricLabelWidth
  /** Each reading once, in a fixed order: the same metric can back two factors, and two names are
   *  only comparable when their numbers line up. A reading is identified by its window as well as
   *  its id - the trailing high over 20 sessions is the breakout trigger and the one over 200 is
   *  how far the name sits off its year, and keying on the id alone let whichever factor came last
   *  silently replace the other. Ordered by id, then by window. */
  readonly canonical?: true
  /** Each reading as `Label: value` with the label capitalised, for a surface that lists them down
   *  the page where the others pack them across it. */
  readonly row?: true
  /** Leave out the readings that place the name among its peers: a surface that prints the place
   *  itself would state it twice. */
  readonly withoutRanks?: true
}

/** How a line of readings is written: the options a fact takes, and what the facts are joined with. */
type MetricLineOptions = Omit<MetricFactOptions, 'row'> & { readonly separator?: string }

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

  const ordered = options.canonical === true ? canonicalReadings(metrics) : metrics
  const readings =
    options.withoutRanks === true
      ? ordered.filter((metric) => FACTOR_METRIC_UNITS[metric.id] !== 'percent-rank')
      : ordered

  return readings.map((metric) => {
    const label = metricLabel(locale, metric, options.labels ?? 'full')
    const value = formatMetric(locale, metric, options.quote)

    return options.row === true
      ? t(locale, 'trading.render.metric.row', {
          label: `${label.charAt(0).toUpperCase()}${label.slice(1)}`,
          value,
        })
      : `${label} ${value}`
  })
}

function canonicalReadings(metrics: readonly FactorMetric[]): readonly FactorMetric[] {
  const byReading = new Map(
    metrics.map((metric) => [`${metric.id}:${metric.sessions ?? ''}`, metric])
  )
  const readings = [...byReading.values()]

  return FACTOR_METRIC_IDS.flatMap((id) =>
    readings
      .filter((metric) => metric.id === id)
      .toSorted((left, right) => (left.sessions ?? 0) - (right.sessions ?? 0))
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
