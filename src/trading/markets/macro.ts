import type { TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { RegionRequest } from '@/trading/kernel/market/market-capability'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import { region } from '@/trading/kernel/instrument'
import { MACRO_SERIES_IDS } from '@/trading/kernel/market/macro-series'
import { available, provenanceOf, unavailable } from '@/trading/kernel/source/source-result'
import { deriveMacroRisk, US_MACRO_DRIVERS } from '@/trading/markets/macro-risk'

/** The macro route scopes by the region a series describes, not by the region of the market asking:
 *  gold trades globally and crypto trades everywhere, but the forces pricing both are US series. */
export const MACRO_COMPOSITE_REGION = region('us')

interface MergedMacroValues {
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  readonly observationDates: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
}

/** Route order is precedence: the first provider publishing a series owns it, so a keyless primary
 *  is never overwritten by a keyed fallback that happens to carry the same id. Observation dates
 *  follow the same rule — the first provider's stamp is what the macro composite will report. */
export function mergeMacroValues(reads: readonly SourceResult<MacroSnapshot>[]): MergedMacroValues {
  const records = reads.flatMap((read) => (read.kind === 'available' ? [read.value] : []))
  const values: Partial<Record<MacroSeriesId, number>> = {}
  const observationDates: Partial<Record<MacroSeriesId, TradingDay>> = {}

  for (const id of MACRO_SERIES_IDS) {
    const record = records.find((entry) => entry.values[id] !== undefined)

    if (record === undefined) {
      continue
    }

    const value = record.values[id]

    if (value === undefined) {
      continue
    }

    values[id] = value

    const observedAt = record.observationDates[id]

    if (observedAt !== undefined) {
      observationDates[id] = observedAt
    }
  }

  return { values, observationDates }
}

/** The composite every market reads that has no macro formula of its own. The view is labelled with
 *  the region asked about; the series behind it are US ones whatever market reads them. */
export async function resolveMacroRisk(
  deps: MarketDeps,
  request: RegionRequest
): Promise<SourceResult<MacroRiskView>> {
  const reads = await deps.macro.get(MACRO_COMPOSITE_REGION, request.asOf, request.signal)
  const { values, observationDates } = mergeMacroValues(reads)
  const provenance = reads.flatMap(provenanceOf)
  const caveats = reads.flatMap((read) => read.caveats)

  if (Object.keys(values).length === 0) {
    return unavailable(
      'failed',
      reads.flatMap((read) => (read.kind === 'unavailable' ? read.attemptedSourceIds : [])),
      caveats
    )
  }

  return available(
    deriveMacroRisk(
      {
        values,
        observationDates,
        region: request.region,
        asOf: request.asOf,
        provenance,
      },
      US_MACRO_DRIVERS
    ),
    provenance,
    caveats
  )
}
