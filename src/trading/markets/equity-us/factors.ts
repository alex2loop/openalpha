import type {
  FactorRequest,
  FactorScore,
  UsEquityFactorId,
  UsEtfFactorId,
} from '@/trading/kernel/factor'
import type { BarRecord, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsBoard, UsBoardCache } from '@/trading/markets/equity-us/board'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import type { MarketManifest } from '@/trading/markets/types'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { runUsBars } from '@/trading/markets/equity-us/bars'
import { US_ETF_FACTOR_POLICY, US_FACTOR_POLICY } from '@/trading/markets/equity-us/factor-policy'
import {
  US_EVIDENCE_SESSIONS,
  US_FUND_MOMENTUM_SESSIONS,
  US_HIGH_PROXIMITY_SESSIONS,
  US_TREND_SESSIONS,
  US_TREND_SLOPE_SESSIONS,
  US_VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { type UsRaws, usBarProvenance, usRawsOf } from '@/trading/markets/equity-us/raws'
import { usAdjustedCloses, usFailedGates } from '@/trading/markets/equity-us/screen'
import { scoreFactors, UNSCORED_COMPOSITE } from '@/trading/markets/factor-scoring'
import {
  nSessionReturn,
  realizedVolatility,
  trendWithSlope,
  yearHighProximity,
} from '@/trading/markets/timeseries'

/** A name the board does not hold, read on demand: any listed name can be asked about, and its
 *  series comes from the store or, failing that, the provider. */
export interface UsSubject {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly onBoard: boolean
  readonly raws?: UsRaws
}

interface UsFactorContext {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly board: UsBoardCache
}

function usEquityFactorInputs(
  raws: UsRaws,
  provenance: readonly SourceProvenance[]
): readonly FactorInput<UsEquityFactorId>[] {
  return [
    inputOf('value', raws.value, provenance),
    inputOf('quality', raws.quality, provenance),
    inputOf('momentum', raws.momentum, provenance),
    inputOf('volatility', raws.volatility, provenance),
  ]
}

/** A fund's price path is its index's: the same statistics a stock's trend and range read. */
function usEtfFactorInputs(
  closes: readonly number[],
  provenance: readonly SourceProvenance[]
): readonly FactorInput<UsEtfFactorId>[] {
  return [
    inputOf(
      'index-trend',
      trendWithSlope(closes, US_TREND_SESSIONS, US_TREND_SLOPE_SESSIONS),
      provenance
    ),
    inputOf('index-momentum', nSessionReturn(closes, US_FUND_MOMENTUM_SESSIONS), provenance),
    inputOf('volatility', realizedVolatility(closes, US_VOLATILITY_SESSIONS), provenance),
    inputOf('high-proximity', yearHighProximity(closes, US_HIGH_PROXIMITY_SESSIONS), provenance),
  ]
}

function inputOf<K extends UsEquityFactorId | UsEtfFactorId>(
  id: K,
  raw: number | undefined,
  provenance: readonly SourceProvenance[]
): FactorInput<K> {
  return { id, ...(raw === undefined ? {} : { raw }), provenance, caveats: [] }
}

export async function runUsFactors(
  context: UsFactorContext,
  request: FactorRequest
): Promise<FactorScore> {
  const board = await context.board.get(request.asOf, request.signal)
  const subject = await resolveSubject(context, board, request)

  if (subject === undefined) {
    return { ...UNSCORED_COMPOSITE, results: [], caveats: [{ code: 'market-data.no-coverage' }] }
  }

  const failed = usFailedGates(subject)

  return {
    ...scoreUsSubject(subject),
    ...(failed.length === 0 ? {} : { failedGates: failed }),
  }
}

export function scoreUsSubject(subject: UsSubject): FactorScore {
  const provenance = usBarProvenance(subject.bars)
  const closes = usAdjustedCloses(subject.bars)

  return subject.record.kind === ETF_KIND
    ? scoreFactors(usEtfFactorInputs(closes, provenance), US_ETF_FACTOR_POLICY)
    : scoreFactors(
        usEquityFactorInputs(subject.raws ?? usRawsOf(closes), provenance),
        US_FACTOR_POLICY
      )
}

async function resolveSubject(
  context: UsFactorContext,
  board: UsBoard,
  request: FactorRequest
): Promise<UsSubject | undefined> {
  const member = board.byTicker.get(request.instrument.ticker)

  if (member !== undefined) {
    return { record: member.record, bars: member.bars, onBoard: true, raws: member.raws }
  }

  const record = await context.deps.marketDataStore.findInstrument({
    instrument: request.instrument,
    signal: request.signal,
  })

  if (record === null) {
    return undefined
  }

  const bars = await onDemandBars(context, request)

  return bars.length === 0 ? undefined : { record, bars, onBoard: false }
}

/** The settled series through the capability, so a name no refresh has reached is read from the
 *  provider once; each candle is stamped with the read's own provenance. */
async function onDemandBars(
  context: UsFactorContext,
  request: FactorRequest
): Promise<readonly BarRecord[]> {
  const result = await runUsBars(context.deps, context.manifest, {
    ...request,
    sessions: US_EVIDENCE_SESSIONS,
  })
  const stamp = result.kind === 'available' ? result.provenance[0] : undefined

  if (result.kind === 'unavailable' || stamp === undefined) {
    return []
  }

  return result.value.map((candle) => ({
    sourceId: stamp.sourceId,
    fetchedAt: stamp.fetchedAt,
    instrument: request.instrument,
    candle,
  }))
}
