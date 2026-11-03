import type { ScreenedCandidate, ScreenView } from '@/trading/features/market-data/types'
import type { FactorId } from '@/trading/kernel/factor'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { rankWithin } from '@/trading/markets/factor-scoring'

const PERCENT = 100
/** One reading has nothing to be placed against, so a factor that fired for fewer names has none. */
const MINIMUM_PEERS = 2

/** The whole priced board as a list to browse: ticker order, which says nothing about merit, and
 *  for each factor that fired where the name's reading sits among the board's. A name with no price
 *  is left out and counted: the board prices what it lists, and a missing price is absent, not zero.
 *  The composite stays on the candidate for the callers that rank, and no renderer of this form
 *  reads it. */
export function toBoardView(view: ScreenView): ScreenView {
  const priced = view.candidates.filter((candidate) => candidate.price !== undefined)
  const percentiles = factorPercentiles(priced)

  return {
    ...view,
    form: 'board',
    candidates: priced
      .map((candidate) => withPercentiles(candidate, percentiles.get(keyOf(candidate))))
      .toSorted((left, right) => compareTickers(left, right)),
    unpriced: view.candidates.length - priced.length,
  }
}

function withPercentiles(
  candidate: ScreenedCandidate,
  percentiles: ScreenedCandidate['percentiles']
): ScreenedCandidate {
  return percentiles === undefined ? candidate : { ...candidate, percentiles }
}

/** Per name, each fired factor's percentile among the names it fired for: a factor that abstained
 *  has no reading to place. Ties share the mean position (`rankWithin`). */
function factorPercentiles(
  candidates: readonly ScreenedCandidate[]
): ReadonlyMap<string, NonNullable<ScreenedCandidate['percentiles']>> {
  const readings = new Map<FactorId, number[]>()

  for (const candidate of candidates) {
    for (const factor of firedFactors(candidate)) {
      readings.set(factor.id, [...(readings.get(factor.id) ?? []), factor.score])
    }
  }

  return new Map(
    candidates.map((candidate) => {
      const placed: Partial<Record<FactorId, number>> = {}

      for (const factor of firedFactors(candidate)) {
        const peers = readings.get(factor.id) ?? []

        if (peers.length >= MINIMUM_PEERS) {
          placed[factor.id] = rankWithin(peers, factor.score) * PERCENT
        }
      }

      return [keyOf(candidate), placed]
    })
  )
}

// A factor that did not fire carries no weight: it moved nothing, so it has no reading to place.
function firedFactors(candidate: ScreenedCandidate): ScreenedCandidate['factors'] {
  return candidate.factors.filter((factor) => factor.weight !== undefined)
}

function keyOf(candidate: ScreenedCandidate): string {
  return buildInstrumentKey(candidate.instrument)
}

function compareTickers(left: ScreenedCandidate, right: ScreenedCandidate): number {
  const [a, b] = [left.instrument.ticker, right.instrument.ticker]

  if (a === b) {
    return 0
  }

  return a < b ? -1 : 1
}
