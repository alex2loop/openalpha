import { useEffect, useState } from 'preact/hooks'

import type { RendererStats, SceneRenderer } from '@/web/scene/renderer'
import {
  DRAW_CALLS_MAX,
  FRAME_2D_BUDGET_MS,
  SMALL_MOTION_RENDERS_PER_S,
  STREET_PAINT_BUDGET_MS,
  STREET_STEP_BUDGET_MS,
} from '@/web/scene/budgets'
import { formatFixed } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

import './perf-readout.css'

const PERF_PARAM = 'perf'
const PERF_ON = '1'
const PERF_READ_MS = 1_000
const MS_DIGITS = 2
const COUNT_DIGITS = 0

/** The street's last sim step and last static repaint. */
interface StreetTimes {
  readonly stepMs: number
  readonly paintMs: number
}

interface PerfReadoutProps {
  readonly renderer: SceneRenderer
}

// The mounted street's times; none while no street is mounted.
let readStreetTimes: (() => StreetTimes) | undefined

/** The crew lends its street's times while mounted and takes them back (`undefined`) on unmount. */
export function lendStreetTimes(read: (() => StreetTimes) | undefined): void {
  readStreetTimes = read
}

/** The renderer's figures against their budgets, only on an address with `?perf=1`. */
export function PerfReadout({ renderer }: PerfReadoutProps) {
  const [isShown] = useState(() => new URLSearchParams(location.search).get(PERF_PARAM) === PERF_ON)

  return isShown ? <PerfPanel renderer={renderer} /> : null
}

// The 2D frame against its budget; the 3D frame has no budget of its own, so it reads bare.
function FrameLine({ stats }: { readonly stats: RendererStats | undefined }) {
  if (stats?.view === '3d') {
    return (
      <PerfLine
        isOver={false}
        text={tr('ui.office.perf.frame3d', { ms: formatFixed(stats.frameMs, MS_DIGITS) })}
      />
    )
  }

  return (
    <PerfLine
      isOver={stats !== undefined && stats.frameMs > FRAME_2D_BUDGET_MS}
      text={tr('ui.office.perf.frame2d', {
        ms: formatFixed(stats?.frameMs, MS_DIGITS),
        budget: formatFixed(FRAME_2D_BUDGET_MS, MS_DIGITS),
      })}
    />
  )
}

function PerfPanel({ renderer }: PerfReadoutProps) {
  const [stats, setStats] = useState<RendererStats | undefined>(undefined)
  const [times, setTimes] = useState<StreetTimes | undefined>(undefined)

  useEffect(
    () =>
      pollStats(() => {
        setStats(renderer.stats())
        setTimes(readStreetTimes?.())
      }),
    [renderer]
  )

  return (
    <div class="perf-readout glass" role="status">
      <p class="perf-title">{tr('ui.office.perf.title')}</p>
      <FrameLine stats={stats} />
      <PerfLine
        isOver={stats !== undefined && stats.rendersPerSecond > SMALL_MOTION_RENDERS_PER_S}
        text={tr('ui.office.perf.renders', {
          renders: formatFixed(stats?.rendersPerSecond, COUNT_DIGITS),
          budget: formatFixed(SMALL_MOTION_RENDERS_PER_S, COUNT_DIGITS),
        })}
      />
      {stats?.drawCalls !== undefined && (
        <PerfLine
          isOver={stats.drawCalls > DRAW_CALLS_MAX}
          text={tr('ui.office.perf.drawCalls', {
            calls: formatFixed(stats.drawCalls, COUNT_DIGITS),
            max: formatFixed(DRAW_CALLS_MAX, COUNT_DIGITS),
          })}
        />
      )}
      <StreetLines times={times} />
    </div>
  )
}

function StreetLines({ times }: { readonly times: StreetTimes | undefined }) {
  return (
    <>
      <PerfLine
        isOver={times !== undefined && times.stepMs > STREET_STEP_BUDGET_MS}
        text={tr('ui.office.perf.street', {
          ms: formatFixed(times?.stepMs, MS_DIGITS),
          budget: formatFixed(STREET_STEP_BUDGET_MS, MS_DIGITS),
        })}
      />
      <PerfLine
        isOver={times !== undefined && times.paintMs > STREET_PAINT_BUDGET_MS}
        text={tr('ui.office.perf.streetPaint', {
          ms: formatFixed(times?.paintMs, MS_DIGITS),
          budget: formatFixed(STREET_PAINT_BUDGET_MS, MS_DIGITS),
        })}
      />
    </>
  )
}

function PerfLine({ isOver, text }: { readonly isOver: boolean; readonly text: string }) {
  return <p class={isOver ? 'perf-line is-over' : 'perf-line'}>{text}</p>
}

// Reads once a second while the tab is shown; the returned stop clears the interval and listener.
function pollStats(read: () => void): () => void {
  const listeners = new AbortController()
  let interval: ReturnType<typeof setInterval> | undefined

  const sync = (): void => {
    clearInterval(interval)
    interval = undefined

    if (!document.hidden) {
      read()
      interval = setInterval(read, PERF_READ_MS)
    }
  }

  document.addEventListener('visibilitychange', sync, { signal: listeners.signal })
  sync()

  return () => {
    listeners.abort()
    clearInterval(interval)
  }
}
