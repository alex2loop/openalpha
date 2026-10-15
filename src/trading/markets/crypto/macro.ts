import type { TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { RegionRequest } from '@/trading/kernel/market/market-capability'
import type { Candle, MarketCapRecord } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { EvidenceSeries } from '@/trading/markets/evidence'
import type { MarketManifest } from '@/trading/markets/types'
import { MACRO_SERIES_IDS } from '@/trading/kernel/market/macro-series'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { loadAssetBars } from '@/trading/markets/crypto/factors'
import {
  BTC_REGIME_SESSIONS,
  BTC_TICKER,
  CRYPTO_MACRO_DRIVERS,
  CRYPTO_MARKET_REF,
  ETH_BTC_TREND_SESSIONS,
  ETH_TICKER,
} from '@/trading/markets/crypto/policy'
import { evidenceWindow } from '@/trading/markets/crypto/screen-run'
import { isEligibleUniverseRow, loadUniverseBoard } from '@/trading/markets/crypto/universe'
import { toSeries } from '@/trading/markets/evidence'
import { deriveMacroRisk } from '@/trading/markets/macro-risk'
import { alignedCloses, trendDistance } from '@/trading/markets/timeseries'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

/** A driver's reading with the session it describes. The two bar drivers close on the settled
 *  session; the board is a live rolling week, so it carries today instead. Stamping all three with
 *  the settled day printed a figure that moved between two reads minutes apart under a fixed date. */
interface DriverReading {
  readonly value: number
  readonly observedAt: TradingDay
}

type CryptoMacroReadings = Readonly<Partial<Record<MacroSeriesId, DriverReading>>>

/** The two parallel halves `deriveMacroRisk` takes, named here because its own input type is
 *  internal to the shared fold. */
interface MacroDriverInput {
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  readonly observationDates: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
}

interface DriverDays {
  /** The newest session the bar series closed on. */
  readonly settled: TradingDay
  /** The session in progress, which is what a live board answers for. Read off the clock rather
   *  than from `asOf`: the region's day trails the tape whenever its owner has not settled yet. */
  readonly live: TradingDay
}

/** Crypto's own regime: Bitcoin against its long average, ETH against Bitcoin, and how much of the
 *  liquid board rose this week. Every input is a read the screen already pays for, so
 *  the composite costs the sleeve no new provider. It runs through the shared fold with its own
 *  driver table, so every surface renders it with the same rows and sums as the US one. */
export async function resolveCryptoMacroRisk(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: RegionRequest
): Promise<SourceResult<MacroRiskView>> {
  const window = evidenceWindow(manifest.calendar, request)
  const [btc, eth, universe] = await Promise.all([
    loadAssetBars(deps, { market: CRYPTO_MARKET_REF, ticker: BTC_TICKER }, window),
    loadAssetBars(deps, { market: CRYPTO_MARKET_REF, ticker: ETH_TICKER }, window),
    loadUniverseBoard(deps, request.signal),
  ])
  const board = toSeries(universe)
  const readings = driverReadings(
    { btc, eth, board },
    { settled: btc.value?.at(-1)?.at ?? request.asOf, live: manifest.calendar.dayAt(request.now) }
  )
  const provenance = [...btc.provenance, ...eth.provenance, ...board.provenance]
  const caveats = [...btc.caveats, ...eth.caveats, ...board.caveats]

  if (Object.keys(readings).length === 0) {
    return unavailable('failed', [], caveats)
  }

  return available(
    deriveMacroRisk(
      { ...toMacroInput(readings), region: request.region, asOf: request.asOf, provenance },
      CRYPTO_MACRO_DRIVERS
    ),
    provenance,
    caveats
  )
}

interface DriverInput {
  readonly btc: EvidenceSeries<readonly Candle[]>
  readonly eth: EvidenceSeries<readonly Candle[]>
  readonly board: EvidenceSeries<readonly MarketCapRecord[]>
}

/** Absent, never zero, for a driver its series could not answer: `deriveMacroRisk` reports it as
 *  missing and renormalizes over the rest. Each reading is stamped where it is built, beside the
 *  series it was read from, so no later pass has to remember which of them is live. */
function driverReadings(input: DriverInput, days: DriverDays): CryptoMacroReadings {
  const readings: Partial<Record<MacroSeriesId, DriverReading>> = {}
  const btcTrend = trendDistance(
    (input.btc.value ?? []).map((candle) => candle.close),
    BTC_REGIME_SESSIONS
  )
  const ethBtcTrend = ethAgainstBtcTrend(input.btc.value ?? [], input.eth.value ?? [])
  const breadth = altBreadth(input.board.value ?? [])

  if (btcTrend !== undefined) {
    readings['btc-trend'] = { value: btcTrend * PERCENT_PER_UNIT, observedAt: days.settled }
  }

  if (ethBtcTrend !== undefined) {
    readings['eth-btc-trend'] = { value: ethBtcTrend * PERCENT_PER_UNIT, observedAt: days.settled }
  }

  if (breadth !== undefined) {
    readings['alt-breadth'] = { value: breadth * PERCENT_PER_UNIT, observedAt: days.live }
  }

  return readings
}

/** The ETH/BTC ratio series, aligned by trading day before dividing, against its own moving average.
 *  Dividing by array position is the bug the alignment guards: one missing session on either leg
 *  shifts every later ratio by a day. */
function ethAgainstBtcTrend(btc: readonly Candle[], eth: readonly Candle[]): number | undefined {
  const { a: ethCloses, b: btcCloses } = alignedCloses(eth, btc)
  const ratio = ethCloses.flatMap((close, index) => {
    const denominator = btcCloses[index]

    return denominator === undefined || denominator <= 0 ? [] : [close / denominator]
  })

  return trendDistance(ratio, ETH_BTC_TREND_SESSIONS)
}

/** Share of eligible altcoins up on the week, as a fraction. Absent when no row carries a weekly
 *  change: an unread board is not a flat one. */
function altBreadth(board: readonly MarketCapRecord[]): number | undefined {
  const measured = board.filter(
    (row) =>
      row.instrument.ticker !== BTC_TICKER &&
      isEligibleUniverseRow(row) &&
      row.change7dPct !== undefined
  )

  if (measured.length === 0) {
    return undefined
  }

  return measured.filter((row) => (row.change7dPct ?? 0) > 0).length / measured.length
}

/** Split in one pass so a value and its date cannot come from different walks. Walks the kernel's
 *  own tuple rather than the map's keys, which is what keeps the id typed without an assertion. */
function toMacroInput(readings: CryptoMacroReadings): MacroDriverInput {
  const values: Partial<Record<MacroSeriesId, number>> = {}
  const observationDates: Partial<Record<MacroSeriesId, TradingDay>> = {}

  for (const id of MACRO_SERIES_IDS) {
    const reading = readings[id]

    if (reading !== undefined) {
      values[id] = reading.value
      observationDates[id] = reading.observedAt
    }
  }

  return { values, observationDates }
}
