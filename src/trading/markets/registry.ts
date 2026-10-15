import type { TtlCache } from '@/core/utils/collections'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { MarketRef, PortfolioSegment, Region, Ticker } from '@/trading/kernel/instrument'
import type {
  DetectInstrumentOptions,
  Market,
  MarketDetection,
  MarketManifest,
  MarketRegistry,
  MarketResolution,
  ResolveMarketOptions,
} from '@/trading/markets/types'
import { ConfigError, isAbortError } from '@/core/errors'
import { ttlCache } from '@/core/utils/collections'
import { createRegistrationPhase } from '@/trading/registry-lifecycle'

const BOUNDARY = 'market'
const RESOLUTION_CACHE_MAXIMUM_ENTRIES = 512
const RESOLUTION_CACHE_TTL_MS = 300_000
const INCONCLUSIVE_CODES: ReadonlySet<CaveatCode> = new Set([
  'market.detector-failed',
  'market-data.universe-empty',
])

/** Misses a detector already accounted for. Adding `ticker-unknown` on top of one would answer
 *  "no market lists it" over a market that does and said why it will not resolve it. */
const EXPLAINED_MISS_CODES: ReadonlySet<CaveatCode> = new Set([
  'market.ticker-shared',
  'market.ticker-not-active',
  'market.ticker-not-listed',
])

