import type { CostRates, DefaultVenues, FEE_ASSETS, TradingCosts } from '@/trading/kernel/config'
import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'

/** How far a recorded fee may sit from the configured rate before the confirmation says so. Loose
 *  enough to ignore a maker fill priced against a taker rate, which is two basis points of
 *  notional; tight enough to catch a stale tier or a mistyped figure. */
export const FEE_MISMATCH_TOLERANCE = 0.25

/** What a round trip costs where no venue prices the market. A flat haircut keeps a benchmark-only
 *  segment honest rather than exact; a priced venue supplies its own rate. */
const DEFAULT_ROUND_TRIP_FEE_FRACTION = 0.001

/** A venue that bills the money spent delivers the whole order, which is the assumption that makes
 *  a recorded quantity mean what it says. Only a venue declaring otherwise is treated otherwise. */
const DEFAULT_FEE_ASSET: (typeof FEE_ASSETS)[number] = 'quote'

/** What one round trip costs, as fractions of the amounts it moves. `sellRate` folds brokerage and
 *  any statutory tax together because a ledger row carries one fee, netted straight out of
 *  proceeds - the two can never be stored apart. */
export interface TradeCost {
  readonly buyRate: number
  readonly sellRate: number
  /** Which asset a buy fee is taken from. `quote` unless the venue says otherwise. */
  readonly feeAsset: (typeof FEE_ASSETS)[number]
}

export interface MarketCosts {
  readonly costs: TradingCosts
  readonly defaultVenues: DefaultVenues
}

export function resolveTradeCost(venue: VenueRef, costs: TradingCosts): TradeCost | undefined {
  const rates: CostRates | undefined = costs[venue]

  if (rates === undefined) {
    return undefined
  }

  return {
    buyRate: rates.buy,
    sellRate: rates.sell + (rates.sellTax ?? 0),
    feeAsset: rates.feeAsset ?? DEFAULT_FEE_ASSET,
  }
}

/** What a buy draws from cash per unit of its notional: the fee on top, and the price drift a
 *  market order may fill through. A fee billed in base coins comes out of the quantity and adds
 *  nothing here. The one answer for the order caps, the sizer and the rebalance plan, so a buy sized
 *  to the cash it has is one the cap on cash then admits. */
export function cashDrawMultiple(cost: TradeCost | undefined, priceDrift: number): number {
  const feeRate = cost?.feeAsset === 'quote' ? cost.buyRate : 0

  return (1 + priceDrift) * (1 + feeRate)
}

/** What entering and leaving costs together, against the amount entered. */
export function roundTripRate(cost: TradeCost): number {
  return cost.buyRate + cost.sellRate
}

/** The cost at the venue a market books to. The plan shown to the operator, the break-even floor
 *  and the outcome scorer all read this one answer, so a call is shown, held and graded on the
 *  same fees. */
export function marketTradeCost(config: MarketCosts, market: MarketRef): TradeCost | undefined {
  const venue = config.defaultVenues[market]

  return venue === undefined ? undefined : resolveTradeCost(venue, config.costs)
}

export function marketRoundTripRate(config: MarketCosts, market: MarketRef): number {
  const cost = marketTradeCost(config, market)

  return cost === undefined ? DEFAULT_ROUND_TRIP_FEE_FRACTION : roundTripRate(cost)
}

/** Where a prospective entry must trade for the round trip to come out flat. Buying N at E costs
 *  E*N*(1+b) and selling N at P returns P*N*(1-s), so the two meet at E(1+b)/(1-s). Both legs are
 *  estimates here because neither has been paid. */
export function costBreakevenPrice(entry: number, cost: TradeCost): number {
  return (entry * (1 + cost.buyRate)) / (1 - cost.sellRate)
}

/** Where a position already held must trade to come out flat. The entry fee is a recorded fact by
 *  now, so only the exit is estimated - re-deriving the buy leg from a rate would be needlessly
 *  approximate about a number the ledger stores. */
export function exitBreakevenPrice(unitCostGross: number, cost: TradeCost): number {
  return unitCostGross / (1 - cost.sellRate)
}

export function estimatedFee(notional: number, rate: number): number {
  return notional * rate
}

/** How far the fee actually charged sits from the one the rate implies, signed, or undefined when
 *  there is nothing to measure against. */
export function feeDivergence(actual: number, expected: number): number | undefined {
  if (!(expected > 0)) {
    return undefined
  }

  return (actual - expected) / expected
}
