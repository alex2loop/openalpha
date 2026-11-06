import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  PreviousClose,
  ScreenCandidate,
  ScreenRequest,
  ScreenResult,
} from '@/trading/kernel/market/market-capability'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { UsBoardCache } from '@/trading/markets/equity-us/board'
import type { UsSubject } from '@/trading/markets/equity-us/factors'
import { factorComposite } from '@/trading/kernel/factor'
import { ETF_KIND, exposureSectorOf } from '@/trading/kernel/instrument'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { countBands } from '@/trading/markets/conviction-calibration'
import { scoreUsSubject } from '@/trading/markets/equity-us/factors'
import { US_LIQUIDITY_SESSIONS, US_VOLATILITY_SESSIONS } from '@/trading/markets/equity-us/policy'
import { usBarProvenance } from '@/trading/markets/equity-us/raws'
import { screenUsCandidate, usAdjustedCloses } from '@/trading/markets/equity-us/screen'
import { partitionByGate } from '@/trading/markets/screen-partition'
import { realizedVolatility, sessionChange } from '@/trading/markets/timeseries'
import { medianTurnover } from '@/trading/markets/turnover'

const PERCENT_PER_UNIT = 100
const HISTORY_EMPTY: Caveat = { code: 'market-data.history-empty' }
const DEFAULT_SCREEN_KIND = 'equity'

/** Gates first, ranking second, truncation last: truncating before ranking would let a candidate
 *  that happened to be validated early crowd out a higher-scoring one. */
export async function runUsScreen(
  boards: UsBoardCache,
  request: ScreenRequest
): Promise<ScreenResult> {
  const board = await boards.get(request.asOf, request.signal, request)
  const kind = request.instrumentKind ?? DEFAULT_SCREEN_KIND
  const subjects: readonly UsSubject[] =
    kind === ETF_KIND
      ? board.funds.map((fund) => ({ ...fund, onBoard: true }))
      : board.names.map((name) => ({ ...name, onBoard: true }))
  const eligible = subjects.filter((subject) => isInSectors(subject, request.sectors))
  const { survivors, rejections } = partitionByGate(
    eligible,
    (subject) => subject.record.instrument,
    screenUsCandidate
  )
  const ranked = rank(survivors)
  const dataThroughDay = latestSessionOf(eligible)

  return {
    asOf: request.asOf,
    ...(dataThroughDay === undefined ? {} : { dataThroughDay }),
    candidates: ranked.slice(0, request.limit),
    rejections,
    universeSize: eligible.length,
    bandCounts: countBands(ranked),
    provenance: dedupeProvenance(
      eligible.flatMap((subject) => [
        ...usBarProvenance(subject.bars),
        ...(subject.accountsProvenance ?? []),
      ])
    ),
    // Names without a single bar is an unrefreshed data dir, not a market where nothing qualifies.
    caveats: dataThroughDay === undefined && eligible.length > 0 ? [HISTORY_EMPTY] : [],
  }
}

function isInSectors(subject: UsSubject, sectors: readonly string[] | undefined): boolean {
  return (
    sectors === undefined ||
    (subject.record.sector !== undefined && sectors.includes(subject.record.sector))
  )
}

/** Score descending, then traded value, then ticker: a total order, so paging is stable across
 *  reruns of the same day. */
function rank(survivors: readonly UsSubject[]): readonly ScreenCandidate[] {
  return survivors
    .map((subject) => ({
      candidate: toCandidate(subject),
      traded: medianTurnover(subject.bars, US_LIQUIDITY_SESSIONS) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.candidate.composite.score - a.candidate.composite.score ||
        b.traded - a.traded ||
        a.candidate.instrument.ticker.localeCompare(b.candidate.instrument.ticker)
    )
    .map((entry) => entry.candidate)
}

function toCandidate(subject: UsSubject): ScreenCandidate {
  const scored = scoreUsSubject(subject)
  const closes = usAdjustedCloses(subject.bars)
  const previousClose = lastClose(subject.bars)
  const volatilityDaily = realizedVolatility(closes, US_VOLATILITY_SESSIONS)
  const { name, kind } = subject.record
  const sector = exposureSectorOf(kind, subject.record.sector)

  return {
    instrument: subject.record.instrument,
    name,
    ...(sector === undefined ? {} : { sector }),
    composite: factorComposite(scored),
    factors: scored.results,
    ...(previousClose === undefined ? {} : { previousClose }),
    ...(volatilityDaily === undefined ? {} : { volatilityDaily }),
  }
}

/** The close the rank was built on and what that session moved. */
function lastClose(bars: readonly BarRecord[]): PreviousClose | undefined {
  const newest = bars.at(-1)

  if (newest === undefined) {
    return undefined
  }

  const change = sessionChange(usAdjustedCloses(bars))

  return {
    price: newest.candle.close,
    at: newest.candle.at,
    ...(change === undefined ? {} : { changePct: change * PERCENT_PER_UNIT }),
  }
}

function latestSessionOf(subjects: readonly UsSubject[]): TradingDay | undefined {
  let latest: TradingDay | undefined

  for (const subject of subjects) {
    const day = subject.bars.at(-1)?.candle.at

    if (day !== undefined && (latest === undefined || day > latest)) {
      latest = day
    }
  }

  return latest
}
