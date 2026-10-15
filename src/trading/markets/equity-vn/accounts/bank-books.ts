import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { AccountLines, AnnualAccounts } from '@/trading/kernel/market/annual-accounts'
import { growthOf, ratioOf } from '@/trading/markets/equity-vn/accounts/lines'
import { finalReports } from '@/trading/markets/equity-vn/accounts/score'
import { VN_ACCOUNTS_POLICY } from '@/trading/markets/equity-vn/factor-policy'

type BankReadings = { readonly [K in Exclude<keyof BankBooks, 'fiscalYear'>]: number | undefined }

/** A bank's loan book on its final report. Information only: it never sells and never scores. */
export interface BankBooks {
  readonly fiscalYear: number
  /** Groups 3-5 over customer loans, a fraction. */
  readonly badDebtRatio?: number
  /** Group 2 over customer loans, a fraction. */
  readonly watchListRatio?: number
  /** Loan-loss reserve over groups 3-5, a multiple. */
  readonly provisionCover?: number
  /** Current deposits over customer deposits, a fraction. */
  readonly casaShare?: number
  readonly badDebtGrowth?: number
  readonly loanGrowth?: number
}

export function readBankBooks(
  history: readonly AnnualAccounts[],
  asOf: TradingDay
): BankBooks | undefined {
  const reports = finalReports(history, asOf)

  if (reports === undefined) {
    return undefined
  }

  const { current, prior, fiscalYear } = reports
  const badDebt = badDebtOf(current)
  const readings = {
    badDebtRatio: ratioOf(badDebt, current.customerLoans),
    watchListRatio: ratioOf(current.watchListLoans, current.customerLoans),
    provisionCover: ratioOf(current.loanLossReserve, badDebt),
    casaShare: ratioOf(current.currentDeposits, current.customerDeposits),
    badDebtGrowth: growthOf(badDebt, badDebtOf(prior)),
    loanGrowth: growthOf(current.customerLoans, prior?.customerLoans),
  }

  return isEmptyReading(readings) ? undefined : { fiscalYear, ...definedReadings(readings) }
}

/** Fires on bad debt growing in dong whatever the ratio did: a ratio that fell on fast lending and
 *  one that rose both deserve the sentence. */
export function bankBooksCaveats(books: BankBooks | undefined): readonly Caveat[] {
  const badDebtGrowth = books?.badDebtGrowth
  const loanGrowth = books?.loanGrowth

  if (
    books === undefined ||
    badDebtGrowth === undefined ||
    loanGrowth === undefined ||
    badDebtGrowth < VN_ACCOUNTS_POLICY.bankBadDebtGrowthAt
  ) {
    return []
  }

  return [
    {
      code: 'factor.bad-debt-rising',
      detail: { fiscalYear: String(books.fiscalYear), badDebtGrowth, loanGrowth },
    },
  ]
}

/** Groups 3-5. Absent when any group is, rather than a partial sum read as the whole. */
function badDebtOf(lines: AccountLines | undefined): number | undefined {
  if (
    lines?.substandardLoans === undefined ||
    lines.doubtfulLoans === undefined ||
    lines.lossLoans === undefined
  ) {
    return undefined
  }

  return lines.substandardLoans + lines.doubtfulLoans + lines.lossLoans
}

/** Growth alone prints nothing, so a reading without a single ratio is no reading. */
function isEmptyReading(readings: BankReadings): boolean {
  return (
    readings.badDebtRatio === undefined &&
    readings.watchListRatio === undefined &&
    readings.provisionCover === undefined &&
    readings.casaShare === undefined
  )
}

function definedReadings(readings: BankReadings): Omit<BankBooks, 'fiscalYear'> {
  const { badDebtRatio, watchListRatio, provisionCover, casaShare, badDebtGrowth, loanGrowth } =
    readings

  return {
    ...(badDebtRatio === undefined ? {} : { badDebtRatio }),
    ...(watchListRatio === undefined ? {} : { watchListRatio }),
    ...(provisionCover === undefined ? {} : { provisionCover }),
    ...(casaShare === undefined ? {} : { casaShare }),
    ...(badDebtGrowth === undefined ? {} : { badDebtGrowth }),
    ...(loanGrowth === undefined ? {} : { loanGrowth }),
  }
}
