import type { SuggestionAction } from '@/trading/kernel/conviction'
import type { MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { SUGGESTION_ACTIONS } from '@/trading/kernel/conviction'
import { ticker as brandTicker, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { toMember } from '@/trading/kernel/store/store-payload'

/** What an agreement measure needs of a call, and nothing of its payload: tens of kilobytes a row
 *  that a year-long read would otherwise drag through memory for a handful of columns. */
export interface CallAction {
  readonly id: string
  readonly focusKey: FocusKey
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly day: TradingDay
  readonly action: SuggestionAction
  readonly createdAt: number
  /** Absent until the call resolves, and for one that closed with no result. */
  readonly returnPct?: number
}

interface CallActionRow {
  readonly id: string
  readonly focus_key: string
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly action: string
  readonly created_at: number
  readonly return_pct: number | null
}

export interface ListCallActionsOptions {
  readonly sinceDay: TradingDay
  readonly signal: AbortSignal
}

/** The newest row per focus, name and day: a forced re-run supersedes the call it re-made, and only
 *  the call that stands is compared. There is no day-led index, so this is a scan, run once per
 *  listing and never per agent. */
export async function listCallActions(
  deps: StoreDeps,
  options: ListCallActionsOptions
): Promise<readonly CallAction[]> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<CallActionRow>(
    'SELECT id, focus_key, market, ticker, day, action, created_at, return_pct ' +
      `FROM suggestions WHERE day >= ${deps.dialect.param(1)} AND is_call = 1 ORDER BY created_at, id`,
    [options.sinceDay]
  )
  const newest = new Map<string, CallAction>()

  for (const row of rows) {
    // Oldest first (id breaks a timestamp tie), so a later row for the same key replaces the earlier.
    newest.set([row.focus_key, row.market, row.ticker, row.day].join('\u0000'), toCallAction(row))
  }

  return [...newest.values()]
}

function toCallAction(row: CallActionRow): CallAction {
  return {
    id: row.id,
    // why-safe: the column only ever holds `focusKey()` output.
    focusKey: row.focus_key as FocusKey,
    market: marketRef(row.market),
    ticker: brandTicker(row.ticker),
    day: tradingDay(row.day),
    action: toMember<SuggestionAction>(row.action, SUGGESTION_ACTIONS, 'suggestion action'),
    createdAt: row.created_at,
    ...(row.return_pct === null ? {} : { returnPct: row.return_pct }),
  }
}
