import type { TtlCache } from '@/core/utils/collections'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { InstrumentRef, MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { DetectInstrumentOptions, MarketDetection } from '@/trading/markets/detection'
import type {
  Market,
  MarketManifest,
  MarketResolution,
  ResolveMarketOptions,
} from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'

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
const UNIVERSE_EMPTY = 'market-data.universe-empty'
const BOARD_ONLY: Pick<DetectInstrumentOptions, 'boardOnly'> = Object.freeze({ boardOnly: true })

export function nothingHeld(): Promise<readonly InstrumentRef[]> {
  return Promise.resolve([])
}

/** The instruments the operator already holds or watches. A bare ticker one of them carries names
 *  that instrument's market, so a symbol two markets list resolves to the side the operator uses. */
export type HeldInstruments = (signal: AbortSignal) => Promise<readonly InstrumentRef[]>

interface ResolveCache {
  readonly markets: readonly Market[]
  readonly resolutions: TtlCache<string, MarketResolution>
  readonly held: HeldInstruments
}

// Only conclusive unqualified results are cached. An explicit market bypasses the cache, an
// inconclusive resolution is never cached, and an abort propagates before the cache is written.
/** One cache for both shapes: a name qualified by its market and the same name left to the
 *  detectors are different questions with different answers, so they never share a key. */
export async function resolveCached(
  cache: ResolveCache,
  options: ResolveMarketOptions
): Promise<MarketResolution> {
  const { markets, resolutions } = cache
  const preferred =
    options.market === undefined && options.operatorRead === true
      ? await preferredMarket(cache, options)
      : undefined
  const key = buildResolutionKey(options, preferred)
  const cached = resolutions.get(key)

  if (cached !== undefined) {
    return cached
  }

  const resolution =
    options.market === undefined
      ? await resolveUnqualified(markets, options, preferred)
      : await resolveExplicit(markets, { ...options, market: options.market })

  if (isConclusive(resolution)) {
    resolutions.set(key, resolution)
  }

  return resolution
}

// Every field that changes the answer is part of the key, so the cache never serves a wider one.
function buildResolutionKey(options: ResolveMarketOptions, preferred?: MarketRef): string {
  const scope = [
    options.within === undefined ? '' : `in:${[...options.within].sort().join(',')}`,
    options.detection ?? '',
    options.operatorRead === true ? 'read' : '',
    preferred === undefined ? '' : `held:${preferred}`,
  ].join('|')
  const name = options.market === undefined ? options.ticker : `${options.market}/${options.ticker}`

  return scope === '|||' ? name : `${scope}|${name}`
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

  if (!isAskable(market, options)) {
    return unresolved(options.ticker, [])
  }

  const entry = await detectSafely(market, options)
  const [matched] = matchedDetections([entry])

  if (matched !== undefined) {
    return resolvedMarket(matched, entry.caveats)
  }

  // A detector that could not answer is "not today"; only a clean miss is "not listed".
  return unresolved(options.ticker, entry.caveats.length === 0 ? [notListed] : entry.caveats)
}

/** A stored-only ask makes no network request, so a market that fetches is not asked. */
function isAskable(market: Market, options: ResolveMarketOptions): boolean {
  return options.detection !== 'stored' || market.manifest.detection === 'stored'
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

/** The one market a held or watched instrument with this ticker names, among the markets that
 *  could list it. Two held sides is still a choice only the operator can make, so it names none. */
async function preferredMarket(
  cache: ResolveCache,
  options: ResolveMarketOptions
): Promise<MarketRef | undefined> {
  const candidates = new Set(
    cache.markets
      .filter(
        (market) =>
          (options.within === undefined || options.within.includes(market.manifest.id)) &&
          market.candidacy(options.ticker) === 'possible' &&
          isAskable(market, options)
      )
      .map((market) => market.manifest.id)
  )
  const named = new Set(
    (await cache.held(options.signal))
      .filter((ref) => ref.ticker === options.ticker && candidates.has(ref.market))
      .map((ref) => ref.market)
  )
  const [only] = [...named]

  return named.size === 1 ? only : undefined
}

/** The held side wins when its own detector confirms the ticker; otherwise the ticker resolves as
 *  it would for an operator who holds nothing. */
async function resolveUnqualified(
  markets: readonly Market[],
  options: ResolveMarketOptions,
  preferred: MarketRef | undefined
): Promise<MarketResolution> {
  if (preferred !== undefined) {
    const held = await resolveExplicit(markets, { ...options, market: preferred })

    if (held.kind === 'resolved') {
      const others = await otherListingCaveats(
        possibleMarkets(markets, options),
        held.market,
        options
      )

      return { ...held, caveats: [...held.caveats, ...others] }
    }
  }

  return resolve(markets, options)
}

// Unqualified tickers only: resolveCached routes an explicit market to resolveExplicit.
async function resolve(
  markets: readonly Market[],
  options: ResolveMarketOptions
): Promise<MarketResolution> {
  const possible = possibleMarkets(markets, options)
  const stored = await detectEach(possible, 'stored', options)
  const settled = matchedDetections(stored)
  const [only] = settled

  // A market answering out of stored state settles the ticker on its own. Asking a provider to
  // confirm that nobody else lists it would spend a lookup on every equity ticker, and the answer
  // it buys is a collision the operator resolves by naming the market instead.
  if (settled.length === 1 && only !== undefined) {
    return resolvedMarket(only, [
      ...uncheckedMarketCaveats(stored, options.ticker),
      ...(options.operatorRead === true
        ? await otherListingCaveats(possible, only.market, options)
        : []),
    ])
  }

  const detections = [
    ...stored,
    ...(options.detection === 'stored' ? [] : await detectEach(possible, 'fetched', options)),
  ]
  const matches = matchedDetections(detections)
  const caveats = detections.flatMap((entry) => entry.caveats)

  if (matches.length === 0) {
    return unresolved(options.ticker, missCaveats(detections))
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

/** The synchronous filter runs first so an unqualified ticker never reaches an async detector.
 *  `impossible` means the detector would not have matched, so skipping cannot change the winner. */
function possibleMarkets(
  markets: readonly Market[],
  options: ResolveMarketOptions
): readonly Market[] {
  return markets.filter(
    (market) =>
      (options.within === undefined || options.within.includes(market.manifest.id)) &&
      market.candidacy(options.ticker) === 'possible'
  )
}

/** A read settled on one market without asking the rest. The operator typed the name, so the rest
 *  are asked now and any that list it too are named: otherwise a coin symbol that is also a stock
 *  reads one side with nothing to say the other exists. A detector that could not answer stays
 *  silent, since the note is not the check the answer rests on. */
async function otherListingCaveats(
  possible: readonly Market[],
  winner: Market,
  options: ResolveMarketOptions
): Promise<readonly Caveat[]> {
  const others = possible.filter((market) => market !== winner && isAskable(market, options))
  // A courtesy note is never worth a per-symbol network lookup on every read.
  const detections = await Promise.all(
    others.map((market) => detectSafely(market, options, BOARD_ONLY))
  )

  return matchedDetections(detections).map(
    (entry): Caveat => ({
      code: 'market.ticker-also-listed',
      detail: {
        ticker: options.ticker,
        market: winner.manifest.id,
        other: entry.market.manifest.id,
      },
    })
  )
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
    ...(detection.name === undefined ? {} : { name: detection.name }),
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
  // A universe that was never stored holds nothing the ticker could collide with: the operator has
  // not refreshed that market (a Vietnamese book never loads the US listing, and the reverse), so
  // its empty answer is not a check that failed. Only a detector that errored or could not ask is.
  return detections
    .filter((entry) => entry.caveats.some((caveat) => caveat.code !== UNIVERSE_EMPTY))
    .map(
      (entry): Caveat => ({
        code: 'market.detection-partial',
        detail: { ticker, market: entry.market.manifest.id },
      })
    )
}

/** A market never refreshed says nothing about a ticker another market's stored listing checked and
 *  missed, so "run /refresh" is the answer only while no listing has been checked. */
function missCaveats(detections: readonly MarketDetectionEntry[]): readonly Caveat[] {
  const caveats = detections.flatMap((entry) => entry.caveats)
  const isListingChecked = detections.some(
    (entry) => entry.detection.kind === 'no-match' && entry.detection.listingChecked === true
  )

  return isListingChecked ? caveats.filter((caveat) => caveat.code !== UNIVERSE_EMPTY) : caveats
}

// One detector throwing must not fail resolution for the others: it becomes "does not match" plus a
// caveat naming the market. The caller's own abort is rethrown untouched.
async function detectSafely(
  market: Market,
  options: ResolveMarketOptions,
  scope: Pick<DetectInstrumentOptions, 'boardOnly'> = {}
): Promise<MarketDetectionEntry> {
  try {
    const detection = await market.detect({
      ticker: options.ticker,
      signal: options.signal,
      ...scope,
    })

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
