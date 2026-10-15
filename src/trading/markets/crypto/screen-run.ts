import type { Caveat } from '@/trading/kernel/caveat'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  ScreenRejection,
  ScreenRequest,
  ScreenResult,
} from '@/trading/kernel/market/market-capability'
import type { Candle, MarketCapRecord } from '@/trading/kernel/market/market-data'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { VenueListing } from '@/trading/kernel/venue/catalog'
import type {
  CryptoAssetEvidence,
  CryptoMarketContext,
  CryptoWindow,
} from '@/trading/markets/crypto/factors'
import type { CryptoRankedFactors, CryptoScreenInput } from '@/trading/markets/crypto/screen'
import type { MarketDeps } from '@/trading/markets/deps'
import type { EvidenceSeries } from '@/trading/markets/evidence'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { factorComposite } from '@/trading/kernel/factor'
import { countBands } from '@/trading/markets/conviction-calibration'
import {
  cryptoFactorInputs,
  loadAssetBars,
  loadAssetEvidence,
  loadCryptoContext,
} from '@/trading/markets/crypto/factors'
import {
  CRYPTO_EVIDENCE_SESSIONS,
  CRYPTO_FACTOR_POLICY,
  CRYPTO_MARKET_REF,
  CRYPTO_SOURCE_CONCURRENCY,
} from '@/trading/markets/crypto/policy'
import {
  rankCryptoSurvivors,
  screenCryptoCandidate,
  sweepQuote,
} from '@/trading/markets/crypto/screen'
import { cryptoTapeReadings } from '@/trading/markets/crypto/tape/signals'
import {
  cryptoMovers,
  examinedRows,
  isEligibleUniverseRow,
  loadUniverseBoard,
  shallowBoardCaveats,
} from '@/trading/markets/crypto/universe'
import { scoreFactors } from '@/trading/markets/factor-scoring'
import { partitionByGate, partitionByVenueListing } from '@/trading/markets/screen-partition'

