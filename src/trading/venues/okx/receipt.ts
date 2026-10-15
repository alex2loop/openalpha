import type { OrderReceipt, OrderState } from '@/trading/kernel/venue/spot-adapter'
import { ORDER_SIDES } from '@/trading/kernel/venue/spot-adapter'

/** Undefined without an order id: it is the identity a poll, a cancel and the unmirrored row all
 *  address the order by, and a blank one reads as an order rather than as nothing. */
export function toReceipt(
  row: Readonly<Record<string, string | undefined>>,
  instId: string
): OrderReceipt | undefined {
  const { ordId } = row
  const side = ORDER_SIDES.find((named) => named === row.side)

  if (ordId === undefined || ordId === '' || side === undefined) {
    return undefined
  }

  const fillTime = optionalStamp(row.fillTime)

  return {
    orderId: ordId,
    symbol: instId,
    side,
    state: toOrderState(row.state),
    averagePrice: optionalNumber(row.avgPx, 0),
    filledQuantity: optionalNumber(row.accFillSz, 0),
    fee: optionalNumber(row.fee, 0),
    feeCurrency: row.feeCcy ?? '',
    ...(fillTime === undefined ? {} : { filledAt: fillTime }),
  }
}

function toOrderState(raw: string | undefined): OrderState {
  switch (raw) {
    case 'partially_filled':
    case 'filled':
    case 'canceled':
    case 'mmp_canceled':
      return raw
    default:
      return 'live'
  }
}

/** A venue that named no fill time leaves the field absent: zero is 1970, and a day derived from
 *  it books a trade on a session that never happened. */
function optionalStamp(raw: string | undefined): number | undefined {
  const stamp = optionalNumber(raw, 0)

  return stamp > 0 ? stamp : undefined
}

/** An empty string is OKX's "not applicable yet" for every numeric field, and `Number('')` is 0
 *  rather than NaN — so the emptiness is tested, never the parse. */
export function optionalNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback
  }

  const value = Number(raw)

  return Number.isFinite(value) ? value : fallback
}
