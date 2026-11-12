import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { closestName } from '@/core/utils/text'

const NOT_LISTED = 'market.ticker-not-listed'

export interface ListedNameDeps {
  readonly markets: MarketRegistry
  readonly marketDataStore: Pick<MarketDataStore, 'listInstruments'>
}

/** A name no stored list holds, held for the operator to say it is a real trade. The closest stored
 *  name is offered when there is one. */
export class InstrumentUnlistedError extends ValidationError {
  constructor(instrument: InstrumentRef, near: string | undefined) {
    super(
      `${instrument.ticker} is not in the stored ${instrument.market} listing; ask the operator ` +
        'to confirm the name, then call again with priceConfirmed true',
      {
        key: near === undefined ? 'errors.instrumentUnlisted' : 'errors.instrumentUnlistedNear',
        params: {
          ticker: instrument.ticker,
          market: { key: `trading.market.${instrument.market}` },
          ...(near === undefined ? {} : { near }),
        },
      }
    )
  }
}

/** Refuses a name the market's stored listing checked and missed. Stored lists only, no network:
 *  a market that was never refreshed, one that fetches its names and one whose list could not be
 *  read say nothing about the name, so it passes. A halted or delisted name is still on the list. */
export async function assertInstrumentListed(
  deps: ListedNameDeps,
  request: { readonly instrument: InstrumentRef; readonly signal: AbortSignal }
): Promise<void> {
  const { instrument, signal } = request

  if (deps.markets.find(instrument.market)?.manifest.detection !== 'stored') {
    return
  }

  const resolution = await deps.markets.resolve({
    ticker: instrument.ticker,
    market: instrument.market,
    detection: 'stored',
    signal,
  })

  if (
    resolution.kind !== 'unsupported' ||
    !resolution.caveats.some((caveat) => caveat.code === NOT_LISTED)
  ) {
    return
  }

  const listed = await deps.marketDataStore.listInstruments({ market: instrument.market, signal })

  throw new InstrumentUnlistedError(
    instrument,
    closestName(
      instrument.ticker,
      listed.map((record) => record.instrument.ticker)
    )
  )
}
