import type { Caveat } from '@/trading/kernel/caveat'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FundingSnapshot, MarketCapRecord } from '@/trading/kernel/market/market-data'
import type {
  MarketDataOverview,
  MarketDataOverviewRow,
  MarketDerivatives,
  MarketLeaders,
  MarketMovers,
  MarketTakerFlow,
} from '@/trading/kernel/market/market-overview'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { dedupeProvenance, provenanceOf } from '@/trading/kernel/source/source-result'
import { formatZonedTime } from '@/trading/markets/calendar'
import {
  BTC_TICKER,
  CRYPTO_MARKET_REF,
  CRYPTO_OVERVIEW_LEADERS,
  CRYPTO_OVERVIEW_NAMES,
  CRYPTO_TAKER_SESSIONS,
} from '@/trading/markets/crypto/policy'
import {
  boardBreadth,
  cryptoMovers,
  isEligibleUniverseRow,
  loadUniverseBoard,
  shallowBoardCaveats,
} from '@/trading/markets/crypto/universe'

const PERCENT_PER_UNIT = 100

interface CryptoOverviewLoad {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly asOf: TradingDay
  readonly signal: AbortSignal
}

/** One ranked universe read carries the headline names, the whole market's capitalisation and its
 *  traded value, so the levels and the roll-ups cost a single request between them. Sentiment is the
 *  second and last: it is the one reading no price series contains. */
export async function runCryptoOverview(load: CryptoOverviewLoad): Promise<MarketDataOverview> {
  const [universe, sentiment, derivatives, etfFlows, headlineBars] = await Promise.all([
    loadUniverseBoard(load.deps, load.signal),
    loadSentiment(load),
    loadDerivatives(load),
    loadEtfFlows(load),
    loadHeadlineBars(load),
  ])
  const records = universe.kind === 'available' ? universe.value : []
  const marketCap = totalMarketCap(records)
  const breadth = boardBreadth(records)

  return {
    market: load.manifest.id,
    asOf: load.asOf,
    currency: load.manifest.currency,
    priceCurrency: load.manifest.currency,
    icon: load.manifest.icon,
    rows: headlineRows(load.manifest.calendar, records, headlineBars.byTicker),
    ...(marketCap === undefined ? {} : { marketCap }),
    ...optionalTurnover(records),
    ...optionalLargestShare(records, marketCap),
    ...optionalLeaders(records),
    ...optionalMovers(records),
    ...(breadth === undefined ? {} : { breadth }),
    ...(sentiment.kind === 'available' ? { sentiment: sentiment.value } : {}),
    ...(derivatives.kind === 'available' ? { derivatives: toDerivatives(derivatives.value) } : {}),
    ...(etfFlows.kind === 'available' ? { etfFlows: etfFlows.value } : {}),
    ...optionalTakerShare(headlineBars.byTicker.get(BTC_TICKER) ?? [], load.asOf),
    provenance: dedupeProvenance([
      ...provenanceOf(universe),
      ...provenanceOf(sentiment),
      ...provenanceOf(derivatives),
      ...provenanceOf(etfFlows),
      ...headlineBars.provenance,
    ]),
    caveats: dedupeCaveats([
      ...universe.caveats,
      ...sentiment.caveats,
      ...derivatives.caveats,
      ...etfFlows.caveats,
      ...headlineBars.caveats,
      // The roll-ups and the movers list are folds over this board, so a shallow one understates
      // them all while reading as the whole market.
      ...shallowBoardCaveats(records),
    ]),
  }
}

function loadSentiment(load: CryptoOverviewLoad) {
  return load.deps.sources.resolve({
    kind: 'sentiment',
    context: { market: CRYPTO_MARKET_REF },
    signal: load.signal,
  })
}

/** The market's derivatives read is the majors' funding market: BTC is the contract everyone watches,
 *  so its crowding is the market's crowding. */
