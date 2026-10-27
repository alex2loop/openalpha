import { computed, type ReadonlySignal } from '@preact/signals'

import type { ActivityRowWire } from '@/app/server/wire/activity'
import type { RoomId } from '@/web/scene/types'
import { pageMinute } from '@/web/scene/clock/clock'
import { roomOfRun } from '@/web/scene/data/room-status'
import { todayRuns } from '@/web/scene/data/today-runs'
import { state } from '@/web/state/session'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'

const COMPLETED = 'completed'

/** What the meeting room's and the library's whiteboards say once the day's work is done: the
 *  ticker of the day's last finished debate and when it ended, and the questions the last finished
 *  research answered. A board with no such run today says nothing. */
export const finishedCaptions: ReadonlySignal<Partial<Record<RoomId, string>>> = computed(() => {
  const read = todayRuns.value
  const timeZone = state.value?.timeZone

  if (read === undefined || read.day !== pageMinute.value.day || timeZone === undefined) {
    return {}
  }

  // The rows come newest first, so the first match is the day's last.
  const finished = read.rows.filter((row) => row.outcome === COMPLETED)
  const meet = finished.map((row) => meetCaptionOf(row, timeZone)).find(isCaption)
  const lib = finished.map(libCaptionOf).find(isCaption)

  return {
    ...(meet === undefined ? {} : { meet }),
    ...(lib === undefined ? {} : { lib }),
  }
})

function meetCaptionOf(row: ActivityRowWire, timeZone: string): string | undefined {
  const ticker = row.tickers?.[0]

  return ticker === undefined || roomOfRun(row) !== 'meet'
    ? undefined
    : tr('ui.office.board.meetDone', { ticker, time: formatClock(row.endedAt, timeZone) })
}

function libCaptionOf(row: ActivityRowWire): string | undefined {
  return row.questions === undefined || roomOfRun(row) !== 'lib'
    ? undefined
    : tr('ui.office.board.libDone', { n: row.questions.done, total: row.questions.total })
}

function isCaption(caption: string | undefined): caption is string {
  return caption !== undefined
}
