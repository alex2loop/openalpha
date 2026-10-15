import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type { SuggestionRow } from '@/trading/features/suggestion/store/suggestion-row'
import type {
  StoredSuggestion,
  SuggestionId,
  SuggestionListStatus,
} from '@/trading/features/suggestion/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { Page, PageOptions } from '@/trading/kernel/store/page'
import { assertNotAborted } from '@/core/errors'
import { readableRow } from '@/trading/features/suggestion/store/readable-row'
import { LATEST_OF_SAME_CALL_SQL } from '@/trading/features/suggestion/store/suggestion-outcome'
import { toSuggestion } from '@/trading/features/suggestion/store/suggestion-row'
import { suggestionId } from '@/trading/features/suggestion/types'
import { toPage } from '@/trading/kernel/store/store-row'

export interface SuggestionPageOptions extends PageOptions<SuggestionId> {
  readonly status: SuggestionListStatus
  /** One focus's calls: the book's by default, so a list never mixes two agents' views. */
  readonly focusKey: FocusKey
  /** One name's rows only. */
  readonly instrument?: InstrumentRef
}

/** A name's newest unresolved row is its standing verdict (`findLatestVerdict`); an older open row
 *  on the same name is superseded, so it is not listed again. */
const STANDING_VERDICT_SQL =
  'outcome_status IS NULL AND NOT EXISTS (SELECT 1 FROM suggestions newer ' +
  'WHERE newer.market = suggestions.market AND newer.ticker = suggestions.ticker ' +
  'AND newer.focus_key = suggestions.focus_key ' +
  'AND newer.outcome_status IS NULL AND newer.id > suggestions.id)'

/** A scored close, once per call: a restated close has no return to show, and a same-day re-run
 *  under a new version is the same call (`LATEST_OF_SAME_CALL_SQL`), as the track record counts. */
const SCORED_CLOSE_SQL = `resolved_at IS NOT NULL AND return_pct IS NOT NULL AND ${LATEST_OF_SAME_CALL_SQL}`

const STATUS_SQL: Readonly<Record<SuggestionListStatus, string>> = {
  open: STANDING_VERDICT_SQL,
  ended: SCORED_CLOSE_SQL,
  all: '1 = 1',
}

/** Open and all rows page newest first by id; ended rows newest close first, keyed on the cursor
 *  row's own close time so a page boundary inside one timestamp neither skips nor repeats a row. */
export async function listSuggestionPage(
  deps: SuggestionStoreDeps,
  options: SuggestionPageOptions
): Promise<Page<StoredSuggestion, SuggestionId>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  const byClose = options.status === 'ended'
  let where = STATUS_SQL[options.status]

  params.push(options.focusKey)
  where += ` AND focus_key = ${p(params.length)}`

  if (options.instrument !== undefined) {
    params.push(options.instrument.market, options.instrument.ticker)
    where += ` AND market = ${p(params.length - 1)} AND ticker = ${p(params.length)}`
  }

  if (options.cursor !== undefined) {
    params.push(options.cursor)
    const cursor = p(params.length)
    where += byClose
      ? ` AND (resolved_at < (SELECT resolved_at FROM suggestions WHERE id = ${cursor}) ` +
        `OR (resolved_at = (SELECT resolved_at FROM suggestions WHERE id = ${cursor}) ` +
        `AND id < ${cursor}))`
      : ` AND id < ${cursor}`
  }

  params.push(options.limit + 1)

  const order = byClose ? 'resolved_at DESC, id DESC' : 'id DESC'
  const rows = await deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE ${where} ORDER BY ${order} LIMIT ${p(params.length)}`,
    params
  )

  // Paged on the rows, not on what they parsed to, so the cursor clears one it could not read.
  const page = toPage(rows, options.limit, (row) => suggestionId(row.id))

  return {
    items: page.items.flatMap((row) => readableRow(row, toSuggestion, deps.logger)),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  }
}
