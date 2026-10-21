import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { CashFlowToDate } from '@/trading/kernel/market/annual-accounts'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { OUTFLOW_LINES } from '@/trading/kernel/market/annual-accounts'
import { CAFEF_STATEMENTS_ID } from '@/trading/sources/adapters/cafef/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { htmlToText } from '@/trading/sources/rows/html-text'

const STATEMENT_PATH = '/du-lieu/bao-cao-tai-chinh'
const MONTHS_PER_QUARTER = 3
/** A page runs about 33 KB; the cap bounds what the row and cell scans can be handed. */
const PAGE_MAXIMUM_BYTES = 262_144
const QUARTER_HEADER_RE = /^Quý\s*([1-4])\s*-\s*(\d{4})$/
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
const CELL_RE = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi
const LABEL_NUMBERING_RE = /^[\d.\-\s]+/
/** Dots group thousands; a filing prints an outflow with a leading minus. */
const AMOUNT_RE = /^-?\d{1,3}(?:\.\d{3})*$/

type CashFlowKey = keyof CashFlowToDate['lines']
type QuarterNumber = CashFlowToDate['quarter']

/** The indirect-method table prints these under numbered headings; the first match wins. */
const LINE_LABELS: readonly (readonly [string, CashFlowKey])[] = Object.freeze([
  ['lợi nhuận trước thuế', 'preTaxProfit'],
  ['khấu hao tscđ', 'depreciation'],
  ['lưu chuyển tiền thuần từ hoạt động kinh doanh', 'operatingCashFlow'],
  ['tiền chi để mua sắm, xây dựng tscđ', 'capitalExpenditure'],
  ['tiền thu từ phát hành cổ phiếu', 'shareIssueProceeds'],
  // Cut before "vốn": the page spells it "vón".
  ['tiền trả lại v', 'shareRepurchases'],
  ['cổ tức, lợi nhuận đã trả cho chủ sở hữu', 'cashDividendsPaid'],
])
/** The fill is built and checked on these, so a page without a figure for either is refused. */
const REQUIRED_LINES: readonly CashFlowKey[] = Object.freeze(['operatingCashFlow', 'preTaxProfit'])

interface Period {
  readonly fiscalYear: number
  readonly quarter: QuarterNumber
}

/** One name per page: the table has no batch form. The page carries year-to-date figures for the
 *  four quarters ending at the one asked for. */
export function cashFlowToDateSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: CAFEF_STATEMENTS_ID,
    kind: 'cashFlowToDate',
    format: 'text',
    http: options.http,
    covers: (context: SourceContext) =>
      context.instrument !== undefined && context.toDay !== undefined,
    request: (context) => {
      const { instrument, toDay } = context

      if (instrument === undefined || toDay === undefined) {
        return null
      }

      const { fiscalYear, quarter } = periodOf(toDay)

      return {
        path:
          `${STATEMENT_PATH}/${instrument.ticker.toLowerCase()}/cashflow/${fiscalYear}/${quarter}` +
          '/0/0/bao-cao-tai-chinh-.chn',
        maxBytes: PAGE_MAXIMUM_BYTES,
      }
    },
    parse: (raw, context, fetchedAt) => {
      const { instrument, toDay } = context

      if (instrument === undefined || toDay === undefined) {
        throw new ValidationError('cafef cash-flow request carries no instrument or day')
      }

      return parsedSource(toCashFlowToDate(raw, { instrument, period: periodOf(toDay), fetchedAt }))
    },
  })
}

function periodOf(toDay: TradingDay): Period {
  const quarter = Math.ceil(Number(toDay.slice(5, 7)) / MONTHS_PER_QUARTER)

  if (quarter !== 1 && quarter !== 2 && quarter !== 3 && quarter !== 4) {
    throw new ValidationError('cafef cash-flow request carries no readable quarter')
  }

  return { fiscalYear: Number(toDay.slice(0, 4)), quarter }
}

interface ParseInput {
  readonly instrument: InstrumentRef
  readonly period: Period
  readonly fetchedAt: number
}

/** Empty when the page has no column for the quarter yet. */
function toCashFlowToDate(raw: unknown, input: ParseInput): readonly CashFlowToDate[] {
  if (typeof raw !== 'string') {
    throw new ValidationError('cafef cash-flow page did not return text')
  }

  const rows = tableRows(raw)
  const column = valueColumnOf(rows, input.period)

  if (column === undefined) {
    return []
  }

  const lines = linesOf(rows, column)

  // The direct-method layout carries neither line, nor does a page whose labels drifted.
  if (REQUIRED_LINES.some((key) => lines[key] === undefined)) {
    throw new ValidationError('cafef cash-flow table lacks operating cash flow or pre-tax profit')
  }

  return [
    {
      instrument: input.instrument,
      fiscalYear: input.period.fiscalYear,
      quarter: input.period.quarter,
      lines,
      sourceId: CAFEF_STATEMENTS_ID,
      fetchedAt: input.fetchedAt,
    },
  ]
}

/** Every cell is kept, empty or not: a column's position is what names its period. Composed form,
 *  so a page that sends decomposed diacritics still matches the headers and labels. */
function tableRows(raw: string): readonly (readonly string[])[] {
  return [...raw.matchAll(ROW_RE)].map((row) =>
    [...(row[1] ?? '').matchAll(CELL_RE)].map((cell) => htmlToText(cell[1] ?? '').normalize('NFC'))
  )
}

/** A listed column with every cell blank is a quarter not filed yet. */
function valueColumnOf(rows: readonly (readonly string[])[], period: Period): number | undefined {
  const header = rows.find((cells) => cells.some((cell) => QUARTER_HEADER_RE.test(cell)))
  const index = header?.findIndex((cell) => isPeriodHeader(cell, period))

  if (header === undefined || index === undefined || index < 0) {
    return undefined
  }

  const filed = rows.some((cells) => cells !== header && (cells[index] ?? '') !== '')

  return filed ? index : undefined
}

function isPeriodHeader(cell: string, period: Period): boolean {
  const match = QUARTER_HEADER_RE.exec(cell)

  return (
    match !== null && Number(match[1]) === period.quarter && Number(match[2]) === period.fiscalYear
  )
}

function linesOf(
  rows: readonly (readonly string[])[],
  column: number
): Partial<Record<CashFlowKey, number>> {
  const lines: Partial<Record<CashFlowKey, number>> = {}

  for (const cells of rows) {
    const key = keyOf(cells[0] ?? '')

    if (key !== undefined && lines[key] === undefined) {
      lines[key] = amountOf(cells[column], key)
    }
  }

  return lines
}

function keyOf(label: string): CashFlowKey | undefined {
  const name = label.toLowerCase().replace(LABEL_NUMBERING_RE, '')

  return LINE_LABELS.find(([prefix]) => name.startsWith(prefix))?.[1]
}

function amountOf(cell: string | undefined, key: CashFlowKey): number {
  if (cell === undefined) {
    throw new ValidationError(`cafef cash-flow row ${key} has no cell in the quarter's column`)
  }

  if (cell === '' && REQUIRED_LINES.includes(key)) {
    throw new ValidationError(`cafef cash-flow row ${key} is blank in the quarter's column`)
  }

  // CafeF leaves a zero cell blank where the primary provider stores 0.
  if (cell === '') {
    return 0
  }

  if (!AMOUNT_RE.test(cell)) {
    throw new ValidationError(`cafef cash-flow row ${key} carries an unreadable amount`)
  }

  const value = Number(cell.replaceAll('.', ''))

  return OUTFLOW_LINES.has(key) ? -value : value
}
