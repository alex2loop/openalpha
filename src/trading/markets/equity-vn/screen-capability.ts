import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorId, FactorScore } from '@/trading/kernel/factor'
import type { InstrumentRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  ScreenCandidate,
  ScreenRequest,
  ScreenResult,
} from '@/trading/kernel/market/market-capability'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { CrossSection, NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import type { VnExchange } from '@/trading/markets/equity-vn/policy'
import type { RankedEvidence, RankedFactors } from '@/trading/markets/equity-vn/screen'
import { factorComposite } from '@/trading/kernel/factor'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { countBands } from '@/trading/markets/conviction-calibration'
import { latestBarProvenance } from '@/trading/markets/equity-vn/evidence/provenance'
import { supervisionCaveats } from '@/trading/markets/equity-vn/evidence/supervision'
import { scoreNameFactors } from '@/trading/markets/equity-vn/factors/factors'
import { DEFAULT_SCREEN_KIND } from '@/trading/markets/equity-vn/policy'
import { rankSurvivors, screenCandidate, toScreenInput } from '@/trading/markets/equity-vn/screen'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'
import { partitionByGate } from '@/trading/markets/screen-partition'

const HISTORY_EMPTY: Caveat = { code: 'market-data.history-empty' }

/** Gates first, ranking second, truncation last. Truncating before ranking would let a candidate
 *  that happened to be validated early crowd out a higher-scoring one. */
export async function runScreen(
  cache: CrossSectionCache,
  request: ScreenRequest,
  foreignOperator: boolean
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
  const inputs = eligible.map((name) => toScreenInput(name, request.asOf))
  const { survivors, rejections } = partitionByGate(
    inputs,
    (candidate) => candidate.instrument,
    screenCandidate
  )
  const dataThroughDay = latestSessionOf(eligible)
  const ranked = rankSurvivors(survivors, rankedEvidence(survivors, cross), { foreignOperator })
  const candidates = ranked.slice(0, request.limit)

  return {
    asOf: request.asOf,
    ...(dataThroughDay === undefined ? {} : { dataThroughDay }),
    candidates,
    rejections,
    universeSize: eligible.length,
    bandCounts: countBands(ranked),
    provenance: dedupeProvenance(eligible.flatMap((name) => latestBarProvenance(name))),
    // Names without a single bar is an unrefreshed data dir, not a market where nothing qualifies.
    caveats: [
      ...screenCaveats(cross, inputs, candidates),
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

/** Read against the boards this screen actually judged, so a supervision gap on a board holding
 *  none of these names is a gap for nobody. */
function screenCaveats(
  cross: CrossSection,
  inputs: readonly { readonly exchange: VnExchange }[],
  candidates: readonly ScreenCandidate[]
): readonly Caveat[] {
  const boards = new Set(inputs.map((input) => input.exchange))

  return [
    ...cross.caveats,
    ...supervisionCaveats(cross.supervisionCoverage, boards),
    ...staleFactorCaveats(candidates),
  ]
}

/** The scored reads the rank walks, in one pass over the survivors. */
function rankedEvidence(
  survivors: readonly { readonly instrument: InstrumentRef }[],
  cross: CrossSection
): RankedEvidence {
  const factorsByTicker = new Map<Ticker, RankedFactors>()
  const signalsByTicker = new Map<Ticker, readonly TapeReading[]>()

  for (const candidate of survivors) {
    const evidence = cross.byTicker.get(candidate.instrument.ticker)

    factorsByTicker.set(
      candidate.instrument.ticker,
      evidence === undefined
        ? { ...UNSCORED_COMPOSITE, factors: [] }
        : toRankedFactors(scoreNameFactors(evidence, cross))
    )
    signalsByTicker.set(
      candidate.instrument.ticker,
      evidence === undefined ? [] : tapeReadings(evidence)
    )
  }

  return { factorsByTicker, signalsByTicker }
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

/** The newest settled bar across the population — the session the whole board's evidence ends at.
 *  Per-name maxima would let one stale name misdate the board, so the population answers. */
function latestSessionOf(names: readonly NameEvidence[]): TradingDay | undefined {
  let latest: TradingDay | undefined

  for (const name of names) {
    const day = name.bars[name.bars.length - 1]?.candle.at

    if (day !== undefined && (latest === undefined || day > latest)) {
      latest = day
    }
  }

  return latest
}
