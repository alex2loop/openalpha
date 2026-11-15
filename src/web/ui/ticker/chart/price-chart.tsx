import type { PriceWindow } from '@/app/server/wire/vocab'
import { tr } from '@/web/text/tr'
import { scaleLinear, toPolylinePoints } from '@/web/ui/kit/line-path'
import { useWidth } from '@/web/ui/kit/use-width'
import { DateAxis, LABEL_DROP, priceTicks } from '@/web/ui/ticker/chart/axes'
import { hasVolume, VOLUME_HEIGHT, VolumeBand } from '@/web/ui/ticker/chart/volume-band'

import './chart.css'

const HEIGHT = 172
// Room on the left for the price ticks, on the right for each level's name (only where the chart
// has levels to name), below for the dates.
const PRICE_GUTTER = 60
const LABEL_GUTTER = 64
const DATE_GUTTER = 18
const PAD = 6
const PLOT_LEFT = PRICE_GUTTER
const PLOT_BOTTOM = HEIGHT - DATE_GUTTER
// The y-scale reaches this far past the highest and lowest value, so no line sits on the edge.
const Y_MARGIN = 0.06
// A line of a moving average needs at least two points to show.
const MIN_LINE_POINTS = 2
const LEGEND_SWATCH_WIDTH = 16
const LEGEND_SWATCH_HEIGHT = 8

export type LevelKey = 'buyZone' | 'stop' | 'review' | 'target'

export interface ChartLevel {
  readonly key: LevelKey
  readonly value: number
}

interface ChartBar {
  /** The session's day, `YYYY-MM-DD`. */
  readonly at: string
  readonly close: number
  readonly volume: number
}

interface ChartAverage {
  readonly sessions: number
  /** One value per bar; `null` where too few closes stand behind it. */
  readonly values: readonly (number | null)[]
}

interface PriceChartProps {
  readonly bars: readonly ChartBar[]
  readonly averages: readonly ChartAverage[]
  readonly levels: readonly ChartLevel[]
  readonly span: PriceWindow
  /** A tick's price as the market prints it, at the decimals the tick spacing needs. */
  readonly formatPrice: (value: number, step: number) => string
  /** A full date, for the tick where the range crosses into a new year. */
  readonly formatDay: (day: string) => string
}

interface Point {
  readonly index: number
  readonly value: number
}

interface DrawnAverage {
  readonly sessions: number
  /** The stretches the average has values for, a gap starting the next. */
  readonly runs: readonly (readonly Point[])[]
}

/** The closes as a line over price and date axes, the moving averages over it, the plan's levels
 *  dashed across it and each session's volume in a band beneath. The scale holds the levels and averages
 *  too, so a stop far below the price still shows. It draws one unit per pixel of its card's width,
 *  so the plot stretches and the labels keep their size. */
export function PriceChart(props: PriceChartProps) {
  const { bars, averages, levels, span, formatPrice, formatDay } = props
  const { ref, width } = useWidth()
  const drawn = toDrawnAverages(averages)
  const hasBand = hasVolume(bars)
  const height = HEIGHT + (hasBand ? VOLUME_HEIGHT : 0)
  const plotRight = width - (levels.length > 0 ? LABEL_GUTTER : PAD)
  const domain = toDomain([
    ...bars.map((bar) => bar.close),
    ...levels.map((level) => level.value),
    ...averages.flatMap((average) => average.values).filter(isPresent),
  ])
  const toY = (value: number): number => scaleLinear(value, domain, [PLOT_BOTTOM - PAD, PAD])
  const toX = (index: number): number =>
    scaleLinear(index, [0, bars.length - 1], [PLOT_LEFT, plotRight])
  const line = bars.map((bar, index) => ({ x: toX(index), y: toY(bar.close) }))

  return (
    <div class="price-chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={tr('ui.office.ticker.chartLabel', {
          window: tr(`ui.office.window.${span}`),
        })}
      >
        <PriceAxis domain={domain} toY={toY} plotRight={plotRight} formatPrice={formatPrice} />
        {hasBand && <VolumeBand bars={bars} top={PLOT_BOTTOM} toX={toX} />}
        <DateAxis bars={bars} formatDay={formatDay} toX={toX} y={height - LABEL_DROP} />
        <LevelLines levels={levels} toY={toY} plotRight={plotRight} />
        <AverageLines averages={drawn} toX={toX} toY={toY} />
        <polyline class="chart-line" points={toPolylinePoints(line)} />
      </svg>
      <AverageLegend averages={drawn} />
    </div>
  )
}

