import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  VnMacroCrossSection,
  VnMacroEvaluation,
} from '@/trading/markets/equity-vn/evidence/macro-evidence'
import type { MarketDataRefreshRequest, MarketManifest } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { reportRefreshStage } from '@/trading/kernel/market/refresh'
import { provenanceOf } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { resolveVnMacroRisk } from '@/trading/markets/equity-vn/evidence/macro-evidence'
import { VN_MARKET_REF, VN_MARKET_REGION } from '@/trading/markets/equity-vn/policy'
import { refreshMacroSeries } from '@/trading/markets/equity-vn/refresh/macro-series'
import { driverObservationDates, isRegimeRated } from '@/trading/markets/macro-risk'
import { refreshStatus } from '@/trading/markets/refresh-result'

interface MacroRefreshInput {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly crossSection: VnMacroCrossSection
  readonly request: MarketDataRefreshRequest
}

/** Runs after the evidence kinds, against the invalidated cross-section: the margin and
 *  foreign-flow confirmers read the population this refresh produced, not the one it replaced. */
export async function refreshMacro(options: MacroRefreshInput): Promise<RefreshKindResult> {
  const { request } = options
  // The session this pass covers, which is what the attempt beside it is stamped with. The request's
  // own `asOf` is the calendar day: one session would gain a row per weekend day under that.
  const asOf = resolveSettledDay(options.manifest.calendar, request.now)

  reportRefreshStage(request.progress, { market: VN_MARKET_REF, kind: 'macro' })

  // Before the read, not beside it: the FX confirmer inside this resolve reads the series a window
  // back, so a pass that wrote it afterwards would arm the confirmer one day late for ever.
  await refreshMacroSeries({
    deps: options.deps,
    calendar: options.manifest.calendar,
    asOf,
    request,
  })

  const result = await resolveVnMacroRisk({
    deps: options.deps,
    crossSection: options.crossSection,
    calendar: options.manifest.calendar,
    request: {
      region: VN_MARKET_REGION,
      asOf,
      now: request.now,
      signal: request.signal,
    },
  })

  // A derivation with no stamp behind it has no source to attribute, and inventing one would put
  // an unverifiable id in the durable row every brief cites.
  if (result.kind === 'unavailable' || result.provenance.length === 0) {
    return buildMacroResult({ recordCount: 0, result })
  }

  await options.deps.marketDataStore.upsertMacroRisk(
    {
      region: VN_MARKET_REGION,
      asOf,
      createdAt: request.now,
      formulaVersion: result.value.view.formulaVersion,
      values: result.value.values,
      observationDates: driverObservationDates(result.value.view.drivers),
      regime: result.value.view.regime,
      ...(isRegimeRated(result.value.view) ? { scoreRegime: result.value.view.scoreRegime } : {}),
      provenance: result.provenance,
      caveats: dedupeCaveats([...result.value.view.caveats, ...result.caveats]),
    },
    request.signal
  )

  return buildMacroResult({ recordCount: 1, result })
}

interface MacroResultInput {
  readonly recordCount: number
  readonly result: SourceResult<VnMacroEvaluation>
}

/** The kind's targets are the drivers of the composite: one stored absent renormalizes over the rest
 *  and reads like a whole model, so naming it here is what lets the repair pass fetch it once its
 *  source publishes. Caveats come from whatever was read; targets only from what was stored, since a
 *  pass that wrote no row reached none. */
function buildMacroResult(input: MacroResultInput): RefreshKindResult {
  const { result, recordCount } = input
  const evaluated = result.kind === 'available' ? result.value.view : undefined
  const stored = recordCount > 0 ? evaluated : undefined
  const missingTargets = stored?.missing.map((entry) => entry.id) ?? []
  const successfulTargetCount = stored?.drivers.length ?? 0
  const targetCount = successfulTargetCount + missingTargets.length
  const caveats = dedupeCaveats([...(evaluated?.caveats ?? []), ...result.caveats])
  const status = refreshStatus(successfulTargetCount, targetCount, 'upserted')

  return {
    kind: 'macro',
    status,
    targetCount,
    successfulTargetCount,
    missingTargets,
    recordCount,
    provenance: provenanceOf(result),
    caveats:
      status === 'unavailable' && caveats.length === 0
        ? [{ code: 'refresh.no-available-provider' }]
        : caveats,
  }
}
