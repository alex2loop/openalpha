import { z } from 'zod'

import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AnnualAccounts,
  FiledAccounts,
  FiscalQuarter,
} from '@/trading/kernel/market/annual-accounts'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { OUTFLOW_LINES } from '@/trading/kernel/market/annual-accounts'
import { VIETCAP_STATEMENTS_ID } from '@/trading/sources/adapters/vietcap/client'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'

const COMPANY_PATH = '/api/iq-insight-service/v1/company'
/** The provider's `FsSection` enum. A short name (`BS`) answers an app-level 400 inside HTTP 200. */
const STATEMENT_SECTIONS = Object.freeze([
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
  'CASH_FLOW',
] as const)
/** A bank's loan grades and deposit mix. Optional: a missing note costs the bank lines only. */
const NOTE_SECTION = 'NOTE'
/** Customer loans. Every balance sheet carries the code, zero-filled outside a bank, so a positive
 *  amount is what marks a bank. */
const BANK_LOAN_CODE = 'bsb104'
/** `lengthReport` on a full-year row; quarters carry 1 to 4. */
const ANNUAL_LENGTH_REPORT = 5
const QUARTER_LENGTH_REPORTS: readonly FiscalQuarter[] = Object.freeze([1, 2, 3, 4])
const ANNUAL_PERIOD = 'annual'
const DAY_LENGTH = 10

/** A quarter is kept without its cash flow, which the provider files later. */
const QUARTER_SECTIONS: readonly RequiredSection[] = Object.freeze([
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
])

type RequiredSection = (typeof STATEMENT_SECTIONS)[number]
type StatementSection = RequiredSection | typeof NOTE_SECTION
type ReportPeriod = typeof ANNUAL_PERIOD | FiscalQuarter
export type StatementPayloads = Readonly<Record<RequiredSection, unknown>> & {
  readonly NOTE?: unknown
}

type LineKey = keyof AccountLines
type LineCodes = readonly (readonly [LineKey, string])[]

/** Corporate codes only (the `a` family). A bank, broker or insurer files under other families, so
 *  none of these is present and its report is dropped as empty rather than scored on nothing. */
const LINE_CODES: Readonly<Record<RequiredSection, LineCodes>> = Object.freeze({
  BALANCE_SHEET: [
    ['totalAssets', 'bsa53'],
    ['currentAssets', 'bsa1'],
    ['currentLiabilities', 'bsa55'],
    ['longTermDebt', 'bsa71'],
    ['tradeReceivables', 'bsa9'],
    ['netFixedAssets', 'bsa29'],
    ['cashAndEquivalents', 'bsa2'],
    ['shortTermInvestments', 'bsa5'],
    ['inventories', 'bsa15'],
    ['shortTermDebt', 'bsa56'],
    ['customerAdvances', 'bsa58'],
    ['longTermCustomerAdvances', 'bsa170'],
    ['totalEquity', 'bsa78'],
    ['minorityInterests', 'bsa210'],
    ['commonShareCapital', 'bsa175'],
  ],
  INCOME_STATEMENT: [
    ['netRevenue', 'isa3'],
    ['grossProfit', 'isa5'],
    ['sellingExpenses', 'isa9'],
    ['adminExpenses', 'isa10'],
    ['interestExpense', 'isa8'],
    ['preTaxProfit', 'isa16'],
    ['incomeTax', 'isa19'],
    ['netProfitToParent', 'isa22'],
  ],
  CASH_FLOW: [
    ['operatingCashFlow', 'cfa18'],
    ['depreciation', 'cfa2'],
    ['capitalExpenditure', 'cfa19'],
    ['shareIssueProceeds', 'cfa27'],
    ['shareRepurchases', 'cfa28'],
    ['cashDividendsPaid', 'cfa32'],
  ],
})
/** A bank's loan book and deposits, read only from a bank's payload: the provider zero-fills the
 *  `b` codes on every other balance sheet. */
const BANK_BALANCE_CODES: LineCodes = Object.freeze([
  ['customerLoans', BANK_LOAN_CODE],
  ['loanLossReserve', 'bsb105'],
  ['customerDeposits', 'bsb113'],
] as const)
const BANK_INCOME_CODES: LineCodes = Object.freeze([
  ['netInterestIncome', 'isb27'],
  ['operatingIncome', 'isb38'],
  ['operatingExpenses', 'isb39'],
] as const)
const BANK_NOTE_CODES: LineCodes = Object.freeze([
  ['currentDeposits', 'nob66'],
  ['watchListLoans', 'nob41'],
  ['substandardLoans', 'nob42'],
  ['doubtfulLoans', 'nob43'],
  ['lossLoans', 'nob44'],
  ['capitalAdequacy', 'nob151'],
] as const)