interface PriceAxisProps {
  readonly domain: readonly [number, number]
  readonly toY: (value: number) => number
  readonly plotRight: number
  readonly formatPrice: (value: number, step: number) => string
}

function PriceAxis({ domain, toY, plotRight, formatPrice }: PriceAxisProps) {
  const { step, values } = priceTicks(domain)

  return (
    <>
      {values.map((value) => (
        <g key={value} class="chart-axis">
          <line x1={PLOT_LEFT} x2={plotRight} y1={toY(value)} y2={toY(value)} />
          <text x={PLOT_LEFT - PAD} y={toY(value) + LABEL_DROP} text-anchor="end">
            {formatPrice(value, step)}
          </text>
        </g>
      ))}
    </>
  )
}

interface LevelLinesProps {
  readonly levels: readonly ChartLevel[]
  readonly toY: (value: number) => number
  readonly plotRight: number
}

function LevelLines({ levels, toY, plotRight }: LevelLinesProps) {
  return (
    <>
      {levels.map((level) => (
        <g key={level.key} class={`chart-level is-${level.key}`}>
          <line x1={PLOT_LEFT} x2={plotRight} y1={toY(level.value)} y2={toY(level.value)} />
          <text x={plotRight + PAD} y={toY(level.value) + LABEL_DROP}>
            {tr(`ui.office.ticker.${level.key}`)}
          </text>
        </g>
      ))}
    </>
  )
}

interface AverageLinesProps {
  readonly averages: readonly DrawnAverage[]
  readonly toX: (index: number) => number
  readonly toY: (value: number) => number
}

function AverageLines({ averages, toX, toY }: AverageLinesProps) {
  return (
    <>
      {averages.map(({ sessions, runs }) =>
        runs.map((run) => (
          <polyline
            key={`${sessions}:${run[0]?.index}`}
            class={`chart-average is-ma${sessions}`}
            points={toPolylinePoints(
              run.map(({ index, value }) => ({ x: toX(index), y: toY(value) }))
            )}
          />
        ))
      )}
    </>
  )
}

function AverageLegend({ averages }: { readonly averages: readonly DrawnAverage[] }) {
  if (averages.length === 0) {
    return null
  }

  return (
    <ul class="chart-legend">
      {averages.map(({ sessions }) => (
        <li key={sessions}>
          <svg
            width={LEGEND_SWATCH_WIDTH}
            height={LEGEND_SWATCH_HEIGHT}
            viewBox={`0 0 ${LEGEND_SWATCH_WIDTH} ${LEGEND_SWATCH_HEIGHT}`}
            aria-hidden="true"
          >
            <line
              class={`chart-average is-ma${sessions}`}
              x1={0}
              x2={LEGEND_SWATCH_WIDTH}
              y1={LEGEND_SWATCH_HEIGHT / 2}
              y2={LEGEND_SWATCH_HEIGHT / 2}
            />
          </svg>
          {tr('ui.office.ticker.average', { sessions })}
        </li>
      ))}
    </ul>
  )
}

function toDomain(values: readonly number[]): [number, number] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  const margin = (high - low) * Y_MARGIN

  return [low - margin, high + margin]
}

// An average with no stretch of two points has nothing to draw, and no legend line.
function toDrawnAverages(averages: readonly ChartAverage[]): readonly DrawnAverage[] {
  return averages
    .map(({ sessions, values }) => ({
      sessions,
      runs: toRuns(values).filter((run) => run.length >= MIN_LINE_POINTS),
    }))
    .filter(({ runs }) => runs.length > 0)
}

// The values split at every `null`: a gap starts a new stretch.
function toRuns(values: readonly (number | null)[]): readonly (readonly Point[])[] {
  const runs: Point[][] = []
  let current: Point[] | undefined

  for (const [index, value] of values.entries()) {
    if (value === null) {
      current = undefined
      continue
    }

    if (current === undefined) {
      current = []
      runs.push(current)
    }

    current.push({ index, value })
  }

  return runs
}

function isPresent(value: number | null): value is number {
  return value !== null
}
