import type { LedgerTxn } from '@/trading/features/ledger/types'
import type { MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { isLevelKind } from '@/trading/kernel/instrument'

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
