import { tr } from '@/web/text/tr'
import { useWidth } from '@/web/ui/kit/use-width'

import './flow-bars.css'

const HEIGHT = 56
const ZERO_Y = HEIGHT / 2
// A bar fills this share of its session's slot, so neighbours stay apart.
const BAR_FILL = 0.7

interface FlowBarsProps {
  readonly label: string
  /** One net per session, oldest first; `null` where the figure was not published. */
  readonly values: readonly (number | null)[]
}

/** One bar per session either side of a zero line, scaled to the largest, up above and down below.
 *  A session with no figure is an empty slot, never a bar of zero. */
export function FlowBars({ label, values }: FlowBarsProps) {
  const { ref, width } = useWidth()
  const slot = width / values.length
  const barWidth = slot * BAR_FILL
  const largest = Math.max(0, ...values.map((value) => (value === null ? 0 : Math.abs(value))))
  const scale = largest === 0 ? 0 : ZERO_Y / largest

  return (
    <div class="flow-bars" ref={ref}>
      <span class="meta">{label}</span>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={tr('ui.office.market.flowBarsLabel', { label, count: values.length })}
      >
        {values.map((value, index) => (
          <FlowBar
            key={index}
            value={value}
            x={index * slot + (slot - barWidth) / 2}
            width={barWidth}
            scale={scale}
          />
        ))}
        <line class="flow-bars-zero" x1={0} x2={width} y1={ZERO_Y} y2={ZERO_Y} />
      </svg>
    </div>
  )
}

interface FlowBarProps {
  readonly value: number | null
  readonly x: number
  readonly width: number
  /** Height per unit of value. */
  readonly scale: number
}

function FlowBar({ value, x, width, scale }: FlowBarProps) {
  if (value === null) {
    return <rect class="flow-bars-gap" x={x} y={0} width={width} height={HEIGHT} />
  }

  const height = Math.abs(value) * scale

  return (
    <rect
      class={value < 0 ? 'is-down' : 'is-up'}
      x={x}
      y={value < 0 ? ZERO_Y : ZERO_Y - height}
      width={width}
      height={height}
    />
  )
}
