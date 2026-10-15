import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { SuggestionId } from '@/trading/features/suggestion/types'

interface OutcomeOperationDeps {
  readonly suggestions: SuggestionService
  readonly batchSize: number
}

/** Every page in one pass: ticks are hours apart and a restart loses any cursor kept between them,
 *  so one page a tick never reaches the rows past the first. The keyset cursor only advances. */
export function createOutcomeTick(
  deps: OutcomeOperationDeps
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const now = Date.now()
    let cursor: SuggestionId | undefined

    do {
      const batch = await deps.suggestions.resolvePending({
        now,
        batchSize: deps.batchSize,
        ...(cursor === undefined ? {} : { cursor }),
        signal,
      })

      cursor = batch.nextCursor
    } while (cursor !== undefined)
  }
}