interface ScoredUniverse {
  readonly survivors: readonly CryptoScreenInput[]
  readonly rejections: readonly ScreenRejection[]
  readonly factorsByTicker: ReadonlyMap<Ticker, CryptoRankedFactors>
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

interface GatedCandidate {
  readonly candidate: CryptoScreenInput
  readonly bars: EvidenceSeries<readonly Candle[]>
  readonly marketCap: EvidenceSeries<readonly MarketCapRecord[]>
}

interface ScoredCandidate {
  readonly candidate: CryptoScreenInput
  readonly evidence: CryptoAssetEvidence
  readonly factors: CryptoRankedFactors
}

interface ScreenCaveatInput {
  readonly universe: SourceResult<readonly MarketCapRecord[]>
  readonly context: CryptoMarketContext
  readonly scored: ScoredUniverse
  /** The board as the provider served it. `eligible` cannot answer how deep it ran: every row in it
   *  clears the floor by construction, so the shortfall only shows against the unfiltered rows. */
  readonly records: readonly MarketCapRecord[]
  readonly eligible: readonly MarketCapRecord[]
  readonly examined: readonly MarketCapRecord[]
  readonly listing: VenueListing
}

interface EvidenceWindowRequest {
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** Also used by `runFactors`, which scores a single instrument against the same lookback window a
 *  screen ranks the whole board over. */
export function evidenceWindow(
  calendar: TradingCalendar,
  request: EvidenceWindowRequest
): CryptoWindow {
  return {
    asOf: request.asOf,
    fromDay: calendar.addTradingDays(request.asOf, -CRYPTO_EVIDENCE_SESSIONS),
    now: request.now,
    calendar,
    signal: request.signal,
  }
}

/** Universe first, then the examined set, then gates, then ranking, then truncation. Truncating
 *  before ranking would let a candidate that happened to be fetched early crowd out a
 *  higher-scoring one. */
export async function runScreen(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: ScreenRequest
): Promise<ScreenResult> {
  const universe = await loadUniverseBoard(deps, request.signal)

  if (universe.kind === 'unavailable') {
    return emptyCryptoScreen(request.asOf, universe.caveats)
  }

  const window = evidenceWindow(manifest.calendar, request)
  const [listing, context] = await Promise.all([
    deps.venueListings.readListing(CRYPTO_MARKET_REF, request.signal),
    loadCryptoContext(deps, window),
  ])
  const eligible = universe.value.filter(isEligibleUniverseRow)
  // Gated before the evidence budget rather than after it: a name the operator has no book for
  // otherwise takes one of the examined slots and the board ranks fewer names than it paid for.
  const reachable = partitionByVenueListing(eligible, listing, (row) => row.priceUsd)
  const examined = examinedRows(reachable.survivors)
  const scored = await scoreUniverse(deps, examined, window)

  // Bitcoin trades every session the board does, so its newest bar is the session the board
  // describes. `asOf` would date the board to today, which no bar on it covers.
  const dataThroughDay = context.btc.value?.at(-1)?.at
  const ranked = rankCryptoSurvivors(scored.survivors, scored.factorsByTicker)
  const movers = cryptoMovers(universe.value)

  return {
    asOf: request.asOf,
    ...(dataThroughDay === undefined ? {} : { dataThroughDay }),
    candidates: ranked.slice(0, request.limit),
    rejections: [...reachable.rejections, ...scored.rejections],
    // The population the gates and the venue check were applied to, which is what `rejections`
    // describes. How many of them the evidence budget reached is the truncation caveat's answer.
    universeSize: eligible.length,
    bandCounts: countBands(ranked),
    ...(movers === undefined ? {} : { movers }),
    provenance: [...universe.provenance, ...context.btc.provenance, ...scored.provenance],
    caveats: screenCaveats({
      universe,
      context,
      scored,
      records: universe.value,
      eligible: reachable.survivors,
      examined,
      listing,
    }),
  }
}

function emptyCryptoScreen(asOf: TradingDay, caveats: readonly Caveat[]): ScreenResult {
  return { asOf, candidates: [], rejections: [], universeSize: 0, provenance: [], caveats }
}

/** Three evidence sources plus the one limit this screen imposes itself, and the one
 *  degradation that leaves names on the board it cannot vouch for. */
function screenCaveats(input: ScreenCaveatInput): readonly Caveat[] {
  const { eligible, examined } = input

  return [
    ...input.universe.caveats,
    ...input.context.btc.caveats,
    ...input.scored.caveats,
    ...(eligible.length > examined.length
      ? [
          {
            code: 'market-data.universe-truncated' as const,
            detail: { examined: examined.length, eligible: eligible.length },
          },
        ]
      : []),
    ...shallowBoardCaveats(input.records),
    ...(isUnpriced(input.scored) ? [{ code: 'market-data.history-empty' as const }] : []),
    ...(input.listing.kind === 'unavailable'
      ? [{ code: 'market-data.venue-catalog-unavailable' as const }]
      : []),
  ]
}

/** Names without a single candle is an unrefreshed data dir, not a market where nothing qualifies. */
function isUnpriced(scored: ScoredUniverse): boolean {
  return (
    scored.survivors.length === 0 &&
    scored.rejections.length > 0 &&
    scored.rejections.every((rejection) => rejection.code === 'no-price-history')
  )
}

/** Two stages, because the gates read candles alone while funding and the market-cap row are only
 *  ever inputs to a score. Fetching all three up front spent five provider calls on every name the
 *  next line was about to reject. A survivor still scores against the very series it was gated on,
 *  which is what the single-read shape was protecting. */
async function scoreUniverse(
  deps: MarketDeps,
  eligible: readonly MarketCapRecord[],
  window: CryptoWindow
): Promise<ScoredUniverse> {
  const gated: readonly GatedCandidate[] = await mapWithConcurrency(
    eligible,
    CRYPTO_SOURCE_CONCURRENCY,
    async (row) => {
      const bars = await loadAssetBars(deps, row.instrument, window)

      return {
        candidate: {
          instrument: row.instrument,
          name: row.name,
          marketCapUsd: row.marketCapUsd,
          totalVolumeUsd: row.totalVolumeUsd,
          candles: bars.value ?? [],
          liveQuote: sweepQuote(row),
        },
        bars,
        // The sweep's provenance is reported once by `runScreen`; repeating it per candidate would
        // stamp one fetch two dozen times.
        marketCap: { value: [row], provenance: [], caveats: [] },
      }
    }
  )
  const { survivors, rejections } = partitionByGate(
    gated,
    (entry) => entry.candidate.instrument,
    (entry) => screenCryptoCandidate(entry.candidate)
  )
  const scored = await mapWithConcurrency(survivors, CRYPTO_SOURCE_CONCURRENCY, (entry) =>
    scoreCandidate(deps, entry, window)
  )

  return {
    survivors: scored.map((entry) => entry.candidate),
    rejections,
    factorsByTicker: new Map(
      scored.map((entry) => [entry.candidate.instrument.ticker, entry.factors] as const)
    ),
    provenance: [
      ...gated.flatMap((entry) => entry.bars.provenance),
      ...scored.flatMap((entry) => scoringProvenance(entry.evidence)),
    ],
    caveats: [
      ...gated.flatMap((entry) => entry.bars.caveats),
      ...scored.flatMap((entry) => scoringCaveats(entry.evidence)),
    ],
  }
}

async function scoreCandidate(
  deps: MarketDeps,
  entry: GatedCandidate,
  window: CryptoWindow
): Promise<ScoredCandidate> {
  const evidence = await loadAssetEvidence(deps, {
    instrument: entry.candidate.instrument,
    window,
    bars: entry.bars,
    marketCap: entry.marketCap,
  })
  const scored = scoreFactors(cryptoFactorInputs(evidence), CRYPTO_FACTOR_POLICY)

  return {
    candidate: entry.candidate,
    evidence,
    factors: {
      ...factorComposite(scored),
      factors: scored.results,
      signals: cryptoTapeReadings({
        candles: evidence.candles,
        ...(evidence.funding.value === undefined ? {} : { funding: evidence.funding.value }),
      }),
    },
  }
}

/** Funding is the only evidence fetched per survivor: bars come from the gate stage and the
 *  market-cap row from the universe sweep, and both are already reported where they were read. */
function scoringProvenance(evidence: CryptoAssetEvidence): readonly SourceProvenance[] {
  return evidence.funding.provenance
}

function scoringCaveats(evidence: CryptoAssetEvidence): readonly Caveat[] {
  return evidence.funding.caveats
}
