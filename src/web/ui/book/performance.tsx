import type { TradingNavResponse } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { locale, state } from '@/web/state/session'
import { formatFixedFraction, formatSignedPercent, PERCENT } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { buildDayKey } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { NavChart } from '@/web/ui/book/nav-chart'
import { PnlBlock } from '@/web/ui/book/pnl-block'
import { toYearView, type YearView } from '@/web/ui/book/year-view'
import { TrendIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The wire's windows end at a year, so the whole record is read and cut to this year on the page.
const NAV_WINDOW = 'all'
const NAV_REFRESH_MS = 600_000

/** Hiệu quả: how the book has done against the operator's target mix, as the daemon measures it,
 *  then what each holding has made. */
export function Performance() {
  const reading = useBlock(ROUTES.portfolioNav, {
    query: { window: NAV_WINDOW },
    everyMs: NAV_REFRESH_MS,
  })

  return (
    <>
      <BlockFrame
        title={tr('ui.office.book.sinceStart')}
        colour="blue"
        icon={<TrendIcon />}
        reading={reading}
        dataTo={reading.data?.points.at(-1)?.day}
      >
        {(nav) => <NavBody nav={nav} />}
      </BlockFrame>
      <PnlBlock />
    </>
  )
}

function NavBody({ nav }: { readonly nav: TradingNavResponse }) {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return null
  }

  const year = toYearView(nav, buildDayKey(Date.now(), timeZone))
  const first = year.points[0]
  const last = year.points.at(-1)

  if (first === undefined || last === undefined || year.points.length < 2) {
    return <p class="meta">{describeThinHistory(nav, first?.day)}</p>
  }

  return (
    <>
      <p>
        {tr('trading.render.nav.return', {
          window: tr('ui.office.book.yearWindow'),
          change: formatSignedPercent(toPercent(year.periodReturn)),
        })}
      </p>
      <BenchmarkLine nav={nav} year={year} />
      <p class="meta">
        {tr('trading.render.nav.drawdown', {
          deepest: formatFixedFraction(year.maximumDrawdown),
          current: formatFixedFraction(year.currentDrawdown),
        })}
      </p>
      <NavChart year={year} />
      <p class="meta">
        {tr('trading.render.nav.points', {
          count: year.points.length,
          from: formatDay(locale.value, first.day),
          to: formatDay(locale.value, last.day),
        })}
      </p>
    </>
  )
}

// A year with fewer than two points means the record has only just begun, or began this year.
function describeThinHistory(nav: TradingNavResponse, firstDay: string | undefined): string {
  const from = firstDay ?? nav.firstDay

  return from === undefined
    ? tr('trading.render.nav.none')
    : tr('trading.render.nav.thin', { from: formatDay(locale.value, from) })
}

function BenchmarkLine({
  nav,
  year,
}: {
  readonly nav: TradingNavResponse
  readonly year: YearView
}) {
  const { benchmark, benchmarkGap } = nav

  if (benchmark === undefined) {
    return benchmarkGap === 'unbenchmarked' || benchmarkGap === 'short-history' ? (
      <p class="meta">{tr(`trading.render.nav.benchmarkGap.${benchmarkGap}`)}</p>
    ) : null
  }

  const legs = benchmark.legs.map(
    (leg) =>
      `${leg.instrument?.ticker ?? tr('trading.render.nav.cashLeg')} ${formatFixedFraction(leg.weight)}`
  )

  return (
    <p>
      {tr('trading.render.nav.benchmark', {
        legs: joinInline(legs),
        change: formatSignedPercent(toPercent(year.benchmarkReturn)),
      })}
    </p>
  )
}

function toPercent(fraction: number | undefined): number | undefined {
  return fraction === undefined ? undefined : fraction * PERCENT
}
