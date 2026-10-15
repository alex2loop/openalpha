import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AccountsWarningSign,
  AnnualAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import { parseIsoDay } from '@/core/utils/time'
import { ACCOUNTS_WARNING_SIGNS } from '@/trading/kernel/market/annual-accounts'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { annualReportDeadline } from '@/trading/markets/disclosure-calendar'
import { ratioOf } from '@/trading/markets/equity-vn/accounts/lines'
import { VN_ACCOUNTS_POLICY } from '@/trading/markets/equity-vn/factor-policy'
import { CAVEAT_SUBJECT_SEPARATOR } from '@/trading/render/format'

/** Beneish (1999), the eight-variable model. The two indices that lower the score when they rise
 *  are weighted here and never named as a warning sign. */
const M_SCORE_INTERCEPT = -4.84
const M_SCORE_WEIGHTS = Object.freeze({
  receivables: 0.92,
  margin: 0.528,
  'asset-quality': 0.404,
  'sales-growth': 0.892,
  depreciation: 0.115,
  accruals: 4.679,
  overheads: -0.172,
  leverage: -0.327,
} as const)
/** Beneish (1999) Table 2, the manipulators' mean of each named index. A tripped score names the
 *  indices sitting above it, which is what makes the line say why rather than only that. */
const WARNING_SIGN_MEANS = Object.freeze({
  receivables: 1.465,
  margin: 1.193,
  'asset-quality': 1.254,
  'sales-growth': 1.607,
  depreciation: 1.077,
  accruals: 0.031,
} as const satisfies Readonly<Record<AccountsWarningSign, number>>)

type PiotroskiFigures = Required<
  Pick<
    AccountLines,
    | 'totalAssets'
    | 'currentAssets'
    | 'currentLiabilities'
    | 'longTermDebt'
    | 'netRevenue'
    | 'grossProfit'
    | 'netProfitToParent'
    | 'operatingCashFlow'
    | 'shareIssueProceeds'
  >
>

interface BeneishFigures extends PiotroskiFigures {
  readonly tradeReceivables: number
  readonly netFixedAssets: number
  readonly depreciation: number
  readonly sellingAndAdmin: number
}

interface MScoreRead {
  readonly value: number
  readonly signs: Readonly<Record<AccountsWarningSign, number>>
}

interface FinalReports {
  readonly fiscalYear: number
  readonly current: AccountLines
  readonly prior?: AccountLines
  readonly older?: AccountLines
}

export interface AccountsReading {
  /** Piotroski checks passed, 0 to 9. */
  readonly score: number
  readonly fiscalYear: number
  /** Absent where a line the model needs was not published. */
  readonly mScore?: number
  /** Empty unless the M-score tripped. */
  readonly warningSigns: readonly AccountsWarningSign[]
  /** Whether the report may decide a long holding's thesis sale; a reading-only sector's prints. */
  readonly decisive: boolean
}

/** Who the refresh fetches: a bank too, for its loan book, though it is never scored. */
export function isAccountsFetched(record: Pick<InstrumentRecord, 'kind' | 'sector'>): boolean {
  return isEquityOutside(record, VN_ACCOUNTS_POLICY.unfetchedSectors)
}

/** Who is scored. A name with no sector is read: a financial that slipped through files under other
 *  codes, so its reports carry no line and it abstains. */
export function isAccountsCovered(record: Pick<InstrumentRecord, 'kind' | 'sector'>): boolean {
  return isEquityOutside(record, VN_ACCOUNTS_POLICY.unscoredSectors)
}

/** Whether this name's report may decide a long holding's thesis sale. */
export function isAccountsDecisive(record: Pick<InstrumentRecord, 'sector'>): boolean {
  return (
    record.sector === undefined || !VN_ACCOUNTS_POLICY.readingOnlySectors.includes(record.sector)
  )
}

function isEquityOutside(
  record: Pick<InstrumentRecord, 'kind' | 'sector'>,
  sectors: readonly string[]
): boolean {
  return (
    record.kind === 'equity' && (record.sector === undefined || !sectors.includes(record.sector))
  )
}

/** Who is scored and how its report may act: a reading-only sector's prints but decides nothing. */
export function scoreNameAccounts(
  record: Pick<InstrumentRecord, 'kind' | 'sector'>,
  reports: readonly AnnualAccounts[],
  asOf: TradingDay
): AccountsReading | undefined {
  if (!isAccountsCovered(record)) {
    return undefined
  }

  const reading = scoreAccounts(reports, asOf)

  return reading === undefined ? undefined : { ...reading, decisive: isAccountsDecisive(record) }
}

export function isAccountsWeak(reading: AccountsReading): boolean {
  return reading.score <= VN_ACCOUNTS_POLICY.weakAtScore
}

export function accountsMetrics(reading: AccountsReading | undefined): readonly FactorMetric[] {
  return reading === undefined ? [] : [{ id: 'accounts-score', value: reading.score }]
}

