import type { Locale } from '@/core/types/locale'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { ACCOUNTS_QUARTER_ROWS } from '@/trading/kernel/market/annual-accounts'
import { renderAccountsLines } from '@/trading/render/accounts'

const ACCOUNTS_HEADER = [
  'ANNUAL ACCOUNTS (final audited years, oldest first; then, where they run past the newest audited year, the last four quarters summed as one unaudited year, weigh it below an audit;',
  `then the ${ACCOUNTS_QUARTER_ROWS} newest quarters, newest first, each against the same quarter a year earlier: unaudited, a lone Q2 is not reviewed, and Q4 may carry the year-end audit adjustments.`,
  'Audited years can still move after the audit, and unaudited quarters more so: weigh a quarter as a reading, not a final figure.',
  'A one-off can sit inside revenue, so a margin jump that comes with a revenue jump may not repeat; a large non-core share means the quarter leaned on items outside the business.',
  'Reconcile the newest quarter with the audited year, and with the trailing sum when it is shown; say so when the trailing sum hides a turn.',
  'Core operating profit is gross profit less selling and admin, before interest; free cash flow is operating cash flow less capex; ROIC is core operating profit after tax over average equity plus net debt; dividends are cash paid, and a stock dividend never appears in them. A flag is an observation to weigh, not a verdict):',
].join(' ')

interface AccountsSectionOptions {
  readonly locale: Locale
  readonly currency: CurrencyCode
}

/** Absent for a market that keeps no accounts or a name never fetched: the section is optional
 *  narrative, and its absence says nothing about the business. */
export function accountsSection(
  result: SourceResult<AccountsHistory> | undefined,
  options: AccountsSectionOptions
): string {
  if (result?.kind !== 'available') {
    return ''
  }

  return [
    ACCOUNTS_HEADER,
    ...renderAccountsLines(options.locale, result.value, { currency: options.currency }),
  ].join('\n')
}
