import type { TradingNavResponse } from '@/app/server/wire/nav'
import type { NavWindow } from '@/app/server/wire/vocab'
import { formatDay } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { NAV_WINDOWS, navWindow, pickNavWindow } from '@/web/state/book'
import { locale } from '@/web/state/session'
import { formatFixedFraction, formatSignedFraction } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { NavChart } from '@/web/ui/book/nav-chart'
import { PnlBlock } from '@/web/ui/book/pnl-block'
import { TrendIcon } from '@/web/ui/kit/icons'
import { Segmented } from '@/web/ui/kit/segmented'
import { BlockFrame } from '@/web/ui/today/block-frame'

const NAV_REFRESH_MS = 600_000

/** Hiệu quả: how the book has done over the window picked, against the operator's target mix, as
 *  the daemon measures it, then what each holding has made. */
export function Performance() {
  const picked = navWindow.value

  return (
    <>
      <Segmented
        label={tr('ui.office.book.windowPick')}
        value={picked}
        options={NAV_WINDOWS.map((choice) => ({
          value: choice,
          label: tr(`ui.office.book.window.${choice}`),
        }))}
        onChange={pickNavWindow}
      />
      <NavBlock key={picked} span={picked} />
      <PnlBlock />
    </>
  )
}

// The read is fixed for the block's life, so each window is its own block.
function NavBlock({ span }: { readonly span: NavWindow }) {
  const reading = useBlock(ROUTES.portfolioNav, {
    query: { window: span },
    everyMs: NAV_REFRESH_MS,
  })

  return (
    <BlockFrame
      title={tr('ui.office.book.navTitle')}
      colour="blue"
      icon={<TrendIcon />}
      reading={reading}
      dataTo={reading.data?.points.at(-1)?.day}
    >
      {(nav) => <NavBody nav={nav} span={span} />}
    </BlockFrame>
  )
}

function NavBody({ nav, span }: { readonly nav: TradingNavResponse; readonly span: NavWindow }) {
  const first = nav.points[0]
  const last = nav.points.at(-1)

  if (first === undefined || last === undefined || nav.points.length < 2) {
    return <p class="meta">{describeThinHistory(nav)}</p>
  }

  return (
    <>
      <p>
        {tr('trading.render.nav.return', {
          window: tr(`trading.render.nav.window.${span}`),
          change: formatSignedFraction(nav.periodReturn),
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

// Fewer than two snapshots in the window: none kept at all, one so far, or older than the window.
function describeThinHistory(nav: TradingNavResponse): string {
  if (nav.firstDay === undefined) {
    return tr('trading.render.nav.none')
  }

  return tr(nav.recordedCount < 2 ? 'trading.render.nav.thin' : 'trading.render.nav.sparse', {
    from: formatDay(locale.value, nav.firstDay),
  })
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
        change: formatSignedFraction(benchmark.periodReturn),
      })}
    </p>
  )
}
