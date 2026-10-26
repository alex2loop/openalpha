import type { ActorState } from '@/web/scene/sim/director'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import { pageNow } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { keepCup } from '@/web/scene/sim/life/desks'
import { moment } from '@/web/scene/sim/rhythm'
import { stepErrandsOffice } from '@/web/scene/sim/street/errands'
import { pending } from '@/web/state/live'

/** The errands' office side over this step; nobody leaves while anything waits on the operator.
 *  Anyone back at their seat with a cup keeps it, as from the pantry, until their next idle walk. */
export function stepErrands(
  state: LifeState,
  at: { readonly step: LifeStep; readonly isFree: (actor: ActorState) => boolean }
): void {
  const { step } = at
  const { errands } = state.director
  const { noTrips, closingAuction } = moment.value

  stepErrandsOffice(errands, {
    actors: step.actors,
    isFree: (actor) => at.isFree(actor) && !state.director.away.has(actor.def.id),
    isBusyWithLife: (id) => state.moments.has(id),
    nowMs: step.nowMs,
    pageMs: pageNow(),
    minute: step.clock.minute,
    day: step.clock.day,
    pack: regionPack.value,
    canLeave: step.canWalk && pending.value.length === 0 && !noTrips && !closingAuction,
    isReduced: step.isReduced,
  })

  for (const back of errands.home) {
    if (back.item === 'cup') {
      keepCup(state, back.actor)
    }
  }

  errands.home.length = 0
}
