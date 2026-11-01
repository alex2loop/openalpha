import { computed, type ReadonlySignal } from '@preact/signals'

import type { ActivityRowWire } from '@/app/server/wire/activity'
import { pageMinute } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { roomOfRun } from '@/web/scene/data/room-status'
import { todayRuns } from '@/web/scene/data/today-runs'
import { moment } from '@/web/scene/sim/rhythm'
import { propsOn } from '@/web/scene/world/props'
import { seedOf } from '@/web/scene/world/rng'
import { MS_PER_MINUTE } from '@/web/text/time-units'

/** A bin holds at most this many crumpled sheets. */
export const BIN_SLOTS = 3

const COMPLETED = 'completed'
const NO_FILL: ReadonlyMap<string, number> = new Map()
// The office floor's work desks with a bin beside them: the library's.
const BIN_ROOM = 'lib'
const BIN_DESKS: readonly string[] = propsOn('office')
  .filter((prop) => prop.kind === 'desk' && prop.room === BIN_ROOM)
  .map((prop) => prop.id)

/** How full the desk bins are: a crumpled sheet for each of today's finished runs worked at that
 *  desk, up to `BIN_SLOTS`. `byDesk` keys the library desks by prop id (each run the library did
 *  lands at one of its desks), `byAgent` the own agents' desks by agent id. On a trading day the
 *  cleaner empties every bin when her shift starts, so a run that ended before then is gone. */
export interface BinFill {
  readonly byDesk: ReadonlyMap<string, number>
  readonly byAgent: ReadonlyMap<string, number>
}

export const binFill: ReadonlySignal<BinFill> = computed(() => {
  const read = todayRuns.value
  const emptiedAt = emptiedAtOf()
  const byDesk = new Map<string, number>()
  const byAgent = new Map<string, number>()

  for (const row of read?.rows ?? []) {
    if (row.outcome === COMPLETED && row.endedAt > emptiedAt && row.parentRunId === undefined) {
      addTo(byAgent, row.agentId)
      addTo(byDesk, deskOf(row))
    }
  }

  return {
    byDesk: byDesk.size === 0 ? NO_FILL : byDesk,
    byAgent: byAgent.size === 0 ? NO_FILL : byAgent,
  }
})

// The instant the cleaner's shift started today on the page clock; before it, or on a day the
// market is shut, none.
function emptiedAtOf(): number {
  const clock = pageMinute.value
  const shiftStart = regionPack.value.hours.crew.cleaner[0]?.[0]

  if (!moment.value.tradingDay || shiftStart === undefined || clock.minute < shiftStart) {
    return Number.NEGATIVE_INFINITY
  }

  return clock.at - (clock.minute - shiftStart) * MS_PER_MINUTE
}

// A library run lands at one of its desks, the same one every read.
function deskOf(row: ActivityRowWire): string | undefined {
  return roomOfRun(row) === BIN_ROOM && BIN_DESKS.length > 0
    ? BIN_DESKS[seedOf(row.runId) % BIN_DESKS.length]
    : undefined
}

function addTo(fill: Map<string, number>, key: string | undefined): void {
  if (key !== undefined) {
    fill.set(key, Math.min(BIN_SLOTS, (fill.get(key) ?? 0) + 1))
  }
}
