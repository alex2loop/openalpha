import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  CashFlowToDate,
  FiledAccounts,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import { CASH_FLOW_LINES, hasCashFlow, isBankLines } from '@/trading/kernel/market/annual-accounts'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { sumOf } from '@/trading/markets/equity-vn/accounts/lines'
import { quarterEndDay, watchedQuarter } from '@/trading/markets/equity-vn/accounts/quarter-watch'
import { periodIndexOf } from '@/trading/markets/equity-vn/accounts/trailing'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import { CASH_FLOW_MATCH_TOLERANCE, VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

interface CashFlowFillInput {
  readonly scope: EvidenceScope
  readonly filed: FiledAccounts
  readonly stored: readonly QuarterlyAccounts[]
}

interface CashFlowFill {
  readonly filed: FiledAccounts
  readonly caveats: readonly Caveat[]
}

/** Every quarter the primary provider still serves without cash flow keeps what a past fill stored
 *  for it; the watched quarter, when nothing is stored, is filled from the backup source once the
 *  figures check out against the quarters already on file. */
export async function fillCashFlow(input: CashFlowFillInput): Promise<CashFlowFill> {
  const { scope, stored } = input
  const filed = withStoredFills(input.filed, stored)
  const target = targetOf(filed, resolveSettledDay(scope.calendar, scope.request.now))
  const priors = target === undefined ? undefined : priorsOf(target, [...filed.quarters, ...stored])

  if (target === undefined || priors === undefined) {
    return { filed, caveats: [] }
  }

  const result = await scope.deps.sources.resolve({
    kind: 'cashFlowToDate',
    context: { market: VN_MARKET_REF, instrument: target.instrument, toDay: quarterEndDay(target) },
    signal: scope.request.signal,
  })

  // An empty answer is a quarter the backup source has not published yet, not a failure.
  if (result.kind === 'unavailable') {
    return {
      filed,
      caveats: result.reason === 'empty' ? [] : reportedCaveats(result.caveats, 'cashFlowToDate'),
    }
  }

  const yearToDate = result.value.at(0)

  if (yearToDate === undefined) {
    return { filed, caveats: result.caveats }
  }

  const derived = deriveQuarter({ target, priors, yearToDate })

  return derived === undefined
    ? {
        filed,
        caveats: [
          ...result.caveats,
          buildPayloadRejectedCaveat(result.provenance, 'cashFlowToDate'),
        ],
      }
    : buildFill(filed, derived, result.caveats)
}

/** A quarter that has left the watch, or sits behind a newer one, would otherwise lose its fill to
 *  the primary provider's row that still lacks the statement. */
function withStoredFills(
  filed: FiledAccounts,
  stored: readonly QuarterlyAccounts[]
): FiledAccounts {
  return { ...filed, quarters: filed.quarters.map((report) => carriedForward(report, stored)) }
}

/** The newest quarter, when it is the watched one and lacks the statement. A bank files its cash
 *  flow under other codes, so it never reads as missing one. */
function targetOf(filed: FiledAccounts, settled: TradingDay): QuarterlyAccounts | undefined {
  const newest = filed.quarters.toSorted(
    (left, right) => periodIndexOf(right) - periodIndexOf(left)
  )[0]
  const watched = watchedQuarter(settled)

  return newest !== undefined &&
    watched !== undefined &&
    periodIndexOf(newest) === periodIndexOf(watched) &&
    !hasCashFlow(newest.lines) &&
    !isBankLines(newest.lines)
    ? newest
    : undefined
}

/** Every earlier quarter of the target's fiscal year, each with its cash flow; none missing. */
function priorsOf(
  target: QuarterlyAccounts,
  pool: readonly QuarterlyAccounts[]
): readonly QuarterlyAccounts[] | undefined {
  const priors = Array.from({ length: target.quarter - 1 }, (_, offset) =>
    pool.find(
      (report) =>
        report.fiscalYear === target.fiscalYear &&
        report.quarter === offset + 1 &&
        hasCashFlow(report.lines)
    )
  )
  const found = priors.flatMap((report) => (report === undefined ? [] : [report]))

  return found.length === priors.length ? found : undefined
}

interface DeriveInput {
  readonly target: QuarterlyAccounts
  readonly priors: readonly QuarterlyAccounts[]
  readonly yearToDate: CashFlowToDate
}

/** The quarter's own flows: year-to-date less the quarters on file, never less another column of
 *  the backup source, whose earlier quarters are the pre-review filing. */
function deriveQuarter(input: DeriveInput): QuarterlyAccounts | undefined {
  const { target, priors, yearToDate } = input

  if (!isYearToDateMatch(target, priors, yearToDate)) {
    return undefined
  }

  const lines = { ...target.lines }

  for (const line of CASH_FLOW_LINES) {
    const reported = yearToDate.lines[line]
    const earlier = sumOf(priors.map((prior) => prior.lines[line]))

    if (reported !== undefined && earlier !== undefined) {
      lines[line] = reported - earlier
    }
  }

  return { ...target, lines, cashFlowSourceId: yearToDate.sourceId }
}

/** A wrong column or unit shows up as a pre-tax profit that disagrees with the quarters on file. */
function isYearToDateMatch(
  target: QuarterlyAccounts,
  priors: readonly QuarterlyAccounts[],
  yearToDate: CashFlowToDate
): boolean {
  const profits = [...priors, target].map((report) => report.lines.preTaxProfit)
  const total = sumOf(profits)
  const gross = sumOf(
    profits.map((profit) => (profit === undefined ? undefined : Math.abs(profit)))
  )
  const reported = yearToDate.lines.preTaxProfit

  if (total === undefined || gross === undefined || reported === undefined) {
    return false
  }

  return (
    Math.abs(reported - total) <= CASH_FLOW_MATCH_TOLERANCE * Math.max(Math.abs(reported), gross)
  )
}

/** The stored figures for the same quarter, while the quarter they were taken from is unchanged.
 *  The primary provider's own statement always wins. */
function carriedForward(
  target: QuarterlyAccounts,
  stored: readonly QuarterlyAccounts[]
): QuarterlyAccounts {
  const previous = stored.find((report) => periodIndexOf(report) === periodIndexOf(target))

  if (
    hasCashFlow(target.lines) ||
    previous?.cashFlowSourceId === undefined ||
    previous.lines.preTaxProfit === undefined ||
    previous.lines.preTaxProfit !== target.lines.preTaxProfit
  ) {
    return target
  }

  const lines = { ...target.lines }

  for (const line of CASH_FLOW_LINES) {
    const value = previous.lines[line]

    if (value !== undefined) {
      lines[line] = value
    }
  }

  return { ...target, lines, cashFlowSourceId: previous.cashFlowSourceId }
}

function buildFill(
  filed: FiledAccounts,
  quarter: QuarterlyAccounts,
  caveats: readonly Caveat[]
): CashFlowFill {
  return {
    filed: {
      ...filed,
      quarters: filed.quarters.map((report) =>
        periodIndexOf(report) === periodIndexOf(quarter) ? quarter : report
      ),
    },
    caveats,
  }
}
