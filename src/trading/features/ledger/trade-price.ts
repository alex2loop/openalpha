import type { FillSource, LedgerTxn } from '@/trading/features/ledger/types'
import type { TypedPriceDeps } from '@/trading/features/market-data/reads/typed-price'
import type { TradingConfig } from '@/trading/kernel/config'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { MarketRegistry } from '@/trading/markets/types'
import { assertTypedPrice } from '@/trading/features/market-data/reads/typed-price'

interface TradePriceDeps extends TypedPriceDeps {
  readonly markets: MarketRegistry
  readonly config: Pick<TradingConfig, 'typedPrices'>
}

/** A price the venue filled is its own figure, never a typed one, so only the board scale is
 *  checked for it. */
export async function assertTradePrice(
  deps: TradePriceDeps,
  check: {
    readonly transaction: LedgerTxn
    readonly typedPrice: TypedPrice | undefined
    readonly fillSource: FillSource | undefined
    readonly signal: AbortSignal
  }
): Promise<void> {
  const { transaction, fillSource } = check

  if (!('unitPrice' in transaction)) {
    return
  }

  // A rights issue is priced by the issuer, often at par far under the market, never by a trade.
  const typedPrice =
    transaction.kind === 'rights' || (fillSource !== undefined && fillSource !== 'operator')
      ? undefined
      : check.typedPrice
  const market = deps.markets.find(transaction.instrument.market)

  // A row is validated against the registry, so its market is always found.
  if (market === null) {
    return
  }

  await assertTypedPrice(deps, {
    instrument: transaction.instrument,
    market,
    price: transaction.unitPrice,
    day: transaction.at,
    typedPrice,
    confirmMultiple: deps.config.typedPrices.confirmMultiple,
    signal: check.signal,
  })
}
