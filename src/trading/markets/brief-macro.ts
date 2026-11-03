import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MacroRiskDriver } from '@/trading/kernel/market/market-macro'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import { MACRO_SERIES_FIELDS } from '@/trading/kernel/market/macro-series'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'
import { apportion, SCORE_QUANTUM } from '@/trading/render/number'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

/** Below half a whole percent, coverage prints as 100%. */
const PRINTED_COVERAGE_GAP = 0.005

/** What `/rebalance` tells an operator who has not read a macro block. The brief prints one two
 *  sections above, so carrying this too would state one fact three times over. */
export const REGIME_SCALE_CAVEAT = 'portfolio.regime-risk'

// The home region's composite and its regime change: every home market's brief heads with them,
// because the regime scales what the plan below them buys.

export function buildRegimeShift(context: BriefContext): Promise<BriefSectionResult> {
  const { macro, previousMacro } = context

  if (macro === null) {
    return Promise.resolve(absent('regime-shift', [{ code: 'macro.inputs-missing' }]))
  }

  if (previousMacro === null || previousMacro.view.regime === macro.view.regime) {
    return Promise.resolve(omitted('regime-shift'))
  }

  return Promise.resolve(
    ready(
      'regime-shift',
      [{ previousRegime: previousMacro.view.regime, currentRegime: macro.view.regime }],
      {
        asOf: macro.view.asOf,
        caveats: macro.view.caveats,
        provenance: dedupeProvenance([...macro.provenance, ...previousMacro.provenance]),
      }
    )
  )
}

/** Contributions rounded across the set rather than one row at a time, so the column adds up to the
 *  composite printed above it. */
function driverRows(drivers: readonly MacroRiskDriver[]): readonly BriefSectionRow[] {
  const contributions = apportion(
    drivers.map((driver) => driver.contribution),
    SCORE_QUANTUM
  )

  return drivers.map((driver, index) => ({
    driver: driver.id,
    at: driver.asOf,
    ...toDriverValue(driver.id, driver.value),
    contribution: contributions[index] ?? driver.contribution,
  }))
}

/** Each driver states the day it was observed: the block's `asOf` is the session the composite was
 *  struck for, and a Treasury yield lags it by a day while a CPI print lags it by a month. The
 *  drivers that did not vote are named beside the coverage they cost, because a composite
 *  renormalized over the rest reads exactly like a whole one otherwise. The deployment figure is
 *  the whole book's, blended across funded segments, so the per-segment regimes that produced it
 *  travel with it — one segment's regime cannot explain a number the other segments also moved. */
export async function buildMacro(context: BriefContext): Promise<BriefSectionResult> {
  const { macro } = context

  if (macro === null) {
    return absent('macro', [{ code: 'macro.inputs-missing' }])
  }

  const advice = await context.rebalance()
  const deployment = advice.kind === 'ready' ? advice.policy.deploymentScale : undefined

  return ready(
    'macro',
    [
      { regime: macro.view.regime },
      { compositeScore: macro.view.score },
      ...driverRows(macro.view.drivers),
      ...macro.view.missing.map((entry) => ({ driverMissing: entry.id })),
      // Partial data is the fact worth a row; a read that prints as whole states nothing new.
      ...(1 - macro.view.coverage < PRINTED_COVERAGE_GAP
        ? []
        : [{ coverage: macro.view.coverage, formulaVersion: macro.view.formulaVersion }]),
      ...(deployment === undefined ? [] : [{ deploymentScale: deployment }]),
    ],
    {
      asOf: macro.view.asOf,
      caveats: [
        ...macro.view.caveats,
        ...advice.caveats.filter((caveat) => caveat.code === REGIME_SCALE_CAVEAT),
      ],
      provenance: macro.provenance,
    }
  )
}

/** Percent-unit series render as fractions like every other rate in the brief; the rest keep
 *  their native scale. */
function toDriverValue(id: MacroSeriesId, value: number): BriefSectionRow {
  const field = MACRO_SERIES_FIELDS[id]

  return field === 'valuePct' ? { valuePct: value / PERCENT_PER_UNIT } : { [field]: value }
}
