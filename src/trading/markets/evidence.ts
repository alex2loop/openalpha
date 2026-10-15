// What every market does with a source result before it becomes a factor input: keep the value when
// there is one, keep provenance and caveats either way, and turn a level into a percentile against
// a declared range. One owner, so two markets cannot disagree about what an absent input means.
import type { Caveat } from '@/trading/kernel/caveat'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import { clamp } from '@/trading/markets/factor-scoring'

export interface EvidenceSeries<T> {
  readonly value?: T
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export interface ReferenceRange {
  readonly low: number
  readonly high: number
}

/** An unavailable source keeps its caveats and loses only its value: the caller then abstains on
 *  the factors that needed it, rather than scoring them zero. */
export function toSeries<T>(result: SourceResult<T>): EvidenceSeries<T> {
  return result.kind === 'available'
    ? { value: result.value, provenance: result.provenance, caveats: result.caveats }
    : { provenance: [], caveats: result.caveats }
}

/** Position of a level inside the strategy's declared range, in [0, 1]. Outside the range it
 *  clamps: the strategy has stated the span it considers meaningful, and extrapolating past it
 *  would invent a percentile no observation supports. */
export function percentileWithin(value: number, range: ReferenceRange): number | undefined {
  const span = range.high - range.low

  return span <= 0 ? undefined : clamp((value - range.low) / span, 0, 1)
}

/** `raw` is optional on FactorInput, so an absent value must omit the key rather than set it to
 *  undefined — the two differ under `exactOptionalPropertyTypes`. */
export function optionalRaw(raw: number | undefined): { readonly raw?: number } {
  return raw === undefined ? {} : { raw }
}
