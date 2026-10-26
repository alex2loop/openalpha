import { computed } from '@preact/signals'

import { regionPack } from '@/web/scene/data/home'
import { coolerOffer } from '@/web/scene/data/team-calls'
import { lendStreetTimes } from '@/web/scene/overlay/perf-readout'
import { createStreetPainter, type StreetPainter } from '@/web/scene/render2d/street/paint'
import { createDirector, type Director } from '@/web/scene/sim/director'
import { createLife, type Life } from '@/web/scene/sim/life/life'
import { createLift, type Lift } from '@/web/scene/sim/lift'
import { createSkyEase, type SkyEase } from '@/web/scene/sim/sky'
import { createStreet, type Street } from '@/web/scene/sim/street/street'
import { createTeam, type Team } from '@/web/scene/sim/team/team'
import { agents } from '@/web/state/agents'
import { onWireEvent } from '@/web/state/events'
import { pending, runs } from '@/web/state/live'
import { unread } from '@/web/state/notices'
import { reducedMotion } from '@/web/state/prefs'

// The tray counts unread notices; before the first read there are none to count.
const unreadCount = computed(() => unread.value ?? 0)

/** The office's people, the lift, the office life over them, the team floor, the street with its
 *  painter, and the eased light: what the composer's loop steps and draws. */
export interface Sims {
  readonly lift: Lift
  readonly director: Director
  readonly life: Life
  readonly team: Team
  readonly street: Street
  readonly painter: StreetPainter
  readonly sky: SkyEase
}

/** Makes the sims and lends the street's times to the perf readout; `disposeSims` releases them. */
export function createSims(): Sims {
  const lift = createLift()
  const director = createDirector({ lift, runs, pending, unread: unreadCount, hub: onWireEvent })
  const team = createTeam({ agents, runs, offers: coolerOffer, hub: onWireEvent })
  const teamDesks = () => team.view(performance.now()).desks
  const street = createStreet({
    pack: regionPack,
    reduced: reducedMotion,
    errands: director.errands,
  })
  const painter = createStreetPainter()

  lendStreetTimes(() => ({ stepMs: street.stepMs(), paintMs: painter.paintMs() }))

  return {
    lift,
    director,
    life: createLife({ director, teamDesks, reduced: reducedMotion }),
    team,
    street,
    painter,
    sky: createSkyEase(),
  }
}

export function disposeSims(sims: Sims): void {
  lendStreetTimes(undefined)
  sims.life.dispose()
  sims.director.dispose()
  sims.team.dispose()
  sims.street.dispose()
  sims.painter.release()
}