const RESPONSE = z.object({
  successful: z.literal(true),
  data: z.object({ years: z.array(z.unknown()), quarters: z.array(z.unknown()).optional() }),
})
const ROW_HEADER = z.object({
  yearReport: z.number().int(),
  lengthReport: z.number().int(),
  publicDate: z.string().min(DAY_LENGTH).nullable(),
})
const ROW_VALUES = z.record(z.string(), z.unknown())

interface StatementRow {
  readonly fiscalYear: number
  readonly period: ReportPeriod
  readonly publishedOn: TradingDay
  readonly values: Readonly<Record<string, unknown>>
}

interface ReportDraft {
  readonly fiscalYear: number
  readonly period: ReportPeriod
  readonly sections: ReadonlySet<RequiredSection>
  readonly publishedOn: TradingDay
  readonly lines: AccountLines
}

interface SectionRequest {
  readonly http: SourceHttp
  readonly ticker: string
  readonly signal: AbortSignal
}

/** One name per request: the endpoint has no batch form, and a name costs three reads, four for a
 *  bank. */
export function statementsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_STATEMENTS_ID,
    kind: 'accounts',
    http: options.http,
    covers: (context: SourceContext) => context.instrument !== undefined,
    load: (context, signal) => loadAccounts(options.http, context, signal),
  })
}

export function buildStatementPath(ticker: string): string {
  return `${COMPANY_PATH}/${ticker}/financial-statement`
}

/** A year is kept only when all three statements carry it; a quarter may arrive before its cash
 *  flow. The note only adds lines to a kept report. Exported for the measurement script, which must
 *  read reports exactly as the refresh stores them. */
export function toFiledAccounts(
  instrument: InstrumentRef,
  payloads: StatementPayloads,
  fetchedAt: number
): FiledAccounts {
  const complete = [...collectReports(payloads).values()].filter(isKeptDraft)

  return {
    annual: complete
      .filter((draft) => draft.period === ANNUAL_PERIOD)
      .map((draft) => toReport(draft, instrument, fetchedAt)),
    quarters: complete.flatMap((draft) =>
      draft.period === ANNUAL_PERIOD
        ? []
        : [{ ...toReport(draft, instrument, fetchedAt), quarter: draft.period }]
    ),
  }
}

function collectReports(payloads: StatementPayloads): ReadonlyMap<string, ReportDraft> {
  const drafts = new Map<string, ReportDraft>()

  for (const section of STATEMENT_SECTIONS) {
    for (const row of statementRows(payloads[section])) {
      drafts.set(reportKey(row), mergeRow(drafts.get(reportKey(row)), section, row))
    }
  }

  if (isBankPayload(payloads.BALANCE_SHEET)) {
    addBankLines(drafts, statementRows(payloads.BALANCE_SHEET), BANK_BALANCE_CODES)
    addBankLines(drafts, statementRows(payloads.INCOME_STATEMENT), BANK_INCOME_CODES)
    addBankLines(drafts, noteRows(payloads.NOTE), BANK_NOTE_CODES)
  }

  return drafts
}

function toReport(
  draft: ReportDraft,
  instrument: InstrumentRef,
  fetchedAt: number
): AnnualAccounts {
  return {
    instrument,
    fiscalYear: draft.fiscalYear,
    publishedOn: draft.publishedOn,
    lines: draft.lines,
    sourceId: VIETCAP_STATEMENTS_ID,
    fetchedAt,
  }
}

function isKeptDraft(draft: ReportDraft): boolean {
  const required = draft.period === ANNUAL_PERIOD ? STATEMENT_SECTIONS : QUARTER_SECTIONS

  return (
    required.every((section) => draft.sections.has(section)) && Object.keys(draft.lines).length > 0
  )
}

function reportKey(row: StatementRow): string {
  return `${row.fiscalYear}:${row.period}`
}