/** Information only: neither caveat moves conviction. */
export function accountsCaveats(reading: AccountsReading | undefined): readonly Caveat[] {
  if (reading === undefined) {
    return []
  }

  const fiscalYear = String(reading.fiscalYear)
  const weakening: readonly Caveat[] = isAccountsWeak(reading)
    ? [
        {
          code: reading.decisive
            ? 'factor.accounts-weakening'
            : 'factor.accounts-weakening-reading',
          detail: { score: reading.score, fiscalYear },
        },
      ]
    : []
  const signs = reading.warningSigns.join(CAVEAT_SUBJECT_SEPARATOR)
  const warnings: readonly Caveat[] =
    signs.length === 0
      ? []
      : [{ code: 'factor.accounts-warning-signs', detail: { fiscalYear, signs } }]

  return [...weakening, ...warnings]
}

/** The newest fiscal year whose audit window has closed on `asOf`. Assumes a 31 December year end,
 *  which is what the statutory calendar is written for. */
export function finalFiscalYear(asOf: TradingDay): number {
  const lastYear = Number(asOf.slice(0, 4)) - 1

  return asOf >= finalOnOf(lastYear) ? lastYear : lastYear - 1
}

/** Whether the stored copy of the year now read as final was fetched before it became final. The
 *  provider updates the row in place, so a copy taken inside the audit window may still hold the
 *  unaudited fourth quarter, and the refresh asks for it again once rather than wait out its
 *  cadence. */
export function isFetchedBeforeFinal(
  history: readonly AnnualAccounts[],
  asOf: TradingDay
): boolean {
  const fiscalYear = finalFiscalYear(asOf)
  const report = history.find((entry) => entry.fiscalYear === fiscalYear)
  const finalAt = parseIsoDay(finalOnOf(fiscalYear))

  return report !== undefined && finalAt !== undefined && report.fetchedAt < finalAt
}

function finalOnOf(fiscalYear: number): TradingDay {
  return shiftCalendarDay(annualReportDeadline(fiscalYear), VN_ACCOUNTS_POLICY.finalGraceDays)
}

/** Point in time: the final year, and each of the two before it only if published on or before
 *  `asOf`. Shared so every reader of a report picks the same year. */
export function finalReports(
  history: readonly AnnualAccounts[],
  asOf: TradingDay
): FinalReports | undefined {
  const fiscalYear = finalFiscalYear(asOf)
  const current = reportOf(history, fiscalYear, asOf)
  const prior = reportOf(history, fiscalYear - 1, asOf)
  const older = reportOf(history, fiscalYear - 2, asOf)

  if (current === undefined) {
    return undefined
  }

  return {
    fiscalYear,
    current,
    ...(prior === undefined ? {} : { prior }),
    ...(older === undefined ? {} : { older }),
  }
}

/** The year before last supplies the start-of-year assets of the prior year. No partial scores. */
export function scoreAccounts(
  history: readonly AnnualAccounts[],
  asOf: TradingDay
): Omit<AccountsReading, 'decisive'> | undefined {
  const reports = finalReports(history, asOf)
  const prior = reports?.prior
  const older = reports?.older

  if (reports === undefined || prior === undefined || older === undefined) {
    return undefined
  }

  const score = piotroskiScore(reports.current, prior, older.totalAssets)

  if (score === undefined) {
    return undefined
  }

  const mScore = beneishScore(reports.current, prior)

  return {
    score,
    fiscalYear: reports.fiscalYear,
    ...(mScore === undefined ? {} : { mScore: mScore.value }),
    warningSigns: mScore === undefined ? [] : warningSignsOf(mScore),
  }
}

function reportOf(
  history: readonly AnnualAccounts[],
  fiscalYear: number,
  asOf: TradingDay
): AccountLines | undefined {
  return history.find((report) => report.fiscalYear === fiscalYear && report.publishedOn <= asOf)
    ?.lines
}

/** Piotroski (2000) Table 1. Check seven reads cash raised, not the share count: VN issuers pay
 *  stock dividends and bonus shares routinely, which raise the count without raising capital. */
function piotroskiScore(
  current: AccountLines,
  prior: AccountLines,
  olderAssets: number | undefined
): number | undefined {
  const now = piotroskiFiguresOf(current)
  const before = piotroskiFiguresOf(prior)

  if (now === undefined || before === undefined || olderAssets === undefined || olderAssets <= 0) {
    return undefined
  }

  const returnOnAssets = now.netProfitToParent / before.totalAssets
  const checks = [
    returnOnAssets > 0,
    now.operatingCashFlow > 0,
    returnOnAssets > before.netProfitToParent / olderAssets,
    now.operatingCashFlow > now.netProfitToParent,
    isLeverageFalling(now, before, olderAssets),
    now.currentAssets / now.currentLiabilities > before.currentAssets / before.currentLiabilities,
    now.shareIssueProceeds <= before.totalAssets * VN_ACCOUNTS_POLICY.immaterialIssueShare,
    now.grossProfit / now.netRevenue > before.grossProfit / before.netRevenue,
    now.netRevenue / before.totalAssets > before.netRevenue / olderAssets,
  ]

  return checks.filter(Boolean).length
}

