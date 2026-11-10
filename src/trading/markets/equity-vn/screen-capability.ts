import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorId, FactorScore } from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { Ticker } from '@/trading/kernel/instrument'
import type {
  ScreenCandidate,
  ScreenRequest,
  ScreenResult,
} from '@/trading/kernel/market/market-capability'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/name-evidence'
import type { RankedEvidence, RankedFactors } from '@/trading/markets/equity-vn/screen-rank'
import type { ScreenGateVerdict } from '@/trading/markets/screen-partition'
import { factorComposite } from '@/trading/kernel/factor'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { countBands } from '@/trading/markets/conviction-calibration'
import { latestBarProvenance } from '@/trading/markets/equity-vn/evidence/provenance'
import { supervisionCaveats } from '@/trading/markets/equity-vn/evidence/supervision'
import { latestNameSession, scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { boardReadings } from '@/trading/markets/equity-vn/factors/name-context'
import { DEFAULT_SCREEN_KIND } from '@/trading/markets/equity-vn/policy'
import { exchangeOf } from '@/trading/markets/equity-vn/screen'
import { rankSurvivors } from '@/trading/markets/equity-vn/screen-rank'
import { partitionByGate } from '@/trading/markets/screen-partition'

const HISTORY_EMPTY: Caveat = { code: 'market-data.history-empty' }

export interface ScreenOptions {
  readonly foreignOperator: boolean
}

/** Gates first, ranking second, truncation last. Truncating before ranking would let a candidate
 *  that happened to be validated early crowd out a higher-scoring one. */
export async function runScreen(
  cache: CrossSectionCache,
  request: ScreenRequest,
  options: ScreenOptions
): Promise<ScreenResult> {
  const cross = await cache.get(request.asOf, request.signal)

  // A published-but-empty universe is a cold or failed refresh, not a market without coverage; the
  // two look identical to a caller unless this says so.
  if (cross.names.length === 0) {
    return {
      asOf: request.asOf,
      candidates: [],
      rejections: [],
      universeSize: 0,
      provenance: [],
      caveats: [{ code: 'market-data.universe-empty' }],
    }
  }

  const instrumentKind = request.instrumentKind ?? DEFAULT_SCREEN_KIND
  const eligible = cross.names.filter(
    (name) => name.record.kind === instrumentKind && isInSectors(name, request.sectors)
  )
  const { survivors, rejections } = partitionByGate(
    eligible,
    (name) => name.record.instrument,
    gateVerdictOf
  )
  const dataThroughDay = latestNameSession(eligible)
  const ranked = rankSurvivors(survivors, rankedEvidence(survivors, cross), options)
  const candidates = ranked.slice(0, request.limit)

  return {
    asOf: request.asOf,
    ...(dataThroughDay === undefined ? {} : { dataThroughDay }),
    candidates,
    rejections,
    universeSize: eligible.length,
    bandCounts: countBands(ranked),
    // The rows print the factors too, and a fund's are read off its index rather than its own tape.
    provenance: dedupeProvenance([
      ...eligible.flatMap((name) => latestBarProvenance(name)),
      ...ranked.flatMap((candidate) => candidate.factors.flatMap((factor) => factor.provenance)),
    ]),
    // Names without a single bar is an unrefreshed data dir, not a market where nothing qualifies.
    caveats: [
      ...screenCaveats(cross, eligible, candidates),
      ...(dataThroughDay === undefined && eligible.length > 0 ? [HISTORY_EMPTY] : []),
    ],
  }
}

function isInSectors(name: NameEvidence, sectors: readonly string[] | undefined): boolean {
  return (
    sectors === undefined ||
    (name.record.sector !== undefined && sectors.includes(name.record.sector))
  )
}

/** A name failing three gates records the first. Recording all three would make the reason unstable
 *  across days as unrelated conditions changed, and the user-visible answer to "why not this stock"
 *  should not move for reasons that were already true. */
function gateVerdictOf(name: NameEvidence): ScreenGateVerdict {
  const [code] = name.failedGates

  return code === undefined ? { kind: 'accepted' } : { kind: 'rejected', code }
}

/** Read against the boards this screen actually judged, so a supervision gap on a board holding
 *  none of these names is a gap for nobody. */
function screenCaveats(
  cross: CrossSection,
  eligible: readonly NameEvidence[],
  candidates: readonly ScreenCandidate[]
): readonly Caveat[] {
  const boards = new Set(eligible.map((name) => exchangeOf(name.record)))

  return [
    ...cross.caveats,
    ...supervisionCaveats(cross.supervisionCoverage, boards),
    ...staleFactorCaveats(candidates),
  ]
}

/** The scored reads the rank walks, in one pass over the survivors. */
function rankedEvidence(survivors: readonly NameEvidence[], cross: CrossSection): RankedEvidence {
  const factorsByTicker = new Map<Ticker, RankedFactors>()
  const readingsByTicker = new Map<Ticker, readonly FactorMetric[]>()

  for (const name of survivors) {
    const { ticker } = name.record.instrument

    factorsByTicker.set(ticker, toRankedFactors(scoreNameFactors(name, cross)))
    readingsByTicker.set(ticker, boardReadings(cross, name))
  }

  return { factorsByTicker, readingsByTicker }
}

function toRankedFactors(scored: FactorScore): RankedFactors {
  return { ...factorComposite(scored), factors: scored.results }
}

/** The header dates the board by the newest bar, so a factor scored on a source that stops earlier
 *  needs saying — otherwise the whole row reads as of today. One line per factor, not per name:
 *  twenty names behind one late endpoint is one fact. */
function staleFactorCaveats(candidates: readonly ScreenCandidate[]): readonly Caveat[] {
  const stale = new Set<FactorId>()

  for (const candidate of candidates) {
    for (const factor of candidate.factors) {
      if (factor.caveats.some((caveat) => caveat.code === 'factor.input-stale')) {
        stale.add(factor.id)
      }
    }
  }

  return [...stale]
    .sort((left, right) => left.localeCompare(right))
    .map((factor) => ({ code: 'factor.input-stale', detail: { factor } }))
}
