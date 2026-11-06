import type { MarketRef, PortfolioSegment, Region } from '@/trading/kernel/instrument'
import type { DetectInstrumentOptions, MarketDetection } from '@/trading/markets/detection'
import type { ReadOperatorUse } from '@/trading/markets/operator-use'
import type { Market, MarketRegistry, MarketResolution } from '@/trading/markets/types'
import { ConfigError } from '@/core/errors'
import { ttlCache } from '@/core/utils/collections'
import { nothingUsed } from '@/trading/markets/operator-use'
import { resolveCached } from '@/trading/markets/resolution'
import { createRegistrationPhase } from '@/trading/registry-lifecycle'

const BOUNDARY = 'market'
const RESOLUTION_CACHE_MAXIMUM_ENTRIES = 512
const RESOLUTION_CACHE_TTL_MS = 300_000
export function createMarketRegistry(use: ReadOperatorUse = nothingUsed): MarketRegistry {
  const phase = createRegistrationPhase<Market>(BOUNDARY)
  const ownership = new Map<string, MarketRef>()
  const segments = new Map<PortfolioSegment, MarketRef>()
  const regionOwners = new Map<Region, Market>()
  const resolutions = ttlCache<string, MarketResolution>(
    RESOLUTION_CACHE_TTL_MS,
    RESOLUTION_CACHE_MAXIMUM_ENTRIES
  )

  return {
    register(market) {
      assertManifest(market)

      const key = `${market.manifest.region}:${market.manifest.assetClass}`
      const ownedBy = ownership.get(key)

      if (ownedBy) {
        throw new ConfigError(
          `market ${market.manifest.id} duplicates ${key} owned by ${ownedBy}`,
          undefined,
          [BOUNDARY, market.manifest.id]
        )
      }

      const segmentOwner = segments.get(market.manifest.segment)

      if (segmentOwner) {
        throw new ConfigError(
          `market ${market.manifest.id} duplicates segment ${market.manifest.segment} owned by ${segmentOwner}`,
          undefined,
          [BOUNDARY, market.manifest.id]
        )
      }

      claimRegion(regionOwners, market)

      phase.add(market.manifest.id, market)
      ownership.set(key, market.manifest.id)
      segments.set(market.manifest.segment, market.manifest.id)
    },

    close() {
      phase.close()
      assertEveryRegionHasOwner(phase.entries(), regionOwners)
    },
    find: (ref) => phase.find(ref),
    regionOwner: (region) => regionOwners.get(region) ?? null,
    list: phase.entries,
    resolve: (options) => resolveCached({ markets: phase.entries(), resolutions, use }, options),
    regions: () => unique(phase.entries().map((market) => market.manifest.region)),
    segments: () => {
      phase.entries()

      return [...segments.keys()]
    },
  }
}

function claimRegion(owners: Map<Region, Market>, market: Market): void {
  if (!market.manifest.ownsRegion) {
    return
  }

  const claimed = owners.get(market.manifest.region)

  if (claimed) {
    throw new ConfigError(
      `market ${market.manifest.id} and ${claimed.manifest.id} both claim the ${market.manifest.region} region`,
      undefined,
      [BOUNDARY, market.manifest.id]
    )
  }

  owners.set(market.manifest.region, market)
}

// A region whose markets all decline ownership has no defensible trading day and no macro composite,
// and every brief schedule and cross-market as-of date for it would be a guess. Caught at close,
// because the last registration is the first moment the full set is known.
function assertEveryRegionHasOwner(
  markets: readonly Market[],
  owners: ReadonlyMap<Region, Market>
): void {
  for (const market of markets) {
    if (!owners.has(market.manifest.region)) {
      throw new ConfigError(
        `region ${market.manifest.region} has no market claiming it`,
        undefined,
        [BOUNDARY, market.manifest.id]
      )
    }
  }
}

// A market folder is the extension point, so a malformed manifest must fail at boot rather than at
// first resolution.
function assertManifest(market: Market): void {
  const { manifest } = market
  const path = [BOUNDARY, manifest.id]

  if (manifest.strategyVersion.length === 0) {
    throw new ConfigError(`market ${manifest.id} has an empty strategy version`, undefined, path)
  }

  if (manifest.factorIds.length === 0) {
    throw new ConfigError(`market ${manifest.id} declares no factor ids`, undefined, path)
  }

  if (Object.keys(market.capabilities).length === 0) {
    throw new ConfigError(`market ${manifest.id} exposes no read capability`, undefined, path)
  }

  if (manifest.settlementSessions < 0) {
    throw new ConfigError(`market ${manifest.id} has negative settlement`, undefined, path)
  }

  // A band the rounder cannot use turns `roundToTick` into a pass-through, and every level, R:R and
  // submitted price would then carry a precision the venue never quotes.
  if (manifest.tickSize.bands.length === 0) {
    throw new ConfigError(`market ${manifest.id} declares no tick band`, undefined, path)
  }

  if (manifest.tickSize.bands.some((band) => !(band.tickSize > 0))) {
    throw new ConfigError(`market ${manifest.id} declares a tick band of no size`, undefined, path)
  }
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

type ListedFacts = Pick<
  Extract<MarketDetection, { readonly kind: 'match' }>,
  'sector' | 'instrumentKind'
>

/** What a market's own detector files a held name under, asked only where answering costs nothing:
 *  a `stored` detector reads this process's state, and a `fetched` one would put a provider call on
 *  every valuation. Empty wherever the market cannot say. */
export async function listedFactsOf(
  market: Market,
  options: DetectInstrumentOptions
): Promise<ListedFacts> {
  if (market.manifest.detection !== 'stored') {
    return {}
  }

  const detection = await market.detect(options)

  if (detection.kind !== 'match') {
    return {}
  }

  return {
    ...(detection.sector === undefined ? {} : { sector: detection.sector }),
    ...(detection.instrumentKind === undefined ? {} : { instrumentKind: detection.instrumentKind }),
  }
}
