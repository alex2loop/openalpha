/** The height of the band, which sits under the price plot. */
export const VOLUME_HEIGHT = 40
// A bar fills this share of its session's width, so neighbours stay apart.
const BAR_FILL = 0.7

interface VolumeBar {
  /** The session's day, `YYYY-MM-DD`. */
  readonly at: string
  readonly close: number
  readonly volume: number
}

interface VolumeBandProps {
  readonly bars: readonly VolumeBar[]
  /** The band's top edge. */
  readonly top: number
  readonly toX: (index: number) => number
}

/** Whether any session traded: a series of zeros has no band to draw. */
export function hasVolume(bars: readonly VolumeBar[]): boolean {
  return bars.some((bar) => bar.volume > 0)
}

/** One bar per session, scaled to the busiest, in the up colour when the close held or rose from the
 *  session before and the down colour when it fell (the first has none before it, so reads as up). */
export function VolumeBand({ bars, top, toX }: VolumeBandProps) {
  const busiest = Math.max(...bars.map((bar) => bar.volume))
  const width = (toX(1) - toX(0)) * BAR_FILL

  return (
    <g class="chart-volume">
      {bars.map((bar, index) => {
        const height = (bar.volume / busiest) * VOLUME_HEIGHT
        const isUp = bar.close >= (bars[index - 1]?.close ?? bar.close)

        return (
          <rect
            key={bar.at}
            class={isUp ? 'is-up' : 'is-down'}
            x={toX(index) - width / 2}
            y={top + VOLUME_HEIGHT - height}
            width={width}
            height={height}
          />
        )
      })}
    </g>
  )
}
