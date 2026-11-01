import type { OrderReceipt, OrderSide } from '@/trading/kernel/venue/spot-adapter'

export interface BookedFill {
  readonly quantity: number
  readonly fee: number
}

/** What an asset is worth in the transaction's currency. Asked only for a fee charged in neither
 *  leg of the pair, so the venue that billed it is the one that prices it. */
export type FeePriceLookup = (asset: string, signal: AbortSignal) => Promise<number | undefined>

interface BookedFillInput {
  readonly receipt: OrderReceipt
  readonly side: OrderSide
  readonly baseAsset: string
  readonly quoteAsset: string
  readonly priceOf: FeePriceLookup
  readonly signal: AbortSignal
}

/** A receipt that names a trade the book can hold: coins moved and the venue priced them. A fill
 *  priced at nothing would zero the row's cost basis for good and value an in-kind fee at nothing,
 *  so it is no more bookable than one that moved no coins at all. */
export function isBookableFill(receipt: OrderReceipt): boolean {
  return receipt.filledQuantity > 0 && receipt.averagePrice > 0
}

/** A venue charges in the currency it delivers and names it in `feeCurrency`. The repo convention
 *  records the quantity net of an in-kind fee and the fee priced in the transaction currency, so a
 *  buy charged in base books fewer coins rather than a larger cost. A sell charged in base gave up
 *  the fee's coins too, so it books them as sold and their value as the fee: the position drops by
 *  everything the venue took and the proceeds stay what the fill paid.
 *
 *  A rebate books as no fee: the ledger holds none below zero, and netting it into the price would
 *  invent a figure the venue never stated.
 *
 *  Undefined where the figure would have to be invented: a receipt that names no priced fill; one
 *  whose fee the venue has not reported yet; a third-currency fee the venue will not quote has no
 *  rate to convert at; and a buy fee at or above
 *  the fill delivered nothing, which is not a row. */
export async function toBookedFill(input: BookedFillInput): Promise<BookedFill | undefined> {
  const { receipt } = input

  if (!isBookableFill(receipt) || receipt.feeUnreported === true) {
    return undefined
  }

  const fee = feeChargeOf(receipt.fee)

  if (receipt.feeCurrency === input.quoteAsset || fee === 0) {
    return { quantity: receipt.filledQuantity, fee }
  }

  if (receipt.feeCurrency === input.baseAsset) {
    return input.side === 'buy'
      ? toInKindFeeFill(receipt, fee)
      : { quantity: receipt.filledQuantity + fee, fee: fee * receipt.averagePrice }
  }

  return toPricedFeeFill(input, fee)
}

/** What the venue charged, in the receipt's own currency: a charge is negative, a rebate positive. */
export function feeChargeOf(fee: number): number {
  return Math.max(-fee, 0)
}

function toInKindFeeFill(receipt: OrderReceipt, fee: number): BookedFill | undefined {
  const quantity = receipt.filledQuantity - fee

  return quantity > 0 ? { quantity, fee: fee * receipt.averagePrice } : undefined
}

/** A discount token billed alongside the pair — OKX charges in its own — moves no coins, so only
 *  the fee needs a rate. */
async function toPricedFeeFill(
  input: BookedFillInput,
  fee: number
): Promise<BookedFill | undefined> {
  const price = await input.priceOf(input.receipt.feeCurrency, input.signal)

  return price === undefined
    ? undefined
    : { quantity: input.receipt.filledQuantity, fee: fee * price }
}
