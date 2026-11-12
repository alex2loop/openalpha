import type { FillSource, LedgerTxn } from '@/trading/features/ledger/types'
import type { ListedNameDeps } from '@/trading/features/market-data/reads/listed-name'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { assertInstrumentListed } from '@/trading/features/market-data/reads/listed-name'
import { isLevelKind, isSameInstrument } from '@/trading/kernel/instrument'

/** A row books what the operator holds, and nothing holds an index or a futures contract. Only a
 *  market that detects from its stored universe is asked, so a row never waits on a provider; a name
 *  the universe cannot place passes, because the book is the operator's word. */
export async function assertHoldable(
  deps: { readonly markets: MarketRegistry },
  check: { readonly transaction: LedgerTxn; readonly signal: AbortSignal }
): Promise<void> {
  const { transaction } = check

  if (!('instrument' in transaction)) {
    return
  }

  const { instrument } = transaction
  const resolution = await deps.markets.resolve({
    ticker: instrument.ticker,
    market: instrument.market,
    detection: 'stored',
    signal: check.signal,
  })

  if (resolution.kind === 'resolved' && isLevelKind(resolution.instrumentKind)) {
    throw new ValidationError(`${instrument.ticker} is a level and cannot be held`, {
      key: 'errors.ledgerLevelKind',
      params: { ticker: instrument.ticker },
    })
  }
}

/** A name no stored list holds waits for the operator's yes, which is the same `confirmed` that
 *  accepts a far price. Asked only where the price is (`typedPrice: unconfirmed`) and only of a
 *  request that asks (`requiresListed`): a venue's fill proved the name itself, so only a row whose
 *  figures the operator typed is held. An edit asks only about a name it newly puts on the row, so a
 *  delisted holding keeps its price and day correctable. */
export async function assertNameListed(
  deps: ListedNameDeps,
  check: {
    readonly transaction: LedgerTxn
    readonly previous?: LedgerTxn | undefined
    readonly fillSource: FillSource | undefined
    readonly request: {
      readonly requiresListed?: true
      readonly typedPrice?: TypedPrice
      readonly signal: AbortSignal
    }
  }
): Promise<void> {
  const { transaction, previous, fillSource, request } = check

  if (
    request.requiresListed !== true ||
    request.typedPrice !== 'unconfirmed' ||
    (fillSource !== undefined && fillSource !== 'operator') ||
    !('instrument' in transaction)
  ) {
    return
  }

  const { instrument } = transaction
  const isKept =
    previous !== undefined &&
    'instrument' in previous &&
    isSameInstrument(previous.instrument, instrument)

  if (isKept) {
    return
  }

  await assertInstrumentListed(deps, { instrument, signal: request.signal })
}
