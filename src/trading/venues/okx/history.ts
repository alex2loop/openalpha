import type {
  FilledOrderLookup,
  FilledOrderWindow,
  OrderReceipt,
} from '@/trading/kernel/venue/spot-adapter'
import type { OkxRow, OkxTransportDeps } from '@/trading/venues/okx/transport'
import { MS_PER_DAY } from '@/core/utils/time'
import { optionalNumber, toReceipt } from '@/trading/venues/okx/receipt'
import { NOT_FOUND_CODES, privateRequest, SPOT_INST_TYPE } from '@/trading/venues/okx/transport'

const FILLED_STATE = 'filled'
// A limit order cancelled after a part fill still moved coins; one cancelled with no fill never did.
const CANCELED_STATES: ReadonlySet<string> = new Set(['canceled', 'mmp_canceled'])
const ORDERS_HISTORY_PATH = '/api/v5/trade/orders-history'
const ORDERS_ARCHIVE_PATH = '/api/v5/trade/orders-history-archive'
// What the recent orders route retains; the archive holds three months behind it.
const RECENT_HISTORY_WINDOW_MS = 7 * MS_PER_DAY
// The most rows OKX returns per history page. Sent explicitly: the endpoint's own default is a
// fraction of it, and an unstated limit silently truncates a catch-up to the newest handful.
const HISTORY_PAGE_SIZE = 100
// Pages one enumeration may walk. A bound, not a policy — a book this deep has other problems, and
// an unbounded cursor loop against a paging bug would never return.
const MAXIMUM_HISTORY_PAGES = 50

/** OKX keeps a rolling window of closed orders, so a trade recorded well after it happened returns
 *  nothing. Side is filtered here rather than in the query: the endpoint takes no side. One page is
 *  enough for one instrument over two days, which is why this one does not walk the cursor. */
export async function fetchFilledOrders(
  deps: OkxTransportDeps,
  lookup: FilledOrderLookup
): Promise<readonly OrderReceipt[]> {
  const receipts: OrderReceipt[] = []

  for (const path of historyPathsFor(deps, lookup.since)) {
    const rows = await privateRequest(deps, {
      method: 'GET',
      path,
      query: {
        instType: SPOT_INST_TYPE,
        instId: lookup.symbol,
        begin: String(lookup.since),
        limit: String(HISTORY_PAGE_SIZE),
      },
      signal: lookup.signal,
      acceptedCodes: NOT_FOUND_CODES,
    })

    receipts.push(
      ...rows
        .filter((row) => isSettledFill(row) && row.side === lookup.side)
        .flatMap((row) => toReceipt(row, lookup.symbol) ?? [])
    )
  }

  return uniqueByOrderId(receipts)
}

/** What the venue filled across every symbol in the window. The unqualified counterpart of
 *  `fetchFilledOrders`: the same endpoint with no instrument named, walked to the end of the window.
 *
 *  `begin` is deliberately not sent. Combined with `after` the endpoint stops honouring the cursor
 *  and re-serves the same rows — measured: a bounded request answered 60 orders on one page and 59
 *  of the same 60 on the next. Paged on the cursor alone it walks cleanly, so the window is applied
 *  here instead and pages stop once one falls entirely behind it. */
export async function listFilledOrders(
  deps: OkxTransportDeps,
  window: FilledOrderWindow
): Promise<readonly OrderReceipt[]> {
  const receipts: OrderReceipt[] = []

  for (const path of historyPathsFor(deps, window.since)) {
    receipts.push(...(await walkRoute(deps, path, window)))
  }

  return uniqueByOrderId(receipts)
}

async function walkRoute(
  deps: OkxTransportDeps,
  path: string,
  window: FilledOrderWindow
): Promise<readonly OrderReceipt[]> {
  const receipts: OrderReceipt[] = []
  let after: string | undefined

  for (let page = 0; page < MAXIMUM_HISTORY_PAGES; page += 1) {
    const rows = await privateRequest(deps, {
      method: 'GET',
      path,
      query: {
        instType: SPOT_INST_TYPE,
        limit: String(HISTORY_PAGE_SIZE),
        ...(after === undefined ? {} : { after }),
      },
      signal: window.signal,
      acceptedCodes: NOT_FOUND_CODES,
    })

    receipts.push(...receiptsWithin(rows, window.since))

    const next = rows[rows.length - 1]?.ordId

    // A cursor that does not move is a page that will repeat forever, and a page wholly behind the
    // window means every page after it is too: the cursor walks from newest to oldest.
    if (rows.length < HISTORY_PAGE_SIZE || next === undefined || next === after) {
      return receipts
    }

    if (isBehindWindow(rows, window.since)) {
      return receipts
    }

    after = next
  }

  deps.logger.warn('okx.order_history_truncated', {
    pages: MAXIMUM_HISTORY_PAGES,
    since: window.since,
    orders: receipts.length,
  })

  return receipts
}

/** The receipts on one page that belong to the window. A row naming no instrument has nothing to
 *  attribute a fill to, and one the venue dated before the window is a page-boundary straggler the
 *  cursor reached without the walk being done. */
function receiptsWithin(rows: readonly OkxRow[], since: number): readonly OrderReceipt[] {
  return rows.filter(isSettledFill).flatMap((row) => {
    const receipt = row.instId === undefined ? undefined : toReceipt(row, row.instId)

    return receipt !== undefined && (receipt.filledAt ?? 0) >= since ? [receipt] : []
  })
}

/** Filled, or cancelled after filling in part. The state is read here rather than sent as a query
 *  filter, which would drop the cancelled ones. */
function isSettledFill(row: OkxRow): boolean {
  if (row.state === FILLED_STATE) {
    return true
  }

  return CANCELED_STATES.has(row.state ?? '') && optionalNumber(row.accFillSz, 0) > 0
}

/** Whether every dated row on the page fell before the window. A row is dated by its fill, or by its
 *  creation where it never filled: creation precedes any fill, so a row created before the window is
 *  behind it. An undated row settles nothing, so it never ends the walk on its own. */
function isBehindWindow(rows: readonly OkxRow[], since: number): boolean {
  const stamps = rows.flatMap((row) => {
    const at = optionalNumber(row.fillTime, 0) || optionalNumber(row.cTime, 0)

    return at > 0 ? [at] : []
  })

  return stamps.length > 0 && stamps.every((stamp) => stamp < since)
}

/** A window reaching past the recent route reads the archive as well, never instead: the archive
 *  lags the recent route, so a fill from today is only ever in the recent one and a trade recorded
 *  weeks late only ever in the archive. A fill near the seam can sit in both, which
 *  `uniqueByOrderId` folds. */
function historyPathsFor(deps: OkxTransportDeps, since: number): readonly string[] {
  return deps.now() - since > RECENT_HISTORY_WINDOW_MS
    ? [ORDERS_HISTORY_PATH, ORDERS_ARCHIVE_PATH]
    : [ORDERS_HISTORY_PATH]
}

/** The first receipt per order wins, and the recent route is read first. */
function uniqueByOrderId(receipts: readonly OrderReceipt[]): readonly OrderReceipt[] {
  const byOrderId = new Map<string, OrderReceipt>()

  for (const receipt of receipts) {
    if (!byOrderId.has(receipt.orderId)) {
      byOrderId.set(receipt.orderId, receipt)
    }
  }

  return [...byOrderId.values()]
}
