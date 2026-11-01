import type { YearView } from '@/web/ui/book/year-view'
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
function buildSeries(year: YearView): Series {
  const lastIndex = year.points.length - 1
  const dayIndex = new Map(year.points.map((point, index) => [point.day, index]))
  const toX = (index: number): number => scaleLinear(index, [0, lastIndex], [PAD, WIDTH - PAD])
  const book = year.points.map((point, index) => ({ x: toX(index), value: point.index }))
  const target = year.benchmark.flatMap((point) => {
    const index = dayIndex.get(point.day)

    return index === undefined ? [] : [{ x: toX(index), value: point.index }]
  })
  const values = [...book, ...target].map((sample) => sample.value)

  return { book, target, domain: [Math.min(...values), Math.max(...values)] }
}

/** The book's time-weighted index (solid) and its target mix over the same days (dashed). */
export function NavChart({ year }: { readonly year: YearView }) {
  const { book, target, domain } = buildSeries(year)
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
