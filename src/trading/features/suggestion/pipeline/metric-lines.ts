import type { Locale } from '@/core/types/locale'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { PriceDisplay } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import { FACTOR_METRIC_UNITS } from '@/trading/kernel/factor-metric'
import { formatSignedPercent } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { renderMetricLine } from '@/trading/render/metric'
import { formatPrice } from '@/trading/render/money'

const PERCENT_PER_UNIT = 100

export interface PromptMetricInput {
  readonly locale: Locale
  readonly metrics: readonly FactorMetric[] | undefined
  readonly display: PriceDisplay | undefined
  readonly referencePrice: number | undefined
}

/** A price-valued metric is stated against the price the debate is deciding at, so the persona
 *  reads "11.5% below the 240-session high" and never has to subtract two prices itself, or mistake
 *  one of them for the session count printed beside it. Every other unit prints as the operator
 *  sees it. */
export function renderPromptMetricLine(input: PromptMetricInput): string | undefined {
  const { locale, metrics, display, referencePrice } = input

  if (metrics === undefined || metrics.length === 0) {
    return undefined
  }

  const priced = metrics.filter((metric) => FACTOR_METRIC_UNITS[metric.id] === 'price')
  const plain = metrics.filter((metric) => FACTOR_METRIC_UNITS[metric.id] !== 'price')
  const parts = [
    ...priced.map((metric) => priceGapLine({ locale, metric, display, referencePrice })),
    renderMetricLine(locale, plain, display === undefined ? {} : { display }),
  ].filter((part): part is string => part !== undefined)

  return parts.length === 0 ? undefined : parts.join(INLINE_SEPARATOR)
}

interface PriceGapInput {
  readonly locale: Locale
  readonly metric: FactorMetric
  readonly display: PriceDisplay | undefined
  readonly referencePrice: number | undefined
}

function priceGapLine(input: PriceGapInput): string {
  const { locale, metric, display, referencePrice } = input
  const label = t(locale, `trading.metric.${metric.id}`, {
    sessions: metric.sessions ?? 0,
  })
  const level = formatPrice(locale, metric.value, display)

  if (referencePrice === undefined || referencePrice <= 0 || metric.value <= 0) {
    return t(locale, 'trading.prompt-metric.priceLevel', { label, level })
  }

  const gapPct = ((referencePrice - metric.value) / metric.value) * PERCENT_PER_UNIT

  return t(locale, 'trading.prompt-metric.priceGap', {
    label,
    level,
    gap: formatSignedPercent(locale, gapPct),
  })
}
