/** How far a label's baseline sits below the line or edge it names. */
export const LABEL_DROP = 3
const PRICE_TICKS = 4
const DATE_TICKS = 4
// A date label's width per character at the caption size, a little over the widest digit, and the
// least room left between two labels.
const DATE_CHAR_WIDTH = 6.5
const DATE_LABEL_GAP = 8
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
      {dateTicks(bars, formatDay, toX).map((tick) => (
        <text
          key={tick.index}
          class="chart-axis"
          x={toX(tick.index)}
          y={y}
          text-anchor={tick.anchor}
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

type TickAnchor = 'start' | 'middle' | 'end'

interface DateTick {
  readonly index: number
  readonly text: string
  /** The end ticks align inward, so neither runs past the plot. */
  readonly anchor: TickAnchor
  /** Where the label's text starts and ends across the plot. */
  readonly left: number
  readonly right: number
}

// Evenly spaced sessions, the first and last among them, each as dd/MM; when the range crosses a
// year, the first tick and each one in a new year carry the full date. A middle tick that would sit
// closer than DATE_LABEL_GAP to its neighbour is left out, and so is a kept one the last tick would
// crowd; the first and the last always stay.
function dateTicks(
  bars: readonly DatedBar[],
  formatDay: (day: string) => string,
  toX: (index: number) => number
): readonly DateTick[] {
  const count = Math.min(DATE_TICKS, bars.length)
  const [first = 0, ...rest] = [
    ...new Set(
      Array.from({ length: count }, (_, order) =>
        Math.round((order * (bars.length - 1)) / Math.max(count - 1, 1))
      )
    ),
  ]
  const last = rest.pop()
  const place = tickPlacer(bars, formatDay, toX)
  const kept = [place(first, 'start', undefined)]

  for (const index of rest) {
    const tick = place(index, 'middle', kept.at(-1)?.index)

    if (tick.left - (kept.at(-1)?.right ?? 0) >= DATE_LABEL_GAP) {
      kept.push(tick)
    }
  }

  while (last !== undefined) {
    const previous = kept.at(-1)
    const tick = place(last, 'end', previous?.index)

    if (
      previous === undefined ||
      kept.length === 1 ||
      tick.left - previous.right >= DATE_LABEL_GAP
    ) {
      kept.push(tick)
      break
    }

    kept.pop()
  }

  return kept
}

// A tick's label for a session, against the session of the tick before it: a new year says it in
// full.
function tickPlacer(
  bars: readonly DatedBar[],
  formatDay: (day: string) => string,
  toX: (index: number) => number
): (index: number, anchor: TickAnchor, previous: number | undefined) => DateTick {
  const yearOf = (index: number): string => bars[index]?.at.slice(0, YEAR_END) ?? ''
  const crossesYear = yearOf(0) !== yearOf(bars.length - 1)

  return (index, anchor, previous) => {
    const day = bars[index]?.at ?? ''
    const isNewYear = previous === undefined || yearOf(index) !== yearOf(previous)
    const text =
      crossesYear && isNewYear
        ? formatDay(day)
        : `${day.slice(DAY_START)}/${day.slice(MONTH_START, MONTH_END)}`
    const width = text.length * DATE_CHAR_WIDTH
    const left = { start: toX(index), middle: toX(index) - width / 2, end: toX(index) - width }[
      anchor
    ]

    return { index, text, anchor, left, right: left + width }
  }
}
