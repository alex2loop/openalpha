import type { TypedPrice } from '@/app/server/wire/vocab'
import { ApiFailure } from '@/web/api/client'

/** Sends with `typedPrice: 'unconfirmed'`, so the daemon checks the price against the market. A
 *  price it doubts is not saved: `onQuestion` gets the daemon's own question and this resolves with
 *  nothing, for the dialog to ask and, on a yes, send again with `confirmed`. Any other refusal
 *  throws. `send` always gets a `typedPrice`: leaving it out would skip the check. */
export async function submitWithPriceConfirm<T>(
  send: (typedPrice: TypedPrice) => Promise<T>,
  onQuestion: (question: string) => void
): Promise<T | undefined> {
  try {
    return await send('unconfirmed')
  } catch (error: unknown) {
    if (!(error instanceof ApiFailure && isPriceQuestion(error))) {
      throw error
    }

    onQuestion(error.message)

    return undefined
  }
}

function isPriceQuestion(failure: ApiFailure): boolean {
  return failure.code === 'price_unconfirmed' && failure.unconfirmedPrice !== undefined
}
