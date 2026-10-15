import type { LedgerTxnKind } from '@/trading/features/ledger/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Market } from '@/trading/markets/types'
import { advanceObservedSessions, type SessionReader } from '@/trading/features/market-data/resolve'

interface SettlementOptions {
  readonly transaction: { readonly kind: LedgerTxnKind; readonly at: TradingDay }
  readonly market: Market
  readonly signal: AbortSignal
}

/** Calculated once, when the transaction is recorded, and then persisted: recomputing it later
 *  against different history would silently move money that already cleared.
 *
 *  A backdated trade settles over the sessions the market actually ran; a trade dated today runs
 *  out of observed bars and projects the remainder, because the days it settles into have not
 *  traded yet.
 *
 *  Only a trade reaches the calendar. Every other kind returns before it, so a caller cannot make
 *  a deposit drift off its own day by passing a stray `settlementSessions`. */
export function resolveSettlementDay(
  sessions: SessionReader,
  options: SettlementOptions
): Promise<TradingDay> {
  const { transaction, market } = options

  switch (transaction.kind) {
    // A split changes the share count on the ex-date; there is no cash to clear.
    case 'split':
    case 'distribution':
    // Cash movements have no market and no calendar to consult.
    case 'deposit':
    case 'withdrawal':
    case 'fee':
    case 'loss':
    // `at` is a cash dividend's pay date, not a trade date, so adding T+N would invent a lag the
    // broker never imposes.
    case 'dividend':
      return Promise.resolve(transaction.at)
    default:
      return advanceObservedSessions(sessions, market, {
        fromDay: transaction.at,
        count: market.manifest.settlementSessions,
        signal: options.signal,
      })
  }
}
