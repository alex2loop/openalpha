import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { UsBoardCache } from '@/trading/markets/equity-us/board'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { toAccountsHistoryCore } from '@/trading/markets/accounts-history'
import { newestReport } from '@/trading/markets/equity-us/fundamentals'
import { US_TREND_YEARS } from '@/trading/markets/equity-us/policy'

/** Read off the board pass, so asking costs no provider read. A name whose accounts were never
 *  fetched (no SEC contact, no machine-readable filing, neither on the board nor followed) has
 *  none to read: absent, never an empty history. No flags: the observation lines are VN's own
 *  rules, and accounts here inform and never gate. */
export async function runUsAccounts(
  board: UsBoardCache,
  request: InstrumentRequest
): Promise<SourceResult<AccountsHistory>> {
  const { accounts } = await board.get(request.asOf, request.signal)
  const reports = accounts.get(request.instrument.ticker)
  const history =
    reports === undefined
      ? undefined
      : toAccountsHistoryCore({
          instrument: request.instrument,
          reports,
          quarters: [],
          asOf: request.asOf,
          trendYears: US_TREND_YEARS,
          shareCountOf: (lines) => lines.sharesOutstanding,
          finalYearOf: (asOf, filed) => newestReport(filed, asOf)?.fiscalYear ?? 0,
          flagsOf: () => [],
        })

  if (history === undefined) {
    return unavailable('empty', [])
  }

  return available(history, [
    { sourceId: history.sourceId, fetchedAt: history.fetchedAt, freshness: 'cached' },
  ])
}