async function loadAccounts(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<FiledAccounts>>> {
  const instrument = context.instrument

  if (instrument === undefined) {
    throw new ValidationError('accounts request carries no instrument')
  }

  const request = { http, ticker: instrument.ticker, signal }
  const [balance, income, cash] = await Promise.all([
    fetchSection(request, 'BALANCE_SHEET'),
    fetchSection(request, 'INCOME_STATEMENT'),
    fetchSection(request, 'CASH_FLOW'),
  ])

  if (balance.kind === 'error') {
    return balance
  }
  if (income.kind === 'error') {
    return income
  }
  if (cash.kind === 'error') {
    return cash
  }

  const note = isBankPayload(balance.value) ? await fetchSection(request, NOTE_SECTION) : undefined
  const payloads = {
    BALANCE_SHEET: balance.value,
    INCOME_STATEMENT: income.value,
    CASH_FLOW: cash.value,
    ...(note?.kind === 'ok' ? { NOTE: note.value } : {}),
  }
  const fetchedAt = Math.min(balance.fetchedAt, income.fetchedAt, cash.fetchedAt)

  // Folded through `mapOutcome` because it runs after the transport, where a raw throw would
  // escape failover instead of becoming a rejected payload.
  return mapOutcome({ kind: 'ok', value: payloads, fetchedAt }, (value, at) =>
    parsedSource(toFiledAccounts(instrument, value, at))
  )
}

function fetchSection(
  request: SectionRequest,
  section: StatementSection
): Promise<SourceFetchOutcome<unknown>> {
  return request.http.getJson(
    {
      sourceId: VIETCAP_STATEMENTS_ID,
      path: buildStatementPath(request.ticker),
      query: { section },
      signal: request.signal,
    },
    (raw) => raw
  )
}

function isBankPayload(raw: unknown): boolean {
  const parsed = RESPONSE.safeParse(raw)

  return (
    parsed.success &&
    parsed.data.data.years.some((row) => {
      const values = ROW_VALUES.safeParse(row)
      const loans = values.success ? values.data[BANK_LOAN_CODE] : undefined

      return typeof loans === 'number' && Number.isFinite(loans) && loans > 0
    })
  )
}

/** A refused or malformed note costs the note lines, never the report. */
function noteRows(raw: unknown): readonly StatementRow[] {
  try {
    return statementRows(raw)
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return []
    }

    throw err
  }
}

/** An app-level refusal arrives as HTTP 200 with `successful: false`, and is the whole answer
 *  failing, not an empty one. */
function statementRows(raw: unknown): readonly StatementRow[] {
  const parsed = RESPONSE.safeParse(raw)

  if (!parsed.success) {
    throw new ValidationError('vietcap statement payload is not a successful answer')
  }

  const { years, quarters } = parsed.data.data

  return [...dropInvalid(years, toStatementRow), ...dropInvalid(quarters ?? [], toStatementRow)]
}

function periodOf(lengthReport: number): ReportPeriod | undefined {
  if (lengthReport === ANNUAL_LENGTH_REPORT) {
    return ANNUAL_PERIOD
  }

  return QUARTER_LENGTH_REPORTS.find((quarter) => quarter === lengthReport)
}

function toStatementRow(raw: unknown): StatementRow {
  const header = parseRow(ROW_HEADER, raw, 'vietcap statement')

  const period = periodOf(header.lengthReport)

  if (period === undefined || header.publicDate === null) {
    throw new ValidationError('vietcap statement row is not a dated report')
  }

  return {
    fiscalYear: header.yearReport,
    period,
    publishedOn: tradingDay(header.publicDate.slice(0, DAY_LENGTH)),
    values: parseRow(ROW_VALUES, raw, 'vietcap statement'),
  }
}

function mergeRow(
  draft: ReportDraft | undefined,
  section: RequiredSection,
  row: StatementRow
): ReportDraft {
  return {
    fiscalYear: row.fiscalYear,
    period: row.period,
    sections: new Set([...(draft?.sections ?? []), section]),
    publishedOn:
      draft === undefined || row.publishedOn > draft.publishedOn
        ? row.publishedOn
        : draft.publishedOn,
    lines: { ...draft?.lines, ...linesOf(LINE_CODES[section], row.values) },
  }
}

/** Only into a kept report, and never moving its publication day. */
function addBankLines(
  drafts: Map<string, ReportDraft>,
  rows: readonly StatementRow[],
  codes: LineCodes
): void {
  for (const row of rows) {
    const draft = drafts.get(reportKey(row))

    if (draft !== undefined && isKeptDraft(draft)) {
      drafts.set(reportKey(row), {
        ...draft,
        lines: { ...draft.lines, ...linesOf(codes, row.values) },
      })
    }
  }
}

function linesOf(codes: LineCodes, values: Readonly<Record<string, unknown>>): AccountLines {
  const lines: Partial<Record<LineKey, number>> = {}

  for (const [line, code] of codes) {
    const value = values[code]

    if (typeof value === 'number' && Number.isFinite(value)) {
      lines[line] = OUTFLOW_LINES.has(line) ? -value : value
    }
  }

  return lines
}