function loadDerivatives(load: CryptoOverviewLoad) {
  return load.deps.sources.resolve({
    kind: 'funding',
    context: {
      market: CRYPTO_MARKET_REF,
      instrument: { market: CRYPTO_MARKET_REF, ticker: BTC_TICKER },
    },
    signal: load.signal,
  })
}

interface HeadlineBars {
  readonly byTicker: ReadonlyMap<Ticker, readonly Candle[]>
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** One bar read per headline name, so each row carries the settled close its move is measured
 *  against. BTC's series doubles as the taker-share input, which is why the window is the taker
 *  window rather than one of its own. */
async function loadHeadlineBars(load: CryptoOverviewLoad): Promise<HeadlineBars> {
  const results = await Promise.all(
    CRYPTO_OVERVIEW_NAMES.map(async (name) => [name, await loadBars(load, name)] as const)
  )

  return {
    byTicker: new Map(
      results.map(([name, result]) => [name, result.kind === 'available' ? result.value : []])
    ),
    provenance: dedupeProvenance(results.flatMap(([, result]) => provenanceOf(result))),
    caveats: dedupeCaveats(results.flatMap(([, result]) => result.caveats)),
  }
}

function loadBars(
  load: CryptoOverviewLoad,
  name: Ticker
): Promise<SourceResult<readonly Candle[]>> {
  return load.deps.sources.resolve({
    kind: 'bars',
    context: {
      market: CRYPTO_MARKET_REF,
      instrument: { market: CRYPTO_MARKET_REF, ticker: name },
      fromDay: load.manifest.calendar.addTradingDays(load.asOf, -CRYPTO_TAKER_SESSIONS),
      toDay: load.asOf,
      limit: CRYPTO_TAKER_SESSIONS,
    },
    signal: load.signal,
  })
}

function loadEtfFlows(load: CryptoOverviewLoad) {
  return load.deps.sources.resolve({
    kind: 'etfFlows',
    context: { market: CRYPTO_MARKET_REF },
    signal: load.signal,
  })
}

/** The newest bar that closed: today's is still filling, and a share taken from a partial session
 *  reports a different market on every run. Absent whenever no closed bar carries the field, since
 *  only a venue that states the aggressor publishes one. */
/** The newest session that has actually closed, which is never `asOf`: this market's block is dated
 *  by the live board, so the reading carries its own day or it reads as today's. */
function optionalTakerShare(
  candles: readonly Candle[],
  asOf: TradingDay
): { takerFlow?: MarketTakerFlow } {
  const closed = candles.filter((candle) => candle.at < asOf)
  const newest = closed[closed.length - 1]

  if (newest?.takerBuyVolume === undefined || newest.volume <= 0) {
    return {}
  }

  return {
    takerFlow: {
      at: newest.at,
      buyPct: (newest.takerBuyVolume / newest.volume) * PERCENT_PER_UNIT,
    },
  }
}

function toDerivatives(snapshot: FundingSnapshot): MarketDerivatives {
  return {
    observedAt: snapshot.observedAt,
    fundingDailyPct: snapshot.fundingDailyPct,
    windowDays: snapshot.windowDays,
    ...(snapshot.openInterestUsd === undefined
      ? {}
      : { openInterestUsd: snapshot.openInterestUsd }),
    ...(snapshot.openInterestRatio === undefined
      ? {}
      : { openInterestRatio: snapshot.openInterestRatio }),
    ...(snapshot.longShortRatio === undefined ? {} : { longShortRatio: snapshot.longShortRatio }),
  }
}

/** The named reference assets, in the order policy lists them — not the top of the ranking, which
 *  would rotate the headline row whenever a new coin out-capitalised one of them. */
function headlineRows(
  calendar: TradingCalendar,
  records: readonly MarketCapRecord[],
  bars: ReadonlyMap<Ticker, readonly Candle[]>
): readonly MarketDataOverviewRow[] {
  return CRYPTO_OVERVIEW_NAMES.flatMap((name) => {
    const record = records.find((candidate) => candidate.instrument.ticker === name)

    return record === undefined ? [] : [toRow(calendar, record, settledBar(bars.get(name)))]
  })
}

/** The last bar the series carries, which on a market dated by its settled UTC day is that day's
 *  close. Absent where the bar read failed, and the row then prints the live reading alone. */
function settledBar(candles: readonly Candle[] | undefined): Candle | undefined {
  return candles === undefined ? undefined : candles.at(-1)
}

/** A live reading, not a quote: this market never stops, so the provider's price is what it trades
 *  at right now and no session has closed on it. The settled bar rides beside it, dated by the
 *  session it closed, so the live move is measured against a close the row actually prints. */
function toRow(
  calendar: TradingCalendar,
  record: MarketCapRecord,
  settled: Candle | undefined
): MarketDataOverviewRow {
  return {
    instrument: record.instrument,
    live: {
      price: record.priceUsd,
      ...(record.changePct === undefined ? {} : { changePct: record.changePct }),
      observedAt: record.fetchedAt,
      observedOn: calendar.dayAt(record.fetchedAt),
      observedTime: formatZonedTime(record.fetchedAt, calendar.timezone),
    },
    ...(settled === undefined
      ? {}
      : {
          quote: {
            instrument: record.instrument,
            price: settled.close,
            observedAt: record.fetchedAt,
          },
          closedOn: settled.at,
        }),
    ...(record.changePct === undefined ? {} : { changePct: record.changePct }),
    turnover: record.totalVolumeUsd,
  }
}

/** Absent rather than zero on an empty universe: a total of nothing would read as a market that is
 *  worth nothing rather than one we failed to read. */
function totalMarketCap(records: readonly MarketCapRecord[]): number | undefined {
  return records.length === 0
    ? undefined
    : records.reduce((sum, record) => sum + record.marketCapUsd, 0)
}

function optionalTurnover(records: readonly MarketCapRecord[]): { turnover?: number } {
  return records.length === 0
    ? {}
    : { turnover: records.reduce((sum, record) => sum + record.totalVolumeUsd, 0) }
}

/** Where the session's money went. No flow lists: this market has no desk classification, so the
 *  only ranking its data supports is by traded value. Stablecoins are dropped here and nowhere else
 *  — they are the settlement leg of every other trade, so they top any volume ranking while saying
 *  nothing about where money went, but they are genuinely part of the market's size and so stay in
 *  the totals above. */
function optionalLeaders(records: readonly MarketCapRecord[]): { leaders?: MarketLeaders } {
  const mostTraded = records
    .filter(isEligibleUniverseRow)
    .sort((left, right) => right.totalVolumeUsd - left.totalVolumeUsd)
    .slice(0, CRYPTO_OVERVIEW_LEADERS)
    .map((record) => ({ instrument: record.instrument, value: record.totalVolumeUsd }))

  // The board's volume is every provider's rolling 24-hour figure, never a session's: coinlore
  // publishes `volume24`, CoinMarketCap and CoinPaprika `volume_24h`, CoinGecko `total_volume`.
  return mostTraded.length === 0 ? {} : { leaders: { window: 'rolling-24h', mostTraded } }
}

function optionalMovers(records: readonly MarketCapRecord[]): { movers?: MarketMovers } {
  const movers = cryptoMovers(records)

  return movers === undefined ? {} : { movers }
}

/** Read off the ranking rather than a named coin: dominance is a fact about whichever asset is
 *  largest, and hardcoding one would keep reporting it as such after it stopped being so. */
function optionalLargestShare(
  records: readonly MarketCapRecord[],
  marketCap: number | undefined
): { largestSharePct?: number } {
  const largest = records.reduce<MarketCapRecord | undefined>(
    (best, record) =>
      best === undefined || record.marketCapUsd > best.marketCapUsd ? record : best,
    undefined
  )

  if (largest === undefined || marketCap === undefined || marketCap <= 0) {
    return {}
  }

  return { largestSharePct: (largest.marketCapUsd / marketCap) * PERCENT_PER_UNIT }
}