/** On average assets. A company carrying no long-term debt in either year has not levered up. */
function isLeverageFalling(
  now: PiotroskiFigures,
  before: PiotroskiFigures,
  olderAssets: number
): boolean {
  if (now.longTermDebt === 0 && before.longTermDebt === 0) {
    return true
  }

  return (
    now.longTermDebt / ((before.totalAssets + now.totalAssets) / 2) <
    before.longTermDebt / ((olderAssets + before.totalAssets) / 2)
  )
}

function piotroskiFiguresOf(lines: AccountLines): PiotroskiFigures | undefined {
  const {
    totalAssets,
    currentAssets,
    currentLiabilities,
    longTermDebt,
    netRevenue,
    grossProfit,
    netProfitToParent,
    operatingCashFlow,
    shareIssueProceeds,
  } = lines

  if (
    totalAssets === undefined ||
    currentAssets === undefined ||
    currentLiabilities === undefined ||
    longTermDebt === undefined ||
    netRevenue === undefined ||
    grossProfit === undefined ||
    netProfitToParent === undefined ||
    operatingCashFlow === undefined ||
    shareIssueProceeds === undefined
  ) {
    return undefined
  }

  if (totalAssets <= 0 || currentLiabilities <= 0 || netRevenue <= 0) {
    return undefined
  }

  return {
    totalAssets,
    currentAssets,
    currentLiabilities,
    longTermDebt,
    netRevenue,
    grossProfit,
    netProfitToParent,
    operatingCashFlow,
    shareIssueProceeds,
  }
}

/** Current year against the one before. Net profit to the parent stands in for income from
 *  continuing operations: VAS reports no extraordinary items. */
function beneishScore(current: AccountLines, prior: AccountLines): MScoreRead | undefined {
  const now = beneishFiguresOf(current)
  const before = beneishFiguresOf(prior)

  if (now === undefined || before === undefined) {
    return undefined
  }

  const receivables = ratioOf(receivableDays(now), receivableDays(before))
  const margin = ratioOf(grossMargin(before), grossMargin(now))
  const assetQuality = ratioOf(softAssetShare(now), softAssetShare(before))
  const depreciation = ratioOf(depreciationRate(before), depreciationRate(now))
  const overheads = ratioOf(overheadShare(now), overheadShare(before))
  const leverage = ratioOf(debtShare(now), debtShare(before))

  if (
    receivables === undefined ||
    margin === undefined ||
    assetQuality === undefined ||
    depreciation === undefined ||
    overheads === undefined ||
    leverage === undefined
  ) {
    return undefined
  }

  const signs = {
    receivables,
    margin,
    'asset-quality': assetQuality,
    'sales-growth': now.netRevenue / before.netRevenue,
    depreciation,
    accruals: (now.netProfitToParent - now.operatingCashFlow) / now.totalAssets,
  }
  const value = ACCOUNTS_WARNING_SIGNS.reduce(
    (sum, sign) => sum + M_SCORE_WEIGHTS[sign] * signs[sign],
    M_SCORE_INTERCEPT + M_SCORE_WEIGHTS.overheads * overheads + M_SCORE_WEIGHTS.leverage * leverage
  )

  return { value, signs }
}

function beneishFiguresOf(lines: AccountLines): BeneishFigures | undefined {
  const base = piotroskiFiguresOf(lines)
  const { tradeReceivables, netFixedAssets, depreciation, sellingExpenses, adminExpenses } = lines

  if (
    base === undefined ||
    tradeReceivables === undefined ||
    netFixedAssets === undefined ||
    depreciation === undefined ||
    sellingExpenses === undefined ||
    adminExpenses === undefined
  ) {
    return undefined
  }

  return {
    ...base,
    tradeReceivables,
    netFixedAssets,
    depreciation,
    sellingAndAdmin: sellingExpenses + adminExpenses,
  }
}

function warningSignsOf(read: MScoreRead): readonly AccountsWarningSign[] {
  if (read.value <= VN_ACCOUNTS_POLICY.warningSignsAtMScore) {
    return []
  }

  return ACCOUNTS_WARNING_SIGNS.filter((sign) => read.signs[sign] > WARNING_SIGN_MEANS[sign])
}

function receivableDays(figures: BeneishFigures): number {
  return figures.tradeReceivables / figures.netRevenue
}

function grossMargin(figures: BeneishFigures): number {
  return figures.grossProfit / figures.netRevenue
}

function softAssetShare(figures: BeneishFigures): number {
  return 1 - (figures.currentAssets + figures.netFixedAssets) / figures.totalAssets
}

function depreciationRate(figures: BeneishFigures): number {
  return figures.depreciation / (figures.depreciation + figures.netFixedAssets)
}

function overheadShare(figures: BeneishFigures): number {
  return figures.sellingAndAdmin / figures.netRevenue
}

function debtShare(figures: BeneishFigures): number {
  return (figures.currentLiabilities + figures.longTermDebt) / figures.totalAssets
}
