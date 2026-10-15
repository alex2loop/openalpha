import type { BriefService } from '@/trading/features/brief/types'

interface BriefOperationDeps {
  readonly briefs: BriefService
  readonly batchSize: number
}

/** No cursor: brief delivery pages by claiming a lease, and a claimed row leaves the due set until
 *  its lease expires or it is resolved. Lease expiry is the starvation guard, so there is no scan
 *  position to carry between ticks. */
export function createBriefTick(deps: BriefOperationDeps): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    await deps.briefs.deliverDue({ now: Date.now(), batchSize: deps.batchSize, signal })
  }
}
