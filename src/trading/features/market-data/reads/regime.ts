import type { Region } from '@/trading/kernel/instrument'
import type { MarketRequest } from '@/trading/kernel/market/market-capability'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { ABSENT_REGIME, isRegimeRated, REGIME_SCALE } from '@/trading/markets/macro-risk'

/** Macro may only reduce deployable capital, never raise it. A market that publishes a macro read
 *  and cannot answer is read defensively: a source outage must not license full deployment. */
export async function resolveRegimeScale(
  market: Market,
  options: MarketRequest
): Promise<RegimeScale> {
  const capability = market.capabilities.macroRisk

  if (capability === undefined) {
    return { scale: 1, rated: false, caveats: [] }
  }

  // Dated by the settled session like every printed macro read, so the sleeve is gated by what
  // the operator sees.
  const result = await capability.run({
    region: market.manifest.region,
    asOf: resolveSettledDay(market.manifest.calendar, options.now),
    now: options.now,
    signal: options.signal,
  })

  if (result.kind === 'available') {
    return {
      regime: result.value.regime,
      rated: isRegimeRated(result.value),
      scale: REGIME_SCALE[result.value.regime],
      // Both sets: the view's own reading of its coverage, and what the sources said getting there.
      caveats: dedupeCaveats([...result.caveats, ...result.value.caveats]),
    }
  }

  return {
    regime: ABSENT_REGIME,
    rated: false,
    scale: REGIME_SCALE[ABSENT_REGIME],
    caveats: result.caveats,
  }
}

/** No `asOf`: this read dates itself by the market's own settled session rather than by the day a
 *  caller is viewing, which is what keeps it from stamping a different day than the region read. */
interface SleeveMacroOptions {
  readonly now: number
  readonly signal: AbortSignal
  /** The region whose composite already heads the message this block belongs to — the operator's
   *  own. A message carries exactly one region read, so every other region's owner has to publish
   *  on its own block or not at all. */
  readonly headlineRegion: Region
}

/** The composite that gates this market's sleeve, for the block that sleeve is printed on. Skipped
 *  only where the same read already heads the message: owning *a* region is not that test, because
 *  a message heads with one region and `gold` owns another. Read at the settled session, as the
 *  region read is, so the two never stamp one day two ways. Unavailable travels as caveats, never
 *  as a block. */
export async function sleeveMacroOf(
  market: Market,
  options: SleeveMacroOptions
): Promise<SourceResult<MacroRiskView> | undefined> {
  const capability = market.capabilities.macroRisk
  const headlines = market.manifest.ownsRegion && market.manifest.region === options.headlineRegion

  if (capability === undefined || headlines) {
    return undefined
  }

  return capability.run({
    region: market.manifest.region,
    asOf: resolveSettledDay(market.manifest.calendar, options.now),
    now: options.now,
    signal: options.signal,
  })
}
