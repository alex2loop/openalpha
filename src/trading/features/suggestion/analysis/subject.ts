import type { SuggestionRequest } from '@/trading/features/suggestion/types'
import type { MarketRegistry, MarketResolution } from '@/trading/markets/types'
import { AnalysisError, type AnalysisFailure } from '@/trading/features/suggestion/analysis/types'
import { levelKindRefusal, unsupported } from '@/trading/features/suggestion/pipeline/unsupported'

export type ResolvedSubject = Extract<MarketResolution, { readonly kind: 'resolved' }>

/** The name the run analyses. One that resolves to nothing, or to a level such as an index or a
 *  futures contract, throws `AnalysisError` with the refusal before anything is read or argued. */
export async function resolveSubject(
  markets: MarketRegistry,
  request: SuggestionRequest
): Promise<ResolvedSubject> {
  const resolution = await markets.resolve({
    ticker: request.ticker,
    ...(request.market === undefined ? {} : { market: request.market }),
    operatorRead: true,
    signal: request.signal,
  })

  const message = `cannot analyse ${request.ticker}`

  if (resolution.kind !== 'resolved') {
    throw new AnalysisError({ kind: 'refused', refusal: unsupported(resolution) }, message)
  }

  const refusal = levelKindRefusal(resolution)

  if (refusal !== undefined) {
    throw new AnalysisError({ kind: 'refused', refusal }, message)
  }

  return resolution
}

/** Why the name cannot be analyzed at all, found as `resolveSubject` finds it; absent when it can. */
export async function refusalOf(
  markets: MarketRegistry,
  request: SuggestionRequest
): Promise<AnalysisFailure | undefined> {
  try {
    await resolveSubject(markets, request)

    return undefined
  } catch (err: unknown) {
    if (err instanceof AnalysisError) {
      return err.failure
    }

    throw err
  }
}
