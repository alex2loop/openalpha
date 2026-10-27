import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { ScreenCache } from '@/web/scene/sprites/screens'
import type { SimView } from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { agenda } from '@/web/scene/data/agenda'
import { alertStrip } from '@/web/scene/data/alert-strip'
import { homeMarket, wallClockMinutes } from '@/web/scene/data/home'
import { homeIndex } from '@/web/scene/data/led'
import { isPrintingRun, roomStatus } from '@/web/scene/data/room-status'
import { sourceLights } from '@/web/scene/data/source-lights'
import { resolveAmbientFx } from '@/web/scene/render2d/ambient-fx'
import { boardCaptions } from '@/web/scene/sim/board-captions'
import { detailOf } from '@/web/scene/sim/life/animal-model'
import { boardNotes } from '@/web/scene/sprites/screens'
import { APPROVAL_KIND, pending } from '@/web/state/live'
import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'

// Where the day of the month starts in a `YYYY-MM-DD` day.
const DAY_OF_MONTH_AT = 8

/** What the props read this frame, gathered once from the sim and the scene's data. */
export function buildPaintScene(input: {
  readonly sim: SimView
  readonly scale: number
  readonly screens: ScreenCache
  readonly nowMs: number
  readonly stretch: number
}): PaintScene {
  const { sim, scale } = input
  const indexChange = homeIndex.value?.changePct
  const indexMoveText = indexChange === undefined ? undefined : formatSignedPercent(indexChange)
  const storeParams = roomStatus.value.get('store')?.runs[0]?.progress?.params
  const refreshShare = shareOf(storeParams)
  const named = storeParams?.market
  const refreshMarket = typeof named === 'string' ? named : homeMarket.value?.market
  const lib = roomStatus.value.get('lib')?.runs[0]

  return {
    lit: sim.props.lit,
    isAnyLit: sim.props.lit.size > 0,
    minuteOfDay: pageMinute.value.minute,
    scale,
    isPrinting: isPrintingRun(lib),
    notes: boardNotes.value,
    strip: alertStrip.value,
    agenda: agenda.value,
    screens: input.screens,
    life: sim.life,
    detail: detailOf(scale),
    isRaining: sim.weather.rain > 0,
    lift: sim.lift,
    indexMove: toneOfPercent(homeIndex.value?.changePct),
    isAwaitingYou: pending.value.some((entry) => entry.kind === APPROVAL_KIND),
    dayOfMonth: String(Number(pageMinute.value.day.slice(DAY_OF_MONTH_AT))),
    captions: boardCaptions.value,
    wallClocks: wallClockMinutes.value,
    sources: sourceLights.value,
    isRefreshing: roomStatus.value.get('store')?.runs[0] !== undefined,
    ...(refreshShare === undefined ? {} : { refreshShare }),
    ...(refreshMarket === undefined ? {} : { refreshMarket }),
    fx: resolveAmbientFx(sim, input.nowMs),
    stretch: input.stretch,
    ...(indexMoveText === undefined ? {} : { indexMoveText }),
  }
}

// The refresh's done over total, when both are counts.
function shareOf(params: Readonly<Record<string, unknown>> | undefined): number | undefined {
  const done = params?.done
  const total = params?.total

  return typeof done === 'number' && typeof total === 'number' && total > 0
    ? Math.min(1, Math.max(0, done / total))
    : undefined
}