export function createMarketRegistry(): MarketRegistry {
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
    resolve: (options) => resolveCached(phase.entries(), resolutions, options),
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

// Only conclusive unqualified results are cached. An explicit market bypasses the cache, an
// inconclusive resolution is never cached, and an abort propagates before the cache is written.
/** One cache for both shapes: a name qualified by its market and the same name left to the
 *  detectors are different questions with different answers, so they never share a key. */
async function resolveCached(
  markets: readonly Market[],
  resolutions: TtlCache<string, MarketResolution>,
  options: ResolveMarketOptions
): Promise<MarketResolution> {
  const key = buildResolutionKey(options)
  const cached = resolutions.get(key)

  if (cached !== undefined) {
    return cached
  }

  const resolution =
    options.market === undefined
      ? await resolve(markets, options)
      : await resolveExplicit(markets, { ...options, market: options.market })

  if (isConclusive(resolution)) {
    resolutions.set(key, resolution)
  }

  return resolution
}

function buildResolutionKey(options: ResolveMarketOptions): string {
  return options.market === undefined ? options.ticker : `${options.market}/${options.ticker}`
}

/** A detector that threw and a market whose universe has not been refreshed both answer "not
 *  today" rather than "not ever". Caching either would outlive the repair by the whole TTL — a
 *  refresh would land and every ticker would still resolve to nothing. */
function isConclusive(resolution: MarketResolution): boolean {
  return !resolution.caveats.some((caveat) => INCONCLUSIVE_CODES.has(caveat.code))
}

async function resolveExplicit(
  markets: readonly Market[],
  options: ResolveMarketOptions & { readonly market: MarketRef }
): Promise<MarketResolution> {
  const market = markets.find((candidate) => candidate.manifest.id === options.market)

  if (!market) {
    return {
      kind: 'market-not-registered',
      ticker: options.ticker,
      market: options.market,
      caveats: [{ code: 'market.not-registered', detail: { market: options.market } }],
    }
  }

  const notListed: Caveat = {
    code: 'market.ticker-not-listed',
    detail: { ticker: options.ticker, market: options.market },
  }

  // The same filter the unqualified path runs before dispatching: naming the market chooses which
  // detector answers, never whether the market would list the ticker at all.
  if (market.candidacy(options.ticker) === 'impossible') {
    return unresolved(options.ticker, [notListed])
  }

  const entry = await detectSafely(market, options)
  const [matched] = matchedDetections([entry])

  if (matched !== undefined) {
    return resolvedMarket(matched, entry.caveats)
  }

  // A detector that could not answer is "not today"; only a clean miss is "not listed".
  return unresolved(options.ticker, entry.caveats.length === 0 ? [notListed] : entry.caveats)
}

function unresolved(candidate: Ticker, caveats: readonly Caveat[]): MarketResolution {
  if (caveats.some((caveat) => INCONCLUSIVE_CODES.has(caveat.code))) {
    return { kind: 'unavailable', ticker: candidate, caveats }
  }

  const explained = caveats.some((caveat) => EXPLAINED_MISS_CODES.has(caveat.code))

  return {
    kind: 'unsupported',
    ticker: candidate,
    caveats: explained
      ? caveats
      : [...caveats, { code: 'market.ticker-unknown', detail: { ticker: candidate } }],
  }
}

// Unqualified tickers only: resolveCached routes an explicit market to resolveExplicit.
async function resolve(
  markets: readonly Market[],
  options: ResolveMarketOptions
): Promise<MarketResolution> {
  // The synchronous filter runs first so an unqualified ticker never reaches an async detector.
  // `impossible` means the detector would not have matched, so skipping cannot change the winner.
  const possible = markets.filter((market) => market.candidacy(options.ticker) === 'possible')
  const stored = await detectEach(possible, 'stored', options)
  const settled = matchedDetections(stored)
  const [only] = settled

  // A market answering out of stored state settles the ticker on its own. Asking a provider to
  // confirm that nobody else lists it would spend a lookup on every equity ticker, and the answer
  // it buys is a collision the operator resolves by naming the market instead.
  if (settled.length === 1 && only !== undefined) {
    return resolvedMarket(only, uncheckedMarketCaveats(stored, options.ticker))
  }

  const detections = [...stored, ...(await detectEach(possible, 'fetched', options))]
  const matches = matchedDetections(detections)
  const caveats = detections.flatMap((entry) => entry.caveats)

  if (matches.length === 0) {
    return unresolved(options.ticker, caveats)
  }

  const [first] = matches

  if (matches.length === 1 && first !== undefined) {
    return resolvedMarket(first, uncheckedMarketCaveats(detections, options.ticker))
  }

  const candidates = sortCandidates(matches.map((entry) => entry.market))

  return {
    kind: 'ambiguous-market',
    ticker: options.ticker,
    candidates,
    caveats: [
      ...caveats,
      {
        code: 'market.ticker-ambiguous',
        detail: { ticker: options.ticker, markets: candidates.join(', ') },
      },
    ],
  }
}

interface MarketDetectionEntry {
  readonly market: Market
  readonly detection: MarketDetection
  readonly caveats: readonly Caveat[]
}

interface MatchedMarket {
  readonly market: Market
  readonly detection: Extract<MarketDetection, { readonly kind: 'match' }>
}

function detectEach(
  markets: readonly Market[],
  detection: MarketManifest['detection'],
  options: ResolveMarketOptions
): Promise<readonly MarketDetectionEntry[]> {
  return Promise.all(
    markets
      .filter((market) => market.manifest.detection === detection)
      .map((market) => detectSafely(market, options))
  )
}

function matchedDetections(entries: readonly MarketDetectionEntry[]): readonly MatchedMarket[] {
  return entries.flatMap((entry) =>
    entry.detection.kind === 'match' ? [{ market: entry.market, detection: entry.detection }] : []
  )
}

function resolvedMarket(matched: MatchedMarket, caveats: readonly Caveat[]): MarketResolution {
  const { detection } = matched

  return {
    kind: 'resolved',
    market: matched.market,
    instrument: detection.instrument,
    ...(detection.sector === undefined ? {} : { sector: detection.sector }),
    ...(detection.indexTier === undefined ? {} : { indexTier: detection.indexTier }),
    ...(detection.instrumentKind === undefined ? {} : { instrumentKind: detection.instrumentKind }),
    caveats,
  }
}

/** Every caveat a detector attaches to a miss says it could not check. Over a single match those
 *  codes claim nothing resolved for a ticker that did, and hold the answer out of the resolution
 *  cache, so the markets left unchecked are named instead. */
function uncheckedMarketCaveats(
  detections: readonly MarketDetectionEntry[],
  ticker: Ticker
): readonly Caveat[] {
  return detections
    .filter((entry) => entry.caveats.length > 0)
    .map(
      (entry): Caveat => ({
        code: 'market.detection-partial',
        detail: { ticker, market: entry.market.manifest.id },
      })
    )
}

// One detector throwing must not fail resolution for the others: it becomes "does not match" plus a
// caveat naming the market. The caller's own abort is rethrown untouched.
async function detectSafely(
  market: Market,
  options: ResolveMarketOptions
): Promise<MarketDetectionEntry> {
  try {
    const detection = await market.detect({ ticker: options.ticker, signal: options.signal })

    return {
      market,
      detection,
      caveats: detection.kind === 'no-match' ? (detection.caveats ?? []) : [],
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return {
      market,
      detection: { kind: 'no-match' },
      caveats: [
        {
          code: 'market.detector-failed',
          detail: { ticker: options.ticker, market: market.manifest.id },
        },
      ],
    }
  }
}

// Stable for rendering and comparison; it never chooses a winner, since two matches are ambiguous.
function sortCandidates(markets: readonly Market[]): readonly MarketRef[] {
  return [...markets]
    .sort((left, right) =>
      left.manifest.region === right.manifest.region
        ? left.manifest.assetClass.localeCompare(right.manifest.assetClass)
        : left.manifest.region.localeCompare(right.manifest.region)
    )
    .map((market) => market.manifest.id)
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
