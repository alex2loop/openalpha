// Source class: scraping-risky. `iboard-query.ssi.com.vn` is a broker's own board with no SLA, its
// bot gate answers a burst with a block page, and its `adminStatus` can lag the exchange's own
// decision by a session. So it never replaces the exchange's list: it stands beside it, and carries
// the board the exchange publishes no list for.
import { z } from 'zod'

import type { CaveatCode } from '@/trading/kernel/caveat'
import type {
  SupervisionLevel,
  SupervisionRecord,
  SupervisionSnapshot,
} from '@/trading/kernel/market/supervision'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ticker } from '@/trading/kernel/instrument'
import { severest } from '@/trading/kernel/market/supervision'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  fromCodeTable,
  pageRows,
  parseRow,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

export const SSI_DEFAULT_ENDPOINT = 'https://iboard-query.ssi.com.vn'

const SSI_ID = sourceId('ssi')
const BOARD_PATH = '/stock/exchange'

/** The boards this provider serves — a provider fact, not the market's admitted list. The wire
 *  spells them lowercase; the market uppercases what a source stamps. */
const SSI_BOARDS = Object.freeze(['hose', 'hnx'] as const)

/** What the exchange has declared about the issuer. `NRM` is the normal state and every other code
 *  is some degree of supervision, so an unlisted one falls back to the mildest non-normal reading
 *  rather than to normal — the one reading the provider has ruled out. */
const NORMAL_ADMIN_STATUS = 'NRM'
const ADMIN_STATUS_LEVELS: Readonly<Record<string, SupervisionLevel>> = Object.freeze({
  WFR: 'warning',
  CTR: 'control',
  RES: 'restricted',
  'C&R': 'restricted',
})
const UNMAPPED_ADMIN_LEVEL: SupervisionLevel = 'warning'

/** What that declaration does to the tape. `N` matches continuously; the rest do not, which is the
 *  difference between a name whose story is in doubt and a name an order cannot reach. */
const NORMAL_TRADING_STATUS = 'N'
const TRADING_STATUS_LEVELS: Readonly<Record<string, SupervisionLevel>> = Object.freeze({
  RT: 'restricted',
  TFR: 'restricted',
  S: 'suspended',
})

const BOARD_ROW = z.object({
  stockSymbol: z.string().min(1),
  adminStatus: z.string().min(1).optional(),
  tradingStatus: z.string().min(1).optional(),
})

type BoardRow = z.infer<typeof BOARD_ROW>

export function createSsiSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [supervisionSource(options)]
}

/** One call per board covers the whole market, so there is no pagination to bound and no per-name
 *  fan-out. */
function supervisionSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: SSI_ID,
    kind: 'supervision',
    http: options.http,
    covers: (context: SourceContext) => context.market !== undefined,
    load: (context, signal) => loadBoards(options.http, context, signal),
  })
}

/** A board that failed drops out of the coverage the read states rather than failing the request:
 *  the reader treats an uncovered board as unknown, so a missing one is never read as clear.
 *  Stamped with the stalest board that answered. */
async function loadBoards(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<SupervisionSnapshot>>> {
  const outcomes = await Promise.all(
    SSI_BOARDS.map(async (board) => ({
      board,
      outcome: await http.getJson(
        { sourceId: SSI_ID, path: `${BOARD_PATH}/${board}`, signal },
        pageRows
      ),
    }))
  )
  const boards: string[] = []
  const rows: unknown[] = []
  let failure: CaveatCode | undefined
  let fetchedAt = Number.POSITIVE_INFINITY

  for (const { board, outcome } of outcomes) {
    if (outcome.kind === 'error') {
      failure ??= outcome.code
      continue
    }

    // A board answering with no rows at all is a changed payload, not a market with no names.
    if (outcome.value.length === 0) {
      failure ??= 'source.empty-window'
      continue
    }

    boards.push(board)
    rows.push(...outcome.value)
    fetchedAt = Math.min(fetchedAt, outcome.fetchedAt)
  }

  if (boards.length === 0) {
    return { kind: 'error', code: failure ?? 'source.empty-window' }
  }

  const records = toRecords(rows, resolveRowTarget(context, fetchedAt))

  return { kind: 'ok', fetchedAt, value: parsedSource({ boards, authoritative: false, records }) }
}

/** Branding the symbol happens inside `dropInvalid`, not after it: a row the board publishes with a
 *  symbol no ticker can be made of costs that row, where outside it the throw would leave the whole
 *  market without a supervision reading. */
function toRecords(rows: readonly unknown[], target: RowTarget): readonly SupervisionRecord[] {
  return dropInvalid(rows, (row) =>
    toRecord(parseRow(BOARD_ROW, row, 'ssi board'), target)
  ).flatMap((record) => (record === undefined ? [] : [record]))
}

/** Absent for a name both fields call normal, which is most of the board. */
function toRecord(row: BoardRow, target: RowTarget): SupervisionRecord | undefined {
  const admin = adminLevel(row.adminStatus)
  const trading = tradingLevel(row.tradingStatus)
  const level = trading === undefined ? admin : severest(admin, trading)

  return level === undefined
    ? undefined
    : { instrument: { market: target.market, ticker: ticker(row.stockSymbol) }, level }
}

function adminLevel(status: string | undefined): SupervisionLevel | undefined {
  if (status === undefined || status === NORMAL_ADMIN_STATUS) {
    return undefined
  }

  return fromCodeTable(ADMIN_STATUS_LEVELS, status) ?? UNMAPPED_ADMIN_LEVEL
}

/** No fallback here: `tradingStatus` describes matching, and a code this table does not carry says
 *  nothing about whether an order can reach the name. `adminStatus` still answers for it. */
function tradingLevel(status: string | undefined): SupervisionLevel | undefined {
  return status === undefined || status === NORMAL_TRADING_STATUS
    ? undefined
    : fromCodeTable(TRADING_STATUS_LEVELS, status)
}
