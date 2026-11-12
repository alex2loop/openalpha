import type { TypedPrice } from '@/app/server/wire/vocab'
import { ApiFailure } from '@/web/api/client'

/** What the daemon asked back instead of saving: a price far from the market, or a name no stored
 *  list has. `text` is its own question, in its language. */
export interface AskedQuestion {
  readonly text: string
  readonly isName: boolean
}

/** Sends with `typedPrice: 'unconfirmed'`, so the daemon checks the price and the name against the
 *  market. One it doubts is not saved: `onQuestion` gets the daemon's own question and this resolves
 *  with nothing, for the dialog to ask and, on a yes, send again with `confirmed`. Any other refusal
 *  throws. `send` always gets a `typedPrice`: leaving it out would skip the check. */
export async function submitWithPriceConfirm<T>(
  send: (typedPrice: TypedPrice) => Promise<T>,
  onQuestion: (question: AskedQuestion) => void
): Promise<T | undefined> {
  try {
    return await send('unconfirmed')
  } catch (error: unknown) {
    const question = error instanceof ApiFailure ? toQuestion(error) : undefined

    if (question === undefined) {
      throw error
    }

    onQuestion(question)

    return undefined
  }
}

function toQuestion(failure: ApiFailure): AskedQuestion | undefined {
  if (failure.code === 'price_unconfirmed' && failure.unconfirmedPrice !== undefined) {
    return { text: failure.message, isName: false }
  }

  return failure.code === 'name_unlisted' ? { text: failure.message, isName: true } : undefined
}
