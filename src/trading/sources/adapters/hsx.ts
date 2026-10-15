// Source class: scraping-risky. `api.hsx.vn` is the exchange's own site API — the authoritative
// publisher of this list, but undocumented and without an SLA, so it can change without notice.
import { z } from 'zod'

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
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

export const HSX_DEFAULT_ENDPOINT = 'https://api.hsx.vn'

const HSX_ID = sourceId('hsx')

/** The one board this listing service publishes for, spelled as the market names its exchanges. */
const HSX_BOARDS: readonly string[] = Object.freeze(['HOSE'])

/** The `1` is the listing service's language segment. Only the symbol is read from a row, but the
 *  segment still has to name a language: `0` returns every identifying field null. */
const STATUS_PATH = '/l/api/v1/1/securities/stock-status'

/** One page above the whole HOSE board, so a status is one request rather than a page loop. */
const PAGE_SIZE = 500

/** The exchange's own status ids, published at `/l/api/v1/securities/status-list`. HOSE files into
 *  this contiguous family; the ids above it restate these same names and every one of them is
 *  empty. A status the exchange adds is unread until it is named here. */
const SUPERVISION_STATUSES: readonly {
  readonly id: number
  readonly level: SupervisionLevel
}[] = Object.freeze([
  { id: 33, level: 'warning' }, // CK thuộc diện bị cảnh báo
  { id: 34, level: 'control' }, // CK thuộc diện bị kiểm soát
  { id: 35, level: 'suspended' }, // CK thuộc diện bị tạm ngừng giao dịch
  { id: 36, level: 'suspended' }, // CK thuộc diện bị đình chỉ giao dịch
  { id: 37, level: 'suspended' }, // CK bị kiểm soát và bị tạm ngưng giao dịch
  { id: 38, level: 'restricted' }, // CK thuộc diện bị hạn chế giao dịch
])

const STATUS_PAGE = z.object({
  data: z.object({
    list: z.array(z.unknown()),
    paging: z.object({ totalCount: z.number().int().nonnegative() }),
  }),
})

const STATUS_ROW = z.object({ securitiesCode: z.string().min(1) })

interface StatusPage {
  readonly rows: readonly unknown[]
  readonly totalCount: number
}

export function createHsxSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [supervisionSource(options)]
}

/** One request per status covers the whole board, so there is no per-name fan-out. Every status
 *  must answer: a partial read would report the names on the missing one as unsupervised, which is
 *  the one wrong answer a gate must never be given. */
function supervisionSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: HSX_ID,
    kind: 'supervision',
    http: options.http,
    covers: (context: SourceContext) => context.market !== undefined,
    load: (context, signal) => loadStatuses(options.http, context, signal),
  })
}

/** Every status in one pass, stamped with the stalest of them: the read is only as current as
 *  its oldest part. */
async function loadStatuses(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<SupervisionSnapshot>>> {
  const pages = await Promise.all(
    SUPERVISION_STATUSES.map(async (status) => ({
      status,
      outcome: await http.getJson(
        { sourceId: HSX_ID, path: STATUS_PATH, query: statusQuery(status.id), signal },
        toStatusPage
      ),
    }))
  )
  const records: SupervisionRecord[] = []
  let fetchedAt = Number.POSITIVE_INFINITY

  for (const { status, outcome } of pages) {
    if (outcome.kind === 'error') {
      return outcome
    }

    // A page the request could not hold has a tail, and a name left off it reads as unsupervised.
    if (outcome.value.rows.length < outcome.value.totalCount) {
      return { kind: 'error', code: 'source.truncated' }
    }

    fetchedAt = Math.min(fetchedAt, outcome.fetchedAt)
    const target = resolveRowTarget(context, outcome.fetchedAt)

    records.push(...toRecords(outcome.value.rows, status.level, target))
  }

  // A board with nothing under any status is what a changed payload also looks like, and reporting
  // every name as clear is the costlier of the two mistakes.
  if (records.length === 0) {
    return { kind: 'error', code: 'source.empty-window' }
  }

  return {
    kind: 'ok',
    fetchedAt,
    value: parsedSource({ boards: HSX_BOARDS, authoritative: true, records }),
  }
}

function statusQuery(statusId: number): Readonly<Record<string, string>> {
  return { pageIndex: '1', pageSize: String(PAGE_SIZE), statusListId: String(statusId) }
}

function toStatusPage(raw: unknown): StatusPage {
  const { data } = STATUS_PAGE.parse(raw)

  return { rows: data.list, totalCount: data.paging.totalCount }
}

/** Branding the symbol happens inside `dropInvalid`, not after it: a row published with a symbol no
 *  ticker can be made of costs that row, where outside it the throw would leave the whole market
 *  without a supervision reading. A name carrying two live decisions is published under both, and
 *  the reader folding these keeps the severer. */
function toRecords(
  rows: readonly unknown[],
  level: SupervisionLevel,
  target: RowTarget
): readonly SupervisionRecord[] {
  return dropInvalid(rows, (row) => ({
    instrument: {
      market: target.market,
      ticker: ticker(parseRow(STATUS_ROW, row, 'hsx status').securitiesCode),
    },
    level,
  }))
}
