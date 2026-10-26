import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { ScreenCache } from '@/web/scene/sprites/screens'
import type { SimView } from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { agenda } from '@/web/scene/data/agenda'
import { alertStrip } from '@/web/scene/data/alert-strip'
import { homeMarket, wallClockMinutes } from '@/web/scene/data/home'
import { homeIndex } from '@/web/scene/data/led'
import { boardCaptions, isPrintingRun, roomStatus } from '@/web/scene/data/room-status'
import { sourceLights } from '@/web/scene/data/source-lights'
import { resolveAmbientFx } from '@/web/scene/render2d/ambient-fx'
import { detailOf } from '@/web/scene/sim/life/animal-model'
import { boardNotes } from '@/web/scene/sprites/screens'
import { deskSpotOf } from '@/web/scene/world/desk-spots'
import { propsOn } from '@/web/scene/world/props'
import { APPROVAL_KIND, pending } from '@/web/state/live'
import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'

// Where the day of the month starts in a `YYYY-MM-DD` day.
const DAY_OF_MONTH_AT = 8
// Someone this close to a desk's middle, and this far below its top, sits at it.
const SEAT_REACH_PX = 12
const SEAT_DEPTH_PX = [2, 24] as const
// The alert counter and your desk keep their screens standing, as the mockup draws them.
const SEATLESS_DESKS: ReadonlySet<number> = new Set([1, 2])

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
    seated: seatedDesksOf(sim),
    stretch: input.stretch,
    ...(indexMoveText === undefined ? {} : { indexMoveText }),
  }
}

// The desks someone sits still at, by `deskSpotOf`: within the mockup's reach of the desk's middle,
// between its top and its front edge. Your desk keeps its standing screens.
function seatedDesksOf(sim: SimView): ReadonlySet<string> {
  const still = sim.actors.filter(
    (actor) =>
      actor.floor === sim.floor &&
      actor.isAway !== true &&
      actor.isRiding !== true &&
      actor.prev.x === actor.at.x &&
      actor.prev.y === actor.at.y
  )
  const desks = propsOn(sim.floor).filter(
    (prop) => prop.kind === 'desk' && !SEATLESS_DESKS.has(prop.variant ?? 0)
  )

  return new Set(
    desks
      .filter((desk) => {
        const cx = desk.draw.x + desk.draw.w / 2

        return still.some(
          (actor) =>
            Math.abs(actor.at.x - cx) <= SEAT_REACH_PX &&
            actor.at.y >= desk.draw.y + SEAT_DEPTH_PX[0] &&
            actor.at.y <= desk.draw.y + SEAT_DEPTH_PX[1]
        )
      })
      .map(deskSpotOf)
  )
}

// The refresh's done over total, when both are counts.
function shareOf(params: Readonly<Record<string, unknown>> | undefined): number | undefined {
  const done = params?.done
  const total = params?.total

  return typeof done === 'number' && typeof total === 'number' && total > 0
    ? Math.min(1, Math.max(0, done / total))
    : undefined
}
