import { tr } from '@/web/text/tr'
import { scaleLinear, toPolylinePoints } from '@/web/ui/kit/line-path'

const WIDTH = 340
const HEIGHT = 150
// Room on the right for each level's name.
const LABEL_GUTTER = 64
const PAD = 6
// The y-scale reaches this far past the highest and lowest value, so no line sits on the edge.
const Y_MARGIN = 0.06
const LABEL_DROP = 3

export type LevelKey = 'buyZone' | 'stop' | 'target'

export interface ChartLevel {
  readonly key: LevelKey
  readonly value: number
}

interface PriceChartProps {
  readonly closes: readonly number[]
  readonly levels: readonly ChartLevel[]
}

/** The closes as a line, with the plan's levels dashed across it. The scale holds the levels too,
 *  so a stop far below the price still shows. Pure drawing: it reads nothing and listens to nothing. */
export function PriceChart({ closes, levels }: PriceChartProps) {
  const values = [...closes, ...levels.map((level) => level.value)]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const margin = (high - low) * Y_MARGIN
  const domain: [number, number] = [low - margin, high + margin]
  const toY = (value: number): number => scaleLinear(value, domain, [HEIGHT - PAD, PAD])
  const plotRight = WIDTH - LABEL_GUTTER
  const line = closes.map((close, index) => ({
    x: scaleLinear(index, [0, closes.length - 1], [PAD, plotRight]),
    y: toY(close),
  }))

  return (
    <svg
      class="price-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={tr('ui.office.ticker.sessions', { count: closes.length })}
    >
      {levels.map((level) => (
        <g key={level.key} class={`chart-level is-${level.key}`}>
          <line x1={PAD} x2={plotRight} y1={toY(level.value)} y2={toY(level.value)} />
          <text x={plotRight + PAD} y={toY(level.value) + LABEL_DROP}>
            {tr(`ui.office.ticker.${level.key}`)}
          </text>
        </g>
      ))}
      <polyline class="chart-line" points={toPolylinePoints(line)} />
    </svg>
  )
}
