import { computed } from '@preact/signals'

import { regionPack } from '@/web/scene/data/home'
import { coolerOffer } from '@/web/scene/data/team-calls'
import { lendStreetTimes } from '@/web/scene/overlay/perf-readout'
import { createStreetPainter, type StreetPainter } from '@/web/scene/render2d/street/paint'
import { createDirector, type Director } from '@/web/scene/sim/director'
import { createLife, type Life } from '@/web/scene/sim/life/life'
import { createStreet, type Street } from '@/web/scene/sim/street/street'
import { createTeam, type Team } from '@/web/scene/sim/team/team'
import { agents } from '@/web/state/agents'
import { onWireEvent } from '@/web/state/events'
import { pending, runs } from '@/web/state/live'
import { unread } from '@/web/state/notices'
import { reducedMotion } from '@/web/state/prefs'

// The tray counts unread notices; before the first read there are none to count.
const unreadCount = computed(() => unread.value ?? 0)

/** The office's people, the office life over them, the team floor, and the street with its
 *  painter: what the composer's loop steps and draws. */
export interface Crew {
  readonly director: Director
  readonly life: Life
  readonly team: Team
  readonly street: Street
  readonly painter: StreetPainter
}

/** Makes the crew and lends the street's times to the perf readout; `disposeCrew` releases it. */
export function createCrew(): Crew {
  const director = createDirector({ runs, pending, unread: unreadCount, hub: onWireEvent })
  const team = createTeam({ agents, runs, offers: coolerOffer, hub: onWireEvent })
  const teamDesks = () => team.view(performance.now()).desks
  const street = createStreet({ pack: regionPack, reduced: reducedMotion })
  const painter = createStreetPainter()

  lendStreetTimes(() => ({ stepMs: street.stepMs(), paintMs: painter.paintMs() }))

  return {
    director,
    life: createLife({ director, teamDesks, reduced: reducedMotion }),
    team,
    street,
    painter,
  }
}

export function disposeCrew(crew: Crew): void {
  lendStreetTimes(undefined)
  crew.life.dispose()
  crew.director.dispose()
  crew.team.dispose()
  crew.street.dispose()
  crew.painter.release()
}
