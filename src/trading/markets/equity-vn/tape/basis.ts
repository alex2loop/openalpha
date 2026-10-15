import type { TradingDay } from '@/trading/kernel/instrument'
import type { FuturesBasis } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import { available, unavailable } from '@/trading/kernel/source/source-result'

interface BasisContract {
  readonly code: string
  readonly expiry?: TradingDay
}

interface BuildBasisInput {
  readonly future: readonly Candle[]
  readonly spot: readonly Candle[]
  readonly contract: BasisContract
  readonly provenance: readonly SourceProvenance[]
}

/** Intersect first, then take the newest **common** day. Carrying the last known future close
 *  forward against a newer spot close produces a basis for a day that never had one — and the
 *  basis is precisely the number a reader would act on. A missing overlap is `stale` (data we
 *  should have and don't), never `unsupported` (data this market cannot produce).
 *
 *  This is market data: it states what the futures market is paying relative to spot. Nothing here
 *  creates an order or a short position. */
export function buildFuturesBasis(input: BuildBasisInput): SourceResult<FuturesBasis> {
  const spotByDay = new Map<TradingDay, number>()

  for (const candle of input.spot) {
    if (isUsableClose(candle.close)) {
      spotByDay.set(candle.at, candle.close)
    }
  }

  const common = input.future
    .filter((candle) => isUsableClose(candle.close) && spotByDay.has(candle.at))
    .sort((a, b) => a.at.localeCompare(b.at))
  const newest = common[common.length - 1]
  const spotClose = newest === undefined ? undefined : spotByDay.get(newest.at)

  if (newest === undefined || spotClose === undefined) {
    return unavailable('stale', [])
  }

  const points = newest.close - spotClose

  return available(
    {
      asOf: newest.at,
      spot: spotClose,
      future: newest.close,
      basis: points,
      basisPct: points / spotClose,
      contractCode: input.contract.code,
      ...(input.contract.expiry === undefined ? {} : { expiry: input.contract.expiry }),
    },
    input.provenance
  )
}

function isUsableClose(close: number): boolean {
  return Number.isFinite(close) && close > 0
}
