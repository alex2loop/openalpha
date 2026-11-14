import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type {
  MarketDataInstrumentRequest,
  MarketDataPriceChartRequest,
  PriceAverage,
  PriceChart,
  PriceWindow,
  RelativeVolumeReading,
} from '@/trading/features/market-data/types'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { resolveInstrument, unsupportedCapability } from '@/trading/features/market-data/resolve'
import { available } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { NAME_VOLUME_SESSIONS } from '@/trading/markets/name-readings'
import { movingAverage, relativeVolume } from '@/trading/markets/timeseries'

const PRICE_WINDOW_SESSIONS: Readonly<Record<PriceWindow, number>> = {
  '1m': 21,
  '3m': 63,
  '6m': 126,
  '1y': 250,
}
const PRICE_AVERAGE_SESSIONS = Object.freeze([50, 200])
const LONGEST_AVERAGE_SESSIONS = Math.max(...PRICE_AVERAGE_SESSIONS)

/** The window's candles with the averages the chart overlays. The series is read the longest
 *  average's sessions further back, so the first candle shown already has its average. */
export async function runPriceChart(
  deps: MarketDataRunDeps,
  options: MarketDataPriceChartRequest
): Promise<SourceResult<PriceChart>> {
  const shownSessions = PRICE_WINDOW_SESSIONS[options.window]
  const result = await readSettledBars(deps, options, shownSessions + LONGEST_AVERAGE_SESSIONS)

  if (result.kind === 'unavailable') {
    return result
  }

  const candles = result.value
  const shown = Math.min(shownSessions, candles.length)

  if (shown === 0) {
    return unsupportedCapability([{ code: 'market-data.insufficient-history' }])
  }

  const closes = candles.map((candle) => candle.close)
  const averages = PRICE_AVERAGE_SESSIONS.flatMap((sessions) => {
    const average = toPriceAverage(closes, sessions, shown)

    return average === undefined ? [] : [average]
  })
  const relative = toRelativeVolume(candles)

  return available(
    {
      window: options.window,
      candles: candles.slice(candles.length - shown),
      averages,
      ...(relative === undefined ? {} : { relativeVolume: relative }),
    },
    result.provenance,
    result.caveats
  )
}

/** The average ending on each of the last `shown` closes; absent where fewer than `sessions` closes
 *  stand behind it. A line with nothing to draw is dropped rather than sent all absent. */
function toPriceAverage(
  closes: readonly number[],
  sessions: number,
  shown: number
): PriceAverage | undefined {
  const series = movingAverage(closes, sessions)
  const firstShown = closes.length - shown
  const values = Array.from({ length: shown }, (_, offset) => {
    const index = firstShown + offset - (sessions - 1)

    return index < 0 ? undefined : series[index]
  })

  return values.some((value) => value !== undefined) ? { sessions, values } : undefined
}

export async function runRelativeVolume(
  deps: MarketDataRunDeps,
  options: MarketDataInstrumentRequest
): Promise<SourceResult<RelativeVolumeReading>> {
  const result = await readSettledBars(deps, options, NAME_VOLUME_SESSIONS + 1)

  if (result.kind === 'unavailable') {
    return result
  }

  const reading = toRelativeVolume(result.value)

  return reading === undefined
    ? unsupportedCapability([{ code: 'market-data.insufficient-history' }])
    : available(reading, result.provenance, result.caveats)
}

/** Absent for a halted name, whose last candle carries the previous close and no trade, and where
 *  the series is too short to hold the baseline. */
function toRelativeVolume(candles: readonly Candle[]): RelativeVolumeReading | undefined {
  const last = candles.at(-1)

  if (last === undefined || !(last.volume > 0)) {
    return undefined
  }

  const ratio = relativeVolume(
    candles.map((candle) => candle.volume),
    NAME_VOLUME_SESSIONS
  )

  return ratio === undefined
    ? undefined
    : { day: last.at, volume: last.volume, sessions: NAME_VOLUME_SESSIONS, ratio }
}

/** A market with no bars of its own answers unsupported: VN gold's series is world gold in USD, and
 *  drawing it under a dong price would be another instrument's tape. */
async function readSettledBars(
  deps: MarketDataRunDeps,
  options: MarketDataInstrumentRequest,
  sessions: number
): Promise<SourceResult<readonly Candle[]>> {
  const resolved = await resolveInstrument(deps.markets, options)

  if (resolved.kind === 'unresolved') {
    return resolved.result
  }

  const { market, instrument } = resolved
  const result =
    market.manifest.referenceBarsOnly === true
      ? undefined
      : await market.capabilities.bars?.run({
          instrument,
          sessions,
          asOf: resolveSettledDay(market.manifest.calendar, options.now),
          now: options.now,
          signal: options.signal,
        })

  return result ?? unsupportedCapability()
}
