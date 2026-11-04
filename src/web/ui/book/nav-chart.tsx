import type { TradingNavResponse } from '@/app/server/wire/trading'
import { tr } from '@/web/text/tr'
import { scaleLinear, toPolylinePoints } from '@/web/ui/kit/line-path'

const WIDTH = 340
const HEIGHT = 130
const PAD = 6

interface Sample {
  readonly x: number
  readonly value: number
}

interface Series {
  readonly book: readonly Sample[]
  readonly target: readonly Sample[]
  readonly domain: readonly [number, number]
}

// The target mix's days are matched to the book's, so both lines stand on one time axis.
function buildSeries(nav: TradingNavResponse): Series {
  const lastIndex = nav.points.length - 1
  const dayIndex = new Map(nav.points.map((point, index) => [point.day, index]))
  const toX = (index: number): number => scaleLinear(index, [0, lastIndex], [PAD, WIDTH - PAD])
  const book = nav.points.map((point, index) => ({ x: toX(index), value: point.index }))
  const target = (nav.benchmark?.points ?? []).flatMap((point) => {
    const index = dayIndex.get(point.day)

    return index === undefined ? [] : [{ x: toX(index), value: point.index }]
  })
  const values = [...book, ...target].map((sample) => sample.value)

  return { book, target, domain: [Math.min(...values), Math.max(...values)] }
}

/** The book's time-weighted index (solid) and its target mix over the same days (dashed). */
export function NavChart({ nav }: { readonly nav: TradingNavResponse }) {
  const { book, target, domain } = buildSeries(nav)
  const toPoints = (samples: readonly Sample[]): string =>
    toPolylinePoints(
      samples.map((sample) => ({
        x: sample.x,
        y: scaleLinear(sample.value, domain, [HEIGHT - PAD, PAD]),
      }))
    )

  return (
    <div>
      <svg
        class="nav-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={tr('trading.render.nav.heading')}
      >
        {target.length > 1 && <polyline class="nav-line is-target" points={toPoints(target)} />}
        <polyline class="nav-line" points={toPoints(book)} />
      </svg>
      <div class="nav-legend">
        <span>
          <i />
          {tr('ui.office.book.perfBook')}
        </span>
        {target.length > 1 && (
          <span>
            <i class="is-target" />
            {tr('ui.office.book.perfTarget')}
          </span>
        )}
      </div>
    </div>
  )
}
