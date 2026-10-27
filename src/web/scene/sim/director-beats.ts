import { effect, type ReadonlySignal } from '@preact/signals'

import type { BeatTarget } from '@/web/scene/sim/beats'
import type { People } from '@/web/scene/sim/people'
import type { ActorId } from '@/web/scene/types'
import type { onWireEvent } from '@/web/state/events'
import type { Run } from '@/web/state/live'
import { pageNow } from '@/web/scene/clock/clock'
import { ASSISTANT } from '@/web/scene/sim/actors/roster'
import { endTrip, startTrip } from '@/web/scene/sim/assistant'
import { subscribeBeats } from '@/web/scene/sim/beats'
import { actorsOfRun, playBeat, stampSheet } from '@/web/scene/sim/people'
import { TRAY_AT } from '@/web/scene/world/seats'
import { setCapped } from '@/web/state/capped-map'
import { reducedMotion } from '@/web/state/prefs'

// The runs whose start a finishing beat may ask for, newest kept.
const MAX_RUN_STARTS = 64

// The wire's one-shot beats over the people, each run's start kept a while past its end for the
// stretch after a long run. The returned function releases both.
export function beatsOf(
  deps: { readonly hub: typeof onWireEvent; readonly runs: ReadonlySignal<readonly Run[]> },
  people: People
): () => void {
  const starts = new Map<string, number>()
  const stopStarts = effect(() => {
    for (const run of deps.runs.value) {
      setCapped(starts, [run.runId, run.startedAt], MAX_RUN_STARTS)
    }
  })
  const offBeats = subscribeBeats(deps.hub, toBeatTarget(people, starts))

  return () => {
    stopStarts()
    offBeats()
    starts.clear()
  }
}

function toBeatTarget(people: People, starts: ReadonlyMap<string, number>): BeatTarget {
  return {
    actorsOfRun: (runId) => actorsOfRun(people, runId),
    deskActorOf: (requestId) =>
      people.desk.waits.get(requestId) ?? people.desk.answered.get(requestId),
    play: (actor, beat) => playBeat(people, actor, { ...beat, atMs: performance.now() }),
    sendToTray: (actor) => sendToTray(people, actor),
    stamp: (actor, action) => stampSheet(people, { actor, action }),
    startTrip: (runId, at) => {
      const ownRunId = people.wanted.get(ASSISTANT)?.runId
      const read = { runId, at, ...(ownRunId === undefined ? {} : { ownRunId }) }

      startTrip(people.walks, read, performance.now())
    },
    endTrip: (runId) => endTrip(people.walks, runId),
    pageNow,
    runStartedAt: (runId) => starts.get(runId),
  }
}

function sendToTray(people: People, actor: ActorId): void {
  const person = people.byId.get(actor)

  if (person !== undefined && !reducedMotion.value) {
    people.papers.launch(
      { floor: person.floor, from: person.walker.pos, to: TRAY_AT },
      performance.now()
    )
  }
}
