import type { People, Person } from '@/web/scene/sim/people'
import type { ActorId, ActorView, PoseId } from '@/web/scene/types'
import { isCrewId } from '@/web/scene/sim/actors/roster'
import { toActorView } from '@/web/scene/sim/people'
import { type Errands, errandOf } from '@/web/scene/sim/street/errands'

/** What one frame's people views read besides the people: each pose and when it began, the
 *  errands, who is away, and the pose of someone with no mark yet. */
interface ViewsAt {
  readonly marks: ReadonlyMap<ActorId, Pick<ActorView, 'pose' | 'poseSince'>>
  readonly errands: Errands
  readonly away: ReadonlyMap<ActorId, 'leaving' | 'gone' | 'arriving'>
  readonly poseOf: (person: Person) => PoseId
}

/** Every person as the renderers draw them: out on an errand, gone home, in the lift car, one of
 *  the building crew. */
export function actorViewsOf(people: People, at: ViewsAt): ActorView[] {
  return people.list.map((person) => {
    const id = person.def.id
    const view = withErrand(
      at.errands,
      toActorView(people, person, at.marks.get(id) ?? { pose: at.poseOf(person), poseSince: 0 })
    )
    const isAway = at.away.get(id) === 'gone'
    const isCrew = isCrewId(id)

    return isAway || isCrew || person.isRiding
      ? {
          ...view,
          ...(isAway ? { isAway: true as const } : {}),
          ...(isCrew ? { isCrew: true as const } : {}),
          ...(person.isRiding ? { isRiding: true as const } : {}),
        }
      : view
  })
}

// Someone on an errand says where; past the street door they stand where the street has them.
function withErrand(errands: Errands, view: ActorView): ActorView {
  const errand = errandOf(errands, view.id)

  if (errand === undefined) {
    return view
  }

  return errand.view.isOut
    ? { ...view, errand: errand.view, prev: errand.ped.prev, at: errand.ped.at }
    : { ...view, errand: errand.view }
}
