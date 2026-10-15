import type { Locale } from '@/core/types/locale'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { renderAccountsLines } from '@/trading/render/accounts'

const ACCOUNTS_HEADER =
  'ANNUAL ACCOUNTS (final audited years, oldest first; then, where they run past the newest audited year, the last four quarters summed as one unaudited year, weigh it below an audit; Core operating profit is gross profit less selling and admin, before interest; free cash flow is operating cash flow less capex; ROIC is core operating profit after tax over average equity plus net debt; dividends are cash paid, and a stock dividend never appears in them. A flag is an observation to weigh, not a verdict):'

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
