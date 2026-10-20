import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MacroSnapshot, MarketRegime } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDataRefreshRequest, MarketManifest } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { reportRefreshStage } from '@/trading/kernel/market/refresh'
import { provenanceOf } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'
import {
  US_EQUITY_MACRO_DRIVERS,
  US_MARKET_REF,
  US_MARKET_REGION,
  US_REGIME_MEMORY_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { MACRO_COMPOSITE_REGION, mergeMacroValues } from '@/trading/markets/macro'
import {
  deriveMacroRisk,
  driverObservationDates,
  isRegimeRated,
} from '@/trading/markets/macro-risk'
import { emptyKindResult, refreshStatus } from '@/trading/markets/refresh-result'

interface MacroRefreshInput {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly request: MarketDataRefreshRequest
}

/** Stores the US composite for the settled session, so the brief's recent-regime read has a row. The
 *  previous rated band rides in as hysteresis, as VN's does; a derivation with no stamp behind it
 *  has no source to attribute and stores nothing. */
export async function refreshUsMacro(input: MacroRefreshInput): Promise<RefreshKindResult> {
  const { deps, manifest, request } = input
  const asOf = resolveSettledDay(manifest.calendar, request.now)

  reportRefreshStage(request.progress, { market: US_MARKET_REF, kind: 'macro' })

  const reads = await deps.macro.get(MACRO_COMPOSITE_REGION, asOf, request.signal)
  const provenance = reads.flatMap(provenanceOf)
  const merged = mergeMacroValues(reads)

  if (Object.keys(merged.values).length === 0 || provenance.length === 0) {
    return emptyKindResult(
      'macro',
      'unavailable',
      reads.flatMap((read) => read.caveats)
    )
  }

  const view = deriveMacroRisk(
    {
      ...merged,
      region: US_MARKET_REGION,
      asOf,
      provenance,
      ...(await previousScoreRegime(input, asOf)),
    },
    US_EQUITY_MACRO_DRIVERS
  )
  const caveats = dedupeCaveats([...view.caveats, ...reads.flatMap((read) => read.caveats)])

  await storeMacro(input, { view, values: merged.values, provenance, caveats })

  return toMacroResult(view, provenance, caveats)
}

interface MacroWrite {
  readonly view: MacroRiskView
  readonly values: MacroSnapshot['values']
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

async function storeMacro(input: MacroRefreshInput, write: MacroWrite): Promise<void> {
  const { view } = write
  const { manifest, request } = input

  await input.deps.marketDataStore.upsertMacroRisk(
    {
      region: US_MARKET_REGION,
      asOf: resolveSettledDay(manifest.calendar, request.now),
      createdAt: request.now,
      formulaVersion: view.formulaVersion,
      values: write.values,
      observationDates: driverObservationDates(view.drivers),
      regime: view.regime,
      ...(isRegimeRated(view) ? { scoreRegime: view.scoreRegime } : {}),
      provenance: write.provenance,
      caveats: write.caveats,
    },
    request.signal
  )
}

/** The kind's targets are the drivers of the composite: one stored absent renormalizes over the rest
 *  and reads like a whole model, so naming it is what lets the repair pass fetch it once its source
 *  publishes. */
function toMacroResult(
  view: MacroRiskView,
  provenance: readonly SourceProvenance[],
  caveats: readonly Caveat[]
): RefreshKindResult {
  const targetCount = view.drivers.length + view.missing.length

  return {
    kind: 'macro',
    status: refreshStatus(view.drivers.length, targetCount, 'upserted'),
    targetCount,
    successfulTargetCount: view.drivers.length,
    missingTargets: view.missing.map((entry) => entry.id),
    recordCount: 1,
    provenance,
    caveats,
  }
}

/** A stored read older than a few sessions says nothing about today: the daemon was off, not the
 *  market calm. */
async function previousScoreRegime(
  input: MacroRefreshInput,
  asOf: TradingDay
): Promise<{ previousScoreRegime?: MarketRegime }> {
  const previous = await input.deps.marketDataStore.findMacroRiskBefore({
    region: US_MARKET_REGION,
    formulaVersion: MACRO_FORMULA_VERSION,
    beforeDay: asOf,
    signal: input.request.signal,
  })
  const oldest = input.manifest.calendar.addTradingDays(asOf, -US_REGIME_MEMORY_SESSIONS)

  return previous !== null && previous.asOf >= oldest && previous.scoreRegime !== undefined
    ? { previousScoreRegime: previous.scoreRegime }
    : {}
}
