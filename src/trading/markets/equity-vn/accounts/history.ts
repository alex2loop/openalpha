import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AccountsHistory,
  AnnualAccounts,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import { toAccountsHistoryCore } from '@/trading/markets/accounts-history'
import { accountsFlags } from '@/trading/markets/equity-vn/accounts/flags'
import { quarterGapCaveats } from '@/trading/markets/equity-vn/accounts/quarter-gaps'
import { finalFiscalYear } from '@/trading/markets/equity-vn/accounts/score'
import { VN_ACCOUNTS_POLICY } from '@/trading/markets/equity-vn/factor-policy'
import { VN_SHARE_PAR_VND } from '@/trading/markets/equity-vn/policy'

interface HistoryInput {
  readonly instrument: InstrumentRef
  readonly reports: readonly AnnualAccounts[]
  readonly quarters: readonly QuarterlyAccounts[]
  readonly asOf: TradingDay
  /** A developer's cash swings with handovers, so the cash-timing flags stay silent for it. */
  readonly readingOnly: boolean
}

export function toAccountsHistory(input: HistoryInput): AccountsHistory | undefined {
  return toAccountsHistoryCore({
    instrument: input.instrument,
    reports: input.reports,
    quarters: input.quarters,
    asOf: input.asOf,
    trendYears: VN_ACCOUNTS_POLICY.trendYears,
    shareCountOf: sharesOf,
    finalYearOf: finalFiscalYear,
    flagsOf: (parts) => [
      ...accountsFlags({ ...parts, readingOnly: input.readingOnly }),
      ...quarterGapCaveats(input.quarters, input.asOf),
    ],
  })
}

function sharesOf(lines: AccountLines): number | undefined {
  const capital = lines.commonShareCapital

  return capital === undefined || capital <= 0 ? undefined : capital / VN_SHARE_PAR_VND
}
