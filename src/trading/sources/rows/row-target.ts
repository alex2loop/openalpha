import type { MarketRef } from '@/trading/kernel/instrument'
import type { SourceContext } from '@/trading/kernel/source/source-result'
import { ValidationError } from '@/core/errors'

export interface RowTarget {
  readonly market: MarketRef
  readonly fetchedAt: number
}

/** The market a parsed row belongs to is the one the request named — reading it here is not the
 *  same as testing it in `covers`, which would restate routing. */
export function resolveRowTarget(context: SourceContext, fetchedAt: number): RowTarget {
  const market = context.instrument?.market ?? context.market

  if (market === undefined) {
    throw new ValidationError('source rows need a market in context')
  }

  return { market, fetchedAt }
}
