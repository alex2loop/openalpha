import type { ValuedPosition } from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef } from '@/trading/kernel/instrument'

const PARTIAL_NAV: Caveat = { code: 'valuation.partial-nav' }

interface CaveatInputs {
  readonly complete: boolean
  readonly outcomes: readonly { readonly sourceCaveats: readonly Caveat[] }[]
  readonly valued: readonly ValuedPosition[]
  readonly cash: { readonly caveats: readonly Caveat[] }
  readonly sectorFor: (instrument: InstrumentRef) => string | undefined
}

export function valuationCaveats(inputs: CaveatInputs): readonly Caveat[] {
  const { complete, outcomes, valued, cash } = inputs

  return [
    ...(complete ? [] : [PARTIAL_NAV]),
    // Both arms: a holding priced off a degraded read is still priced. Deduped below.
    ...dedupeCaveats(outcomes.flatMap((outcome) => outcome.sourceCaveats)),
    ...uncheckedSectorCaveats(valued, inputs.sectorFor),
    ...cash.caveats,
  ]
}

/** A holding the sector fold could not place is dropped; only names in a market placed elsewhere
 *  count, so a sectorless market (crypto) stays outside the check by nature. */
function uncheckedSectorCaveats(
  valued: readonly ValuedPosition[],
  sectorFor: (instrument: InstrumentRef) => string | undefined
): readonly Caveat[] {
  const priced = valued.filter((entry) => entry.kind === 'priced')
  const placed = new Set(
    priced
      .filter((entry) => sectorFor(entry.position.instrument) !== undefined)
      .map((entry) => entry.position.instrument.market)
  )

  return priced
    .filter(
      (entry) =>
        sectorFor(entry.position.instrument) === undefined &&
        placed.has(entry.position.instrument.market)
    )
    .map((entry) => ({
      code: 'portfolio.concentration-unchecked' as const,
      detail: { ticker: entry.position.instrument.ticker },
    }))
}

/** Keyed on whole caveat: distinct reasons stay distinct, one cold refresh collapses to one. */
function dedupeCaveats(caveats: readonly Caveat[]): readonly Caveat[] {
  const seen = new Map<string, Caveat>()

  for (const caveat of caveats) {
    seen.set(JSON.stringify([caveat.code, caveat.detail ?? null]), caveat)
  }

  return [...seen.values()]
}
