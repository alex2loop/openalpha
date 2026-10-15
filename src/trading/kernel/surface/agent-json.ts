import type { Locale } from '@/core/types/locale'
import type { DealerBoard } from '@/trading/kernel/market/market-data'
import { isPlainRecord } from '@/core/utils/collections'
import { OPERATOR_DETAIL_CODES } from '@/trading/kernel/caveat'

/** Enough for any price or ratio a reply quotes; past it a float only carries storage noise. */
const AGENT_SIGNIFICANT_DIGITS = 6
const PERCENT_PER_UNIT = 100

interface PricedQuote {
  readonly price: number
  readonly board?: DealerBoard
}

interface WrittenBoard {
  readonly buyPrice: string
  readonly sellPrice: string
  readonly spreadPct?: number
}

export type PriceWriter = (value: number) => string

/** How a payload writes what the operator reads: in their language, prices as the board shows them. */
export interface AgentWriter {
  readonly locale: Locale
  readonly price: PriceWriter
}

export type WrittenQuote<Q extends PricedQuote> = Omit<Q, 'price' | 'board'> & {
  readonly price: string
  readonly board?: WrittenBoard
}

/** Every tool reply a model reads goes through here: float noise is rounded off, and a caveat whose
 *  detail is the operator's own money keeps its code but drops the figure. Integers are kept whole,
 *  because timestamps and counts are integers and rounding one would change what it names. */
export function toAgentJson(value: unknown): string {
  return JSON.stringify(value, agentValue)
}

/** A model reads every `Pct` field as percent points, so a stored fraction is scaled on its way out. */
export function fractionToPct(fraction: number): number {
  return fraction * PERCENT_PER_UNIT
}

/** A quote as a reader says it: the price and a dealer board's two sides written out in the
 *  market's own convention, the spread in percent. */
export function writtenQuote<Q extends PricedQuote>(quote: Q, price: PriceWriter): WrittenQuote<Q> {
  const { price: value, board, ...rest } = quote

  return {
    ...rest,
    price: price(value),
    ...(board === undefined ? {} : { board: writtenBoard(board, price) }),
  }
}

function writtenBoard(board: DealerBoard, price: PriceWriter): WrittenBoard {
  return {
    buyPrice: price(board.buyPrice),
    sellPrice: price(board.sellPrice),
    ...(board.spreadPct === undefined ? {} : { spreadPct: fractionToPct(board.spreadPct) }),
  }
}

function agentValue(_key: string, value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) || !Number.isFinite(value)
      ? value
      : Number(value.toPrecision(AGENT_SIGNIFICANT_DIGITS))
  }

  if (
    isPlainRecord(value) &&
    typeof value.code === 'string' &&
    OPERATOR_DETAIL_CODES.has(value.code)
  ) {
    const { detail: _detail, ...rest } = value

    return rest
  }

  return value
}
