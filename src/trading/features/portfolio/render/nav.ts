import type { Locale } from '@/core/types/locale'
import type { NavHistory } from '@/trading/features/portfolio/nav/types'
import type { RenderContext } from '@/trading/render/format'
import { BRAND } from '@/core/brand'
import { formatDay, t } from '@/i18n'
import { CHART_CELLS, renderSparkline } from '@/trading/render/chart'
import {
  formatCount,
  formatFixedFraction,
  formatSignedFraction,
  formatWholeFraction,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, joinSections, renderSectionTitle } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'
import { apportion, WEIGHT_QUANTUM } from '@/trading/render/number'

function renderBenchmarkLine(locale: Locale, history: NavHistory): readonly string[] {
  const benchmark = history.benchmark

  if (benchmark === undefined) {
    return history.benchmarkGap === undefined
      ? []
      : [`${INDENT[1]}${t(locale, `trading.render.nav.benchmarkGap.${history.benchmarkGap}`)}`]
  }

  const weights = apportion(
    benchmark.legs.map((leg) => leg.weight),
    WEIGHT_QUANTUM
  )
  const legs = benchmark.legs
    .map(
      (leg, index) =>
        `${leg.instrument?.ticker ?? t(locale, 'trading.render.nav.cashLeg')} ${formatWholeFraction(locale, weights[index] ?? leg.weight)}`
    )
    .join(INLINE_SEPARATOR)

  return [
    `${INDENT[1]}${t(locale, 'trading.render.nav.benchmark', {
      legs,
      change: formatSignedFraction(locale, benchmark.periodReturn),
    })}`,
  ]
}

function renderThin(locale: Locale, history: NavHistory): string {
  if (history.firstDay === undefined) {
    return t(locale, 'trading.render.nav.none', { brand: BRAND.display })
  }

  const from = formatDay(locale, history.firstDay)

  return history.recordedCount < 2
    ? t(locale, 'trading.render.nav.thin', { from })
    : t(locale, 'trading.render.nav.sparse', { from })
}

export function renderNavText(locale: Locale, history: NavHistory, context: RenderContext): string {
  const first = history.points[0]
  const last = history.points.at(-1)

  if (first === undefined || last === undefined || history.points.length < 2) {
    return renderThin(locale, history)
  }

  const window = t(locale, `trading.render.nav.window.${history.window}`)
  const spark = renderSparkline(
    history.points.map((point) => point.index),
    CHART_CELLS.line,
    context
  )

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.portfolio, t(locale, 'trading.render.nav.heading')),
      `${INDENT[1]}${t(locale, 'trading.render.nav.now', {
        nav: formatMoney(locale, last.navBase, history.baseCurrency),
      })}`,
      `${INDENT[1]}${t(locale, 'trading.render.nav.return', {
        window,
        change: formatSignedFraction(locale, history.periodReturn ?? 0),
      })}`,
      ...renderBenchmarkLine(locale, history),
      `${INDENT[1]}${t(locale, 'trading.render.nav.drawdown', {
        deepest: formatFixedFraction(locale, history.maximumDrawdown ?? 0),
        current: formatFixedFraction(locale, history.currentDrawdown ?? 0),
      })}`,
      ...(spark === undefined ? [] : [`${INDENT[1]}${spark}`]),
      `${INDENT[1]}${t(locale, 'trading.render.nav.points', {
        count: formatCount(locale, history.points.length),
        from: formatDay(locale, first.day),
        to: formatDay(locale, last.day),
      })}`,
    ],
  ])
}
