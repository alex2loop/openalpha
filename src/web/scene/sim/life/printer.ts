import type { ActivityResponse } from '@/app/server/wire/activity'
import type { ClockParts } from '@/web/text/time'
import { todayRuns } from '@/web/scene/data/today-runs'
import { setCapped } from '@/web/state/capped-map'

// The tray holds at most this many sheets; a day's reports past it leave the stack as it is.
const MAX_SHEETS = 6
const MAX_COUNTED_RUNS = 64
const COMPLETED = 'completed'
// The runs that deliver a report: a research run, and the morning brief itself (not its steps).
const REPORT_NAMES: ReadonlySet<string> = new Set(['research', 'brief'])

/** The printer's out-tray: one sheet for each report delivered today, up to `MAX_SHEETS`, and when
 *  the newest came out (`feedAt`, a `performance.now()` instant; absent for sheets laid from the
 *  day's read, which are already on the stack). Cleared when the page day turns. */
export interface PrintTray {
  day: string | undefined
  count: number
  feedAt: number | undefined
  readonly counted: Map<string, true>
  seeded: ActivityResponse | undefined
}

export function createPrintTray(): PrintTray {
  return { day: undefined, count: 0, feedAt: undefined, counted: new Map(), seeded: undefined }
}

/** A run that just finished: a sheet slides out if it delivered a report not yet on the tray. */
export function feedReport(
  tray: PrintTray,
  run: { readonly runId: string; readonly name: string | undefined; readonly outcome: string }
): void {
  if (run.name !== undefined && addSheet(tray, { ...run, name: run.name })) {
    tray.feedAt = performance.now()
  }
}

/** Turns the tray's day with the page clock and lays a sheet for each of today's reports the
 *  day's read lists, once per read. */
export function stepPrintTray(tray: PrintTray, clock: ClockParts): void {
  if (tray.day !== clock.day) {
    tray.day = clock.day
    tray.count = 0
    tray.feedAt = undefined
    tray.counted.clear()
    tray.seeded = undefined
  }

  const read = todayRuns.value

  if (read === undefined || read === tray.seeded || read.day !== tray.day) {
    return
  }

  tray.seeded = read

  for (const row of read.rows) {
    if (row.parentRunId === undefined) {
      addSheet(tray, row)
    }
  }
}

// True when the run is a completed report not counted yet; the stack grows up to its cap.
function addSheet(
  tray: PrintTray,
  run: { readonly runId: string; readonly name: string; readonly outcome: string }
): boolean {
  if (run.outcome !== COMPLETED || !REPORT_NAMES.has(run.name) || tray.counted.has(run.runId)) {
    return false
  }

  setCapped(tray.counted, [run.runId, true], MAX_COUNTED_RUNS)
  tray.count = Math.min(MAX_SHEETS, tray.count + 1)

  return true
}
