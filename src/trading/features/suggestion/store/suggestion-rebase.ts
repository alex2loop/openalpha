import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type { MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { SeriesRebase } from '@/trading/kernel/market/refresh'
import { assertNotAborted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { lockRowSql, RAW_PAYLOAD } from '@/trading/features/suggestion/store/suggestion-outcome'
import { floorToLot } from '@/trading/kernel/instrument'

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

const REBASED_QUANTITY_FIELDS = ['units', 'policyUnits'] as const

interface RebaseOpenCallsOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly rebase: SeriesRebase
  /** The market's board lot. Omitted, a buy's quantities are left as they were. */
  readonly lotSize?: number
  readonly signal: AbortSignal
}

interface OpenCallRow {
  readonly id: string
  readonly action: string
  readonly payload: string
}

interface Scale {
  readonly factor: number
  readonly lotSize?: number
}

/** Converts every open call and plan on a name to the new price scale, so a clean re-basing (a
 *  dividend or a split) leaves them meaning what they did. Only rows dated on or before `through`
 *  are on the old scale: a session after it was priced on the new one already. Holds are included,
 *  as they are the standing plans. A buy's quantities are divided by the factor and floored to the
 *  board lot, so the order it prints still costs what it did; `held` mirrors the ledger, which has
 *  no corporate actions, and stays as it was. A row whose payload cannot be read is left as it was
 *  and logged; every read skips it the same way. */
export async function rebaseOpenCalls(
  deps: SuggestionStoreDeps,
  options: RebaseOpenCallsOptions
): Promise<number> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const scale: Scale = {
    factor: options.rebase.factor,
    ...(options.lotSize === undefined ? {} : { lotSize: options.lotSize }),
  }

  return await deps.db.transaction(async (tx) => {
    const rows = await tx.query<OpenCallRow>(
      'SELECT id, action, payload FROM suggestions ' +
        `WHERE market = ${p(1)} AND ticker = ${p(2)} AND outcome_status IS NULL AND day <= ${p(3)}` +
        lockRowSql(deps.dialect),
      [options.market, options.ticker, options.rebase.through]
    )
    let rebased = 0

    for (const row of rows) {
      const payload = rebasedRow(deps, row, scale)

      if (payload === undefined) {
        continue
      }

      // The trailed stop is scaled in SQL and the row must still be open: a stop raised or a call
      // resolved by another loop since the read is never overwritten from a stale copy.
      const result = await tx.execute(
        `UPDATE suggestions SET payload = ${p(1)}, trailing_stop = trailing_stop * ${p(2)} ` +
          `WHERE id = ${p(3)} AND outcome_status IS NULL`,
        [payload, scale.factor, row.id]
      )

      rebased += result.changes
    }

    return rebased
  })
}

function rebasedRow(deps: SuggestionStoreDeps, row: OpenCallRow, scale: Scale): string | undefined {
  try {
    return rebasedPayload(row, scale)
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
function rebasedPayload(row: OpenCallRow, scale: Scale): string {
  const raw = RAW_PAYLOAD.parse(JSON.parse(row.payload))
  const nested = Object.entries(REBASED_NESTED_PRICES).flatMap(([key, fields]) => {
    const inner = RAW_PAYLOAD.safeParse(raw[key])

    return inner.success ? [[key, scaled(inner.data, fields, scale.factor)]] : []
  })
  const prices = {
    ...scaled(raw, REBASED_PRICE_FIELDS, scale.factor),
    ...Object.fromEntries(nested),
  }

  return JSON.stringify(row.action === 'buy' ? withLotQuantities(prices, scale) : prices)
}

/** A quantity that floors to nothing is kept: a buy with no units would lose the size it printed. */
function withLotQuantities(
  record: Readonly<Record<string, unknown>>,
  scale: Scale
): Readonly<Record<string, unknown>> {
  const { factor, lotSize } = scale

  if (lotSize === undefined) {
    return record
  }

  const quantities = REBASED_QUANTITY_FIELDS.flatMap((field) => {
    const units = record[field]
    const lots =
      typeof units === 'number' && Number.isFinite(units) ? floorToLot(units / factor, lotSize) : 0

    return lots > 0 ? [[field, lots]] : []
  })

  return { ...record, ...Object.fromEntries(quantities) }
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
