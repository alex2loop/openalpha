import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { OrphanExit, ReconcileReview } from '@/trading/features/order/types'
import type { VenueRef } from '@/trading/kernel/instrument'
import type { OpenExit } from '@/trading/kernel/venue/spot-adapter'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { liveExits } from '@/trading/features/order/resting'

type SweepDeps = Pick<OrderServiceDeps, 'logger' | 'resting' | 'venues'>

interface ExitLister {
  readonly venue: VenueRef
  readonly list: (signal: AbortSignal) => Promise<readonly OpenExit[]>
}

/** Absent `exits` means the venue could not be read, which is not the same answer as none. */
interface VenueExits {
  readonly venue: VenueRef
  readonly exits?: readonly OpenExit[]
}

/** Exits resting at a venue that no live row names. The exit tick reconciles from rows alone, so
 *  such an exit — a crash between the venue accepting it and the row landing, or anything older —
 *  is never checked, never trailed and never reported as fired. Report only: the invariant allows
 *  nothing but `/trade cancel` to take protection down, and this exit may be the only protection
 *  the position has. A venue that cannot be read is named instead of skipped, so a clean report
 *  never stands for a venue nobody asked. Runs under the write lock: an exit being placed is at
 *  the venue before its row exists, and would read as an orphan for that moment. */
export async function sweepOrphanExits(
  deps: SweepDeps,
  signal: AbortSignal
): Promise<Pick<ReconcileReview, 'orphanExits' | 'unreadExitVenues'>> {
  // Rows first: an exit that fills while the venues are read is still a row here, never an orphan.
  const tracked = new Set(
    (await liveExits(deps, signal)).map((row) => trackedKey(row.venue, row.exitClientId))
  )
  const reads = await Promise.all(
    listersOf(deps).map((lister) => readOpenExits(deps, lister, signal))
  )

  return {
    orphanExits: reads.flatMap((read) =>
      (read.exits ?? [])
        .filter((exit) => !tracked.has(trackedKey(read.venue, exit.exitClientId)))
        .map((exit) => toOrphan(read.venue, exit))
    ),
    unreadExitVenues: reads.filter((read) => read.exits === undefined).map((read) => read.venue),
  }
}

function listersOf(deps: SweepDeps): readonly ExitLister[] {
  return deps.venues.list().flatMap((venue) => {
    const list = venue.adapter?.listOpenExits

    return list === undefined ? [] : [{ venue: venue.manifest.id, list }]
  })
}

async function readOpenExits(
  deps: SweepDeps,
  lister: ExitLister,
  signal: AbortSignal
): Promise<VenueExits> {
  try {
    return { venue: lister.venue, exits: await lister.list(signal) }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('order.orphan_sweep_unreadable', {
      venue: lister.venue,
      err: formatErrForLog(err),
    })

    return { venue: lister.venue }
  }
}

function trackedKey(venue: VenueRef, exitClientId: string): string {
  return `${venue}:${exitClientId}`
}

function toOrphan(venue: VenueRef, exit: OpenExit): OrphanExit {
  return {
    venue,
    symbol: exit.symbol,
    exitId: exit.exitId,
    quantity: exit.size,
    ...(exit.takeProfit === undefined ? {} : { takeProfit: exit.takeProfit }),
    ...(exit.stopLoss === undefined ? {} : { stopLoss: exit.stopLoss }),
  }
}
