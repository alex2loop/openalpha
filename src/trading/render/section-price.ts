import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { PreviousClose } from '@/trading/kernel/market/market-capability'
import type { BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { LiveReading, PricePair } from '@/trading/render/price-pair'
import { tradingDay } from '@/trading/kernel/instrument'

/** What the section states about every price under it: the reader's clock, and the unit its prices
 *  are quoted in where they have one. */
export interface PriceContext {
  readonly timezone: string
  readonly currency?: CurrencyCode
}

/** The pair a section row can actually state: a settled close, a live reading, or both. Absent when
 *  the row carries neither, which is what sends it back to the field list rather than to a
 *  half-drawn pair. */
export function toPricePair(row: BriefSectionRow, context: PriceContext): PricePair | undefined {
  const previousClose = settledReading(row)
  const live = liveReading(row)

  if (previousClose === undefined && live === undefined) {
    return undefined
  }

  return {
    timezone: context.timezone,
    ...(context.currency === undefined ? {} : { currency: context.currency }),
    ...(previousClose === undefined ? {} : { previousClose }),
    ...(live === undefined ? {} : { live }),
  }
}

/** The change belongs to the newest reading the row carries, so a row that has closed and not
 *  reopened states its own session's move rather than leaving the close bare. */
function settledReading(row: BriefSectionRow): PreviousClose | undefined {
  const { previousClose, closedOn, changePct } = row

  if (typeof previousClose !== 'number' || typeof closedOn !== 'string') {
    return undefined
  }

  return {
    price: previousClose,
    at: tradingDay(closedOn),
    ...(row.last === undefined && typeof changePct === 'number' ? { changePct } : {}),
  }
}

function liveReading(row: BriefSectionRow): LiveReading | undefined {
  const { last, observedAt, observedOn, changePct } = row

  if (
    typeof last !== 'number' ||
    typeof observedAt !== 'number' ||
    typeof observedOn !== 'string'
  ) {
    return undefined
  }

  return {
    price: last,
    ...(typeof changePct === 'number' ? { changePct } : {}),
    observed: { kind: 'live', day: tradingDay(observedOn), observedAt },
  }
}
