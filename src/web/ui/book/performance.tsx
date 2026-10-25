import type { TradingNavResponse } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { locale } from '@/web/state/session'
import { formatFixedFraction, formatSignedPercent, PERCENT } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { NavChart } from '@/web/ui/book/nav-chart'
import { PnlBlock } from '@/web/ui/book/pnl-block'
import { TrendIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The wire's windows end at a year; the whole record is the nearest to "since the start".
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
  const first = nav.points[0]
  const last = nav.points.at(-1)

  if (first === undefined || last === undefined || nav.points.length < 2) {
    return <p class="meta">{describeThinHistory(nav)}</p>
  }

  return (
    <>
      <p>
        {tr('trading.render.nav.return', {
          window: tr('trading.render.nav.window.all'),
          change: formatSignedPercent(toPercent(nav.periodReturn)),
        })}
      </p>
      <BenchmarkLine nav={nav} />
      <p class="meta">
        {tr('trading.render.nav.drawdown', {
          deepest: formatFixedFraction(nav.maximumDrawdown),
          current: formatFixedFraction(nav.currentDrawdown),
        })}
      </p>
      <NavChart nav={nav} />
      <p class="meta">
        {tr('trading.render.nav.points', {
          count: nav.points.length,
          from: formatDay(locale.value, first.day),
          to: formatDay(locale.value, last.day),
        })}
      </p>
    </>
  )
}

// With the whole record read, fewer than two points means the record has only just begun.
function describeThinHistory(nav: TradingNavResponse): string {
  return nav.firstDay === undefined
    ? tr('trading.render.nav.none')
    : tr('trading.render.nav.thin', { from: formatDay(locale.value, nav.firstDay) })
}

function BenchmarkLine({ nav }: { readonly nav: TradingNavResponse }) {
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
        change: formatSignedPercent(toPercent(benchmark.periodReturn)),
      })}
    </p>
  )
}

function toPercent(fraction: number | undefined): number | undefined {
  return fraction === undefined ? undefined : fraction * PERCENT
}
