/** How far a label's baseline sits below the line or edge it names. */
export const LABEL_DROP = 3
const PRICE_TICKS = 4
const DATE_TICKS = 4
// The steps a tick spacing rounds to, within a power of ten.
const NICE_STEPS = [1, 2, 2.5, 5]
// `YYYY-MM-DD`: where the year, month and day sit in a bar's day.
const YEAR_END = 4
const MONTH_START = 5
const MONTH_END = 7
const DAY_START = 8

interface DatedBar {
  /** The session's day, `YYYY-MM-DD`. */
  readonly at: string
}

interface DateAxisProps {
  readonly bars: readonly DatedBar[]
  readonly formatDay: (day: string) => string
  readonly toX: (index: number) => number
  /** The baseline the dates sit on. */
  readonly y: number
}

export function DateAxis({ bars, formatDay, toX, y }: DateAxisProps) {
  return (
    <>
      {dateTicks(bars, formatDay).map((tick, order, ticks) => (
        <text
          key={tick.index}
          class="chart-axis"
          x={toX(tick.index)}
          y={y}
          text-anchor={anchorOf(order, ticks.length)}
        >
          {tick.text}
        </text>
      ))}
    </>
  )
}

interface PriceTicks {
  readonly step: number
  readonly values: readonly number[]
}

// Round prices spaced evenly inside the domain: the smallest nice step that leaves at most
// PRICE_TICKS of them.
export function priceTicks([low, high]: readonly [number, number]): PriceTicks {
  if (!(high > low)) {
    return { step: Math.abs(low), values: [low] }
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
  return {
    step,
    values: Array.from({ length: countOf(step) }, (_, order) => (first + order) * step),
  }
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
  bars: readonly DatedBar[],
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
