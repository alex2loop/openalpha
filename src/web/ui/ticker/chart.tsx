import { tr } from '@/web/text/tr'
import { scaleLinear, toPolylinePoints } from '@/web/ui/kit/line-path'

const WIDTH = 360
const HEIGHT = 172
// Room on the left for the price ticks, on the right for each level's name, below for the dates.
const PRICE_GUTTER = 48
const LABEL_GUTTER = 64
const DATE_GUTTER = 18
const PAD = 6
const PLOT_LEFT = PRICE_GUTTER
const PLOT_RIGHT = WIDTH - LABEL_GUTTER
const PLOT_BOTTOM = HEIGHT - DATE_GUTTER
// The y-scale reaches this far past the highest and lowest value, so no line sits on the edge.
const Y_MARGIN = 0.06
const LABEL_DROP = 3
const PRICE_TICKS = 4
const DATE_TICKS = 4
// The steps a tick spacing rounds to, within a power of ten.
const NICE_STEPS = [1, 2, 2.5, 5]
// `YYYY-MM-DD`: where the year, month and day sit in a bar's day.
const YEAR_END = 4
const MONTH_START = 5
const MONTH_END = 7
const DAY_START = 8

export type LevelKey = 'buyZone' | 'stop' | 'review' | 'target'

export interface ChartLevel {
  readonly key: LevelKey
  readonly value: number
}

interface ChartBar {
  /** The session's day, `YYYY-MM-DD`. */
  readonly at: string
  readonly close: number
}

interface PriceChartProps {
  readonly bars: readonly ChartBar[]
  readonly levels: readonly ChartLevel[]
  /** A tick's price as the market prints it. */
  readonly formatPrice: (value: number) => string
  /** A full date, for the tick where the range crosses into a new year. */
  readonly formatDay: (day: string) => string
}

/** The closes as a line over price and date axes, with the plan's levels dashed across it. The
 *  scale holds the levels too, so a stop far below the price still shows. Pure drawing: it reads
 *  nothing and listens to nothing. */
export function PriceChart({ bars, levels, formatPrice, formatDay }: PriceChartProps) {
  const values = [...bars.map((bar) => bar.close), ...levels.map((level) => level.value)]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const margin = (high - low) * Y_MARGIN
  const domain: [number, number] = [low - margin, high + margin]
  const toY = (value: number): number => scaleLinear(value, domain, [PLOT_BOTTOM - PAD, PAD])
  const toX = (index: number): number =>
    scaleLinear(index, [0, bars.length - 1], [PLOT_LEFT, PLOT_RIGHT])
  const line = bars.map((bar, index) => ({ x: toX(index), y: toY(bar.close) }))

  return (
    <svg
      class="price-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={tr('ui.office.ticker.sessions', { count: bars.length })}
    >
      {priceTicks(domain).map((value) => (
        <g key={value} class="chart-axis">
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={toY(value)} y2={toY(value)} />
          <text x={PLOT_LEFT - PAD} y={toY(value) + LABEL_DROP} text-anchor="end">
            {formatPrice(value)}
          </text>
        </g>
      ))}
      <DateAxis bars={bars} formatDay={formatDay} toX={toX} />
      {levels.map((level) => (
        <g key={level.key} class={`chart-level is-${level.key}`}>
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={toY(level.value)} y2={toY(level.value)} />
          <text x={PLOT_RIGHT + PAD} y={toY(level.value) + LABEL_DROP}>
            {tr(`ui.office.ticker.${level.key}`)}
          </text>
        </g>
      ))}
      <polyline class="chart-line" points={toPolylinePoints(line)} />
    </svg>
  )
}

interface DateAxisProps {
  readonly bars: readonly ChartBar[]
  readonly formatDay: (day: string) => string
  readonly toX: (index: number) => number
}

function DateAxis({ bars, formatDay, toX }: DateAxisProps) {
  return (
    <>
      {dateTicks(bars, formatDay).map((tick, order, ticks) => (
        <text
          key={tick.index}
          class="chart-axis"
          x={toX(tick.index)}
          y={HEIGHT - LABEL_DROP}
          text-anchor={anchorOf(order, ticks.length)}
        >
          {tick.text}
        </text>
      ))}
    </>
  )
}

// Round prices spaced evenly inside the domain: the smallest nice step that leaves at most
// PRICE_TICKS of them.
function priceTicks([low, high]: readonly [number, number]): readonly number[] {
  if (!(high > low)) {
    return [low]
  }

  const power = 10 ** Math.floor(Math.log10((high - low) / PRICE_TICKS))
  const steps = [
    ...NICE_STEPS.map((nice) => nice * power),
    ...NICE_STEPS.map((nice) => nice * power * 10),
  ]
  const countOf = (spacing: number): number =>
    Math.floor(high / spacing) - Math.ceil(low / spacing) + 1
  const step = steps.find((candidate) => countOf(candidate) <= PRICE_TICKS) ?? high - low
  const first = Math.ceil(low / step)

  // Multiplied, never summed, so no rounding error builds up from one tick to the next.
  return Array.from({ length: countOf(step) }, (_, order) => (first + order) * step)
}

// The end ticks align inward, so neither runs past the plot.
function anchorOf(order: number, count: number): 'start' | 'middle' | 'end' {
  if (order === 0) {
    return 'start'
  }

  return order === count - 1 ? 'end' : 'middle'
}

interface DateTick {
  readonly index: number
  readonly text: string
}

// Evenly spaced sessions, the first and last among them, each as dd/MM; when the range crosses a
// year, the first tick and each one in a new year carry the full date.
function dateTicks(
  bars: readonly ChartBar[],
  formatDay: (day: string) => string
): readonly DateTick[] {
  const count = Math.min(DATE_TICKS, bars.length)
  const indexes = [
    ...new Set(
      Array.from({ length: count }, (_, order) =>
        Math.round((order * (bars.length - 1)) / Math.max(count - 1, 1))
      )
    ),
  ]
  const yearOf = (index: number): string => bars[index]?.at.slice(0, YEAR_END) ?? ''
  const crossesYear = yearOf(0) !== yearOf(bars.length - 1)

  return indexes.map((index, order) => {
    const day = bars[index]?.at ?? ''
    const isNewYear = order === 0 || yearOf(index) !== yearOf(indexes[order - 1] ?? index)

    return {
      index,
      text:
        crossesYear && isNewYear
          ? formatDay(day)
          : `${day.slice(DAY_START)}/${day.slice(MONTH_START, MONTH_END)}`,
    }
  })
}
