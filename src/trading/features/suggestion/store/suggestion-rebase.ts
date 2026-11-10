import { z } from 'zod'

import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type { MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { SeriesRebase } from '@/trading/kernel/market/refresh'
import { assertNotAborted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

/** The stored object as written, never the payload schema: a key this build does not know is
 *  written back as it was. */
const RAW_PAYLOAD = z.record(z.string(), z.unknown())

const REBASED_PRICE_FIELDS = [
  'entry',
  'stop',
  'target',
  'takeProfit',
  'standingTakeProfit',
  'raisedStopFrom',
  'atr',
] as const

const REBASED_NESTED_PRICES = {
  quote: ['price'],
  priceBand: ['floor', 'ceiling'],
  standingExit: ['stop', 'takeProfit'],
} as const

interface RebaseOpenCallsOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly rebase: SeriesRebase
  readonly signal: AbortSignal
}

interface OpenCallRow {
  readonly id: string
  readonly payload: string
  readonly trailing_stop: number | null
}

/** Converts every open call and plan on a name to the new price scale, so a clean re-basing (a
 *  dividend or a split) leaves them meaning what they did. Only rows dated on or before `through`
 *  are on the old scale: a session after it was priced on the new one already. Holds are included,
 *  as they are the standing plans. A row whose payload cannot be read is left as it was and logged;
 *  the scorer then closes it as a restated call. */
export async function rebaseOpenCalls(
  deps: SuggestionStoreDeps,
  options: RebaseOpenCallsOptions
): Promise<number> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const { factor, through } = options.rebase

  return await deps.db.transaction(async (tx) => {
    const rows = await tx.query<OpenCallRow>(
      'SELECT id, payload, trailing_stop FROM suggestions ' +
        `WHERE market = ${p(1)} AND ticker = ${p(2)} AND outcome_status IS NULL AND day <= ${p(3)}`,
      [options.market, options.ticker, through]
    )
    let rebased = 0

    for (const row of rows) {
      const payload = rebasedRow(deps, row, factor)

      if (payload === undefined) {
        continue
      }

      await tx.execute(
        `UPDATE suggestions SET payload = ${p(1)}, trailing_stop = ${p(2)} WHERE id = ${p(3)}`,
        [payload, row.trailing_stop === null ? null : row.trailing_stop * factor, row.id]
      )
      rebased += 1
    }

    return rebased
  })
}

function rebasedRow(
  deps: SuggestionStoreDeps,
  row: OpenCallRow,
  factor: number
): string | undefined {
  try {
    return rebasedPayload(row.payload, factor)
  } catch (err: unknown) {
    deps.logger.warn('trading.suggestion_rebase_row_unreadable', {
      id: row.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** Multiplies each listed price that is a finite number and leaves an absent one absent. Not
 *  rounded: the scorer reads the adjusted series, which is off the tick grid too. */
function rebasedPayload(payload: string, factor: number): string {
  const raw = RAW_PAYLOAD.parse(JSON.parse(payload))
  const nested = Object.entries(REBASED_NESTED_PRICES).flatMap(([key, fields]) => {
    const inner = RAW_PAYLOAD.safeParse(raw[key])

    return inner.success ? [[key, scaled(inner.data, fields, factor)]] : []
  })

  return JSON.stringify({
    ...scaled(raw, REBASED_PRICE_FIELDS, factor),
    ...Object.fromEntries(nested),
  })
}

function scaled(
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  factor: number
): Readonly<Record<string, unknown>> {
  const prices = fields.flatMap((field) => {
    const price = record[field]

    return typeof price === 'number' && Number.isFinite(price) ? [[field, price * factor]] : []
  })

  return { ...record, ...Object.fromEntries(prices) }
}
