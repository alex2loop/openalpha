import { computed, type ReadonlySignal } from '@preact/signals'

import type { RoomId } from '@/web/scene/types'
import { finishedCaptions } from '@/web/scene/data/board-results'
import { debateLine, questionLine, roomStatus } from '@/web/scene/data/room-status'
import { homePhase, isClosedPhase } from '@/web/scene/sim/rhythm'

/** What the meeting room's and the library's whiteboards say: the live run's step while one counts
 *  its steps there, else, once the home market has shut for the day, the day's finished result. */
export const boardCaptions: ReadonlySignal<Partial<Record<RoomId, string>>> = computed(() => {
  const status = roomStatus.value
  const done = isClosedPhase(homePhase.value) ? finishedCaptions.value : {}
  const meet = debateLine(status.get('meet')?.runs[0]) ?? done.meet
  const lib = questionLine(status.get('lib')?.runs[0]) ?? done.lib

  return {
    ...(meet === undefined ? {} : { meet }),
    ...(lib === undefined ? {} : { lib }),
  }
})
