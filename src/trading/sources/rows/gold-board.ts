// Vendor boards disagree on everything except the invariants: one row per form, positive prices in
// VND per lượng, never a sell below buy, never an empty board. Those live here once; each host
// file keeps only its transport, its payload shape, and its code table.

import type { TradingDay, VnGoldForm } from '@/trading/kernel/instrument'
import type { GoldBoard, GoldBoardPoint, GoldBoardRow } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import { ValidationError } from '@/core/errors'
import { positive } from '@/trading/sources/rows/normalization'

/** No real lượng price is below a million VND, so a side under it was scaled wrong (a thousand-VND
 *  quote read as VND) rather than a cheap lượng. */
const MINIMUM_VND_PER_LUONG = 1_000_000

/** A vendor spread is a few percent, wider under stress, never close to this. A pair further apart
 *  is two different fields rather than the two prices of one row, and passes every other check. */
const MAXIMUM_SPREAD_RATIO = 1.25

export const VN_BOARD_TIMEZONE = 'Asia/Ho_Chi_Minh'

interface GoldBoardMeta {
  readonly fetchedAt: number
  readonly sourceId: SourceId
}

interface GoldBoardStamp extends GoldBoardMeta {
  readonly observedAt: number
  readonly asOf: TradingDay
}

interface GoldBoardRowInput {
  readonly form: VnGoldForm
  readonly vendor: string
  readonly buy: unknown
  readonly sell: unknown
  /** Multiplier from the payload's unit to VND per lượng; absent means the payload is already
   *  VND per lượng. */
  readonly priceScale?: number
}

interface GoldBoardPointInput extends GoldBoardRowInput {
  readonly day: TradingDay
}

/** One row per form, first occurrence wins: region-grouped tables repeat one form per region, and
 *  every consumer (`selectForm`) reads the first row of a form anyway. */
export function assembleGoldBoard(stamp: GoldBoardStamp, rows: readonly GoldBoardRow[]): GoldBoard {
  const byForm = new Map<VnGoldForm, GoldBoardRow>()

  for (const row of rows) {
    if (!byForm.has(row.form)) {
      byForm.set(row.form, row)
    }
  }

  if (byForm.size === 0) {
    throw new ValidationError('gold board has no recognizable row')
  }

  return {
    sourceId: stamp.sourceId,
    fetchedAt: stamp.fetchedAt,
    observedAt: stamp.observedAt,
    asOf: stamp.asOf,
    rows: [...byForm.values()],
  }
}

/** The numeric checks every row crosses, structured feeds included. A sell below its buy, a side
 *  under the scale floor, or a pair too far apart to be a spread all say the same thing: these are
 *  not the two prices of one row. */
export function toGoldBoardRow(input: GoldBoardRowInput): GoldBoardRow {
  const scale = input.priceScale ?? 1
  const buyPricePerLuong = positive(input.buy, 'buy') * scale
  const sellPricePerLuong = positive(input.sell, 'sell') * scale

  if (sellPricePerLuong < buyPricePerLuong) {
    throw new ValidationError('gold board row sells below its buy price')
  }

  if (buyPricePerLuong < MINIMUM_VND_PER_LUONG) {
    throw new ValidationError('gold board row is below a plausible lượng price')
  }

  if (sellPricePerLuong / buyPricePerLuong > MAXIMUM_SPREAD_RATIO) {
    throw new ValidationError('gold board row spread is too wide to be one row')
  }

  return { form: input.form, vendor: input.vendor, buyPricePerLuong, sellPricePerLuong }
}

/** A history that admits a price no counter quoted ranks today's premium against a number nobody
 *  paid, so a dated row crosses the same checks as a live one. */
export function toGoldBoardPoint(input: GoldBoardPointInput): GoldBoardPoint {
  return { day: input.day, ...toGoldBoardRow(input) }
}
