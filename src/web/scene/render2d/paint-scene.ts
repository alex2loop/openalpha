import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { ScreenCache } from '@/web/scene/sprites/screens'
import type { SimView } from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { agenda } from '@/web/scene/data/agenda'
import { alertStrip } from '@/web/scene/data/alert-strip'
import { wallClockMinutes } from '@/web/scene/data/home'
import { homeIndex } from '@/web/scene/data/led'
import { boardCaptions, isPrintingRun, roomStatus } from '@/web/scene/data/room-status'
import { sourceLights } from '@/web/scene/data/source-lights'
import { detailOf } from '@/web/scene/sim/life/animal-model'
import { boardNotes } from '@/web/scene/sprites/screens'
import { APPROVAL_KIND, pending } from '@/web/state/live'
import { toneOfPercent } from '@/web/text/figures'

// Where the day of the month starts in a `YYYY-MM-DD` day.
const DAY_OF_MONTH_AT = 8

/** What the props read this frame, gathered once from the sim and the scene's data. */
export function buildPaintScene(input: {
  readonly sim: SimView
  readonly scale: number
  readonly screens: ScreenCache
}): PaintScene {
  const { sim, scale } = input
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
  }
}
