import { downloadBlob } from '@/web/edition/download'
import { SORT_LABELS } from '@/web/edition/screen-columns'
import {
  BASE_SORTS,
  type BaseSortKey,
  type BoardFactor,
  type Candidate,
} from '@/web/edition/screen-sort'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'

// Excel reads a file as the local code page unless a byte-order mark says UTF-8.
const BYTE_ORDER_MARK = '﻿'
const LINE_BREAK = '\r\n'
const CSV_MIME = 'text/csv;charset=utf-8'
// A cell opening with one of these is a formula to a spreadsheet; a leading quote keeps it text.
const FORMULA_START = /^[=+\-@\t\r]/

interface Column {
  readonly header: string
  readonly cell: (candidate: Candidate) => string
}

interface BoardFile {
  readonly market: string
  /** The day the names' figures run to, for the file's name. */
  readonly day: string
  readonly rows: readonly Candidate[]
  readonly baseKeys: readonly BaseSortKey[]
  readonly factors: readonly BoardFactor[]
}

/** Saves the rows as a CSV: the columns the board shows, in the page's language, every number raw
 *  (a percent as a percent, an amount in the market's currency) so a spreadsheet can use it. */
export async function downloadBoardCsv(board: BoardFile): Promise<void> {
  const columns = columnsOf(board)
  const lines = [
    columns.map(({ header }) => quoted(header)),
    ...board.rows.map((candidate) => columns.map(({ cell }) => cell(candidate))),
  ]
  const text = `${BYTE_ORDER_MARK}${lines.map((line) => line.join(',')).join(LINE_BREAK)}${LINE_BREAK}`

  await downloadBlob(
    new Blob([text], { type: CSV_MIME }),
    `screen-${board.market}-${board.day}.csv`
  )
}

function columnsOf({ rows, baseKeys, factors }: BoardFile): readonly Column[] {
  return [
    { header: tr('ui.office.edition.screen.csv.ticker'), cell: (c) => quoted(c.instrument.ticker) },
    { header: tr('ui.office.edition.screen.csv.name'), cell: (c) => quoted(c.name?.trim()) },
    ...(rows.some(({ sector }) => sector !== undefined)
      ? [
          {
            header: tr('ui.office.edition.screen.filter.sector'),
            cell: (c: Candidate) =>
              quoted(c.sector === undefined ? undefined : sectorName(c.sector)),
          },
        ]
      : []),
    ...baseKeys.flatMap((key) => {
      const field = BASE_SORTS[key]

      return field === undefined
        ? []
        : [{ header: tr(figureHeader(key)), cell: (c: Candidate) => numeric(c[field]) }]
    }),
    ...factors.flatMap(({ id, label }) => [
      { header: label, cell: (c: Candidate) => numeric(factorOf(c, id)?.value) },
      {
        header: tr('ui.office.edition.screen.csv.percentile', { label }),
        cell: (c: Candidate) => numeric(factorOf(c, id)?.percentile),
      },
    ]),
  ]
}

// The two moves are percents, so the header says so; every other figure reads as its own label.
function figureHeader(key: BaseSortKey) {
  if (key === 'change') {
    return 'ui.office.edition.screen.csv.change'
  }

  return key === 'month' ? 'ui.office.edition.screen.csv.month' : SORT_LABELS[key]
}

function factorOf(candidate: Candidate, id: string) {
  return candidate.factors?.find((factor) => factor.id === id)
}

function numeric(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function quoted(text: string | undefined): string {
  if (text === undefined || text === '') {
    return ''
  }

  const safe = FORMULA_START.test(text) ? `'${text}` : text

  return `"${safe.replaceAll('"', '""')}"`
}
