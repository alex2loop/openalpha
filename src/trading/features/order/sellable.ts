import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { InstrumentRef, VenueRef } from '@/trading/kernel/instrument'
import {
  exitsByPosition,
  guardedQuantityOf,
  liveExits,
  restingOn,
} from '@/trading/features/order/resting'
import { isSameInstrument } from '@/trading/kernel/instrument'

/** What one venue holds of an instrument that a sell may actually reach. `settled` is the parcel the
 *  market has delivered; `guarded` is the share of it a resting exit has frozen at the exchange. */
export interface SellableQuantity {
  readonly settled: number
  readonly guarded: number
}

interface SellableInput {
  readonly instrument: InstrumentRef
  readonly now: number
  readonly signal: AbortSignal
}

/** Per venue, for one instrument. Unsettled stock the exchange will not release and coins a resting
 *  exit has frozen are both quantity the book holds and a sell cannot move, so the route and the
 *  size are measured against the same number rather than against the position. */
export async function resolveSellableQuantities(
  deps: Pick<OrderServiceDeps, 'resting' | 'portfolio'>,
  input: SellableInput
): Promise<ReadonlyMap<VenueRef, SellableQuantity>> {
  const [positions, exits] = await Promise.all([
    deps.portfolio.positionsAt({ now: input.now, signal: input.signal }),
    liveExits(deps, input.signal),
  ])
  const resting = exitsByPosition(exits)
  const sellable = new Map<VenueRef, SellableQuantity>()

  for (const position of positions) {
    if (!isSameInstrument(position.instrument, input.instrument)) {
      continue
    }

    sellable.set(position.venue, {
      settled: position.settledQuantity,
      guarded: guardedQuantityOf(restingOn(resting, position)),
    })
  }

  return sellable
}

export function sellableQuantityOf(quantity: SellableQuantity): number {
  return Math.max(quantity.settled - quantity.guarded, 0)
}
