import type { Caveat } from '@/trading/kernel/caveat'
import type { CryptoFactorId } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FundingSnapshot, MarketCapRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { EvidenceSeries } from '@/trading/markets/evidence'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import type { TradingCalendar } from '@/trading/markets/types'
import { cryptoBars } from '@/trading/markets/crypto/bars'
import { cryptoFunding } from '@/trading/markets/crypto/funding'
import {
  BREAKOUT_PROXIMITY_FRACTION,
  BTC_TICKER,
  CROWDED_FUNDING_DAILY_PCT,
  CRYPTO_BREAKOUT_SESSIONS,
  CRYPTO_EVIDENCE_SESSIONS,
  CRYPTO_INVALIDATION_SESSIONS,
  CRYPTO_MARKET_REF,
  CRYPTO_RELATIVE_VOLUME_SESSIONS,
  CRYPTO_TREND_SESSIONS,
  CRYPTO_VOLATILITY_SESSIONS,
  FUNDING_DAILY_RANGE,
  LONG_SHORT_RANGE,
  OI_CONFIRMATION_CAP,
  TURNOVER_RATIO_RANGE,
  VOLATILITY_RANGE,
} from '@/trading/markets/crypto/policy'
import { optionalRaw, percentileWithin, toSeries } from '@/trading/markets/evidence'
import {
  realizedVolatility,
  relativeVolume,
  trailingHigh,
  trailingLow,
  trendDistance,
  yearHighProximity,
} from '@/trading/markets/timeseries'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

const BTC_INSTRUMENT: InstrumentRef = { market: CRYPTO_MARKET_REF, ticker: BTC_TICKER }

export interface CryptoWindow {
  readonly asOf: TradingDay
  /** First day of the evidence window; derived from the calendar, the only thing that knows how
   *  many calendar days `CRYPTO_EVIDENCE_SESSIONS` sessions span. */
  readonly fromDay: TradingDay
  readonly now: number
  readonly calendar: TradingCalendar
  readonly signal: AbortSignal
}

/** Bitcoin's series, read once per screen to date the board it ranks. */
export interface CryptoMarketContext {
  readonly btc: EvidenceSeries<readonly Candle[]>
}

export interface CryptoAssetEvidence {
  readonly instrument: InstrumentRef
  readonly candles: readonly Candle[]
  readonly bars: EvidenceSeries<readonly Candle[]>
  readonly funding: EvidenceSeries<FundingSnapshot>
  readonly marketCap: EvidenceSeries<readonly MarketCapRecord[]>
}

export function loadCryptoContext(
  deps: MarketDeps,
  window: CryptoWindow
): Promise<CryptoMarketContext> {
  return loadAssetBars(deps, BTC_INSTRUMENT, window).then((btc) => ({ btc }))
}

interface AssetEvidenceRequest {
  readonly instrument: InstrumentRef
  readonly window: CryptoWindow
  /** The screen gates on bars alone and fetches them a stage earlier, so a survivor reuses that
   *  series rather than paying for it twice. Absent means fetch it here, alongside the rest. */
  readonly bars?: EvidenceSeries<readonly Candle[]>
  /** The screen's universe sweep already returned this asset's row, and the two factors that read
   *  it want cap and volume — refetching one coin at a time asks the same endpoint for a slice of
   *  a payload already in hand. Absent means fetch it here. */
  readonly marketCap?: EvidenceSeries<readonly MarketCapRecord[]>
}

export async function loadAssetBars(
  deps: MarketDeps,
  instrument: InstrumentRef,
  window: CryptoWindow
): Promise<EvidenceSeries<readonly Candle[]>> {
  const bars = await cryptoBars(
    deps,
    {
      instrument,
      asOf: window.asOf,
      now: window.now,
      sessions: CRYPTO_EVIDENCE_SESSIONS,
      signal: window.signal,
    },
    window.calendar
  )

  return toSeries(bars)
}

/** Bars, funding, and this asset's market-cap row. Source caveats pass through unchanged; nothing
 *  here rewrites or drops one. */
export async function loadAssetEvidence(
  deps: MarketDeps,
  request: AssetEvidenceRequest
): Promise<CryptoAssetEvidence> {
  const { instrument, window } = request
  const [bars, funding, marketCap] = await Promise.all([
    request.bars ?? loadAssetBars(deps, instrument, window),
    cryptoFunding(
      deps,
      { instrument, asOf: window.asOf, now: window.now, signal: window.signal },
      window.calendar
    ),
    request.marketCap ?? loadAssetMarketCap(deps, instrument, window),
  ])

  return {
    instrument,
    candles: bars.value ?? [],
    bars,
    funding: toSeries(funding),
    marketCap,
  }
}

async function loadAssetMarketCap(
  deps: MarketDeps,
  instrument: InstrumentRef,
  window: CryptoWindow
): Promise<EvidenceSeries<readonly MarketCapRecord[]>> {
  const marketCap = await deps.sources.resolve({
    kind: 'marketCap',
    context: { market: CRYPTO_MARKET_REF, instrument },
    signal: window.signal,
  })

  return toSeries(marketCap)
}

/** The five crypto inputs, split by what each reads: the asset's candle series, then the feeds
 *  that are not bars at all. A factor whose input is unavailable arrives with `raw`
 *  absent, which abstains rather than scoring a neutral zero. `scoreFactors` sorts its rows by
 *  contribution, so the order here is the reading order, not a ranking. */
export function cryptoFactorInputs(
  evidence: CryptoAssetEvidence
): readonly FactorInput<CryptoFactorId>[] {
  return [...barFactorInputs(evidence), ...feedFactorInputs(evidence)]
}

function barFactorInputs(evidence: CryptoAssetEvidence): readonly FactorInput<CryptoFactorId>[] {
  const closes = evidence.candles.map((candle) => candle.close)
  const abstained = isBreakingOut(closes)

  return [
    {
      id: 'trend',
      ...optionalRaw(trendDistance(closes, CRYPTO_TREND_SESSIONS)),
      ...breakoutMetrics(evidence.candles),
      provenance: evidence.bars.provenance,
      caveats: evidence.bars.caveats,
    },
    {
      id: 'volatility',
      ...optionalRaw(abstained ? undefined : volatilityPercentile(closes)),
      // An abstention is a decision, not a gap: without this the row also reports its input as
      // missing, which prints a warning over the note that already explains the silence.
      ...(abstained ? { inapplicable: true } : {}),
      provenance: evidence.bars.provenance,
      caveats: [
        ...evidence.bars.caveats,
        ...breakoutAbstentionCaveats(abstained, evidence.instrument),
      ],
    },
  ]
}

/** The three that no candle series answers: the perpetual book twice over, and the universe row
 *  this asset turns over against. */
function feedFactorInputs(evidence: CryptoAssetEvidence): readonly FactorInput<CryptoFactorId>[] {
  return [
    {
      id: 'funding',
      ...optionalRaw(fundingPercentile(evidence.funding.value)),
      ...fundingMetrics(evidence.funding.value),
      provenance: evidence.funding.provenance,
      caveats: [...evidence.funding.caveats, ...crowdedFundingCaveats(evidence.funding.value)],
    },
    {
      id: 'long-short',
      ...optionalRaw(longShortPercentile(evidence.funding.value)),
      provenance: evidence.funding.provenance,
      caveats: [],
    },
    {
      id: 'turnover-velocity',
      ...optionalRaw(turnoverPercentile(evidence)),
      provenance: evidence.marketCap.provenance,
      caveats: evidence.marketCap.caveats,
    },
  ]
}

/** The three numbers a breakout is written in: the level to clear, the level that voids it, and
 *  whether the session that cleared it was bought. Each is absent on its own when its window is
 *  short, so a young listing publishes what it can rather than nothing. */
function breakoutMetrics(candles: readonly Candle[]): {
  readonly metrics?: readonly FactorMetric[]
} {
  // Both levels are measured on the sessions *before* the latest close, so one close can stand above
  // the trigger and below the invalidation rather than defining them both. Not `year-high`: every
  // other producer of that id includes the latest close, so a fresh breakout would print a trailing
  // high its own close stands above.
  const prior = candles.slice(0, -1).map((candle) => candle.close)

  return factorMetrics([
    ...priceMetrics(
      'breakout-trigger',
      trailingHigh(prior, CRYPTO_BREAKOUT_SESSIONS),
      CRYPTO_BREAKOUT_SESSIONS
    ),
    ...priceMetrics(
      'trailing-low',
      trailingLow(prior, CRYPTO_INVALIDATION_SESSIONS),
      CRYPTO_INVALIDATION_SESSIONS
    ),
    ...volumeMetrics(
      candles.map((candle) => candle.volume),
      CRYPTO_RELATIVE_VOLUME_SESSIONS
    ),
  ])
}

/** The latest session's volume against the sessions before it: whether the bar that cleared the
 *  level was bought. Shaped like `priceMetrics` so both compose into one list. */
function volumeMetrics(volumes: readonly number[], sessions: number): readonly FactorMetric[] {
  const value = relativeVolume(volumes, sessions)

  return value === undefined ? [] : [{ id: 'relative-volume', value, sessions }]
}

/** A price-shaped reading, dropped rather than scored as zero when the window had none. Returns a
 *  list so several compose into one factor's metrics without an undefined to filter at each site. */
function priceMetrics(
  id: FactorMetricId,
  value: number | undefined,
  sessions: number
): readonly FactorMetric[] {
  return value === undefined || value <= 0 ? [] : [{ id, value, sessions }]
}

/** `metrics` is optional on `FactorInput`, so an empty list must omit the key rather than carry one:
 *  the two differ under `exactOptionalPropertyTypes`, and a renderer would print an empty row. */
function factorMetrics(metrics: readonly FactorMetric[]): {
  readonly metrics?: readonly FactorMetric[]
} {
  return metrics.length === 0 ? {} : { metrics }
}

/** At the tail, funding stops reading as a lean and starts describing a position that has to
 *  unwind: the side paying it is crowded, and the first move against it liquidates that side. The
 *  factor already scores the rate continuously; this only says the tail was reached. */
/** The rate itself travels with the score so a later stage can read which side is paying without
 *  a second fetch, the way VN's levels read `year-high`. */
function fundingMetrics(snapshot: FundingSnapshot | undefined): {
  readonly metrics?: readonly FactorMetric[]
} {
  return snapshot === undefined
    ? {}
    : {
        metrics: [
          {
            id: 'funding-daily',
            value: snapshot.fundingDailyPct,
            sessions: Math.round(snapshot.windowDays),
          },
        ],
      }
}

function crowdedFundingCaveats(snapshot: FundingSnapshot | undefined): readonly Caveat[] {
  if (snapshot === undefined || Math.abs(snapshot.fundingDailyPct) < CROWDED_FUNDING_DAILY_PCT) {
    return []
  }

  return [
    {
      code: 'market-data.funding-crowded',
      detail: { rate: snapshot.fundingDailyPct / PERCENT_PER_UNIT, days: snapshot.windowDays },
    },
  ]
}

/** Funding scaled by open interest standing above its window mean: OI confirms crowding but cannot
 *  create a signal funding does not show, so it multiplies the rate rather than scoring as its own
 *  leg. */
function fundingPercentile(snapshot: FundingSnapshot | undefined): number | undefined {
  if (snapshot === undefined) {
    return undefined
  }

  const confirmation = Math.min(snapshot.openInterestRatio?.value ?? 1, OI_CONFIRMATION_CAP)
  return percentileWithin(snapshot.fundingDailyPct * confirmation, FUNDING_DAILY_RANGE)
}

/** The account ratio on the [0, 1] scale rank normalization expects; a ratio is not a percentile. */
function longShortPercentile(snapshot: FundingSnapshot | undefined): number | undefined {
  const ratio = snapshot?.longShortRatio

  return ratio === undefined ? undefined : percentileWithin(ratio, LONG_SHORT_RANGE)
}

/** Both terms come off the same universe row, so a venue-scoped numerator can never be divided by a
 *  market-wide denominator. Bars carry one exchange's volume and would be a few percent of it. */
function turnoverPercentile(evidence: CryptoAssetEvidence): number | undefined {
  const [record] = evidence.marketCap.value ?? []

  return record === undefined || record.marketCapUsd <= 0 || record.totalVolumeUsd <= 0
    ? undefined
    : percentileWithin(record.totalVolumeUsd / record.marketCapUsd, TURNOVER_RATIO_RANGE)
}

function volatilityPercentile(closes: readonly number[]): number | undefined {
  const volatility = realizedVolatility(closes, CRYPTO_VOLATILITY_SESSIONS)

  return volatility === undefined ? undefined : percentileWithin(volatility, VOLATILITY_RANGE)
}

/** Whether the last close sits inside the breakout band under the 20-session high. A name there has
 *  expanding range by construction, and ranking it down for that cancels the very move the rest of
 *  the board is scoring. The screen's hard ceiling still applies; this only silences the factor. */
function isBreakingOut(closes: readonly number[]): boolean {
  const proximity = yearHighProximity(closes, CRYPTO_BREAKOUT_SESSIONS)

  return proximity !== undefined && proximity >= 1 - BREAKOUT_PROXIMITY_FRACTION
}

function breakoutAbstentionCaveats(
  abstained: boolean,
  instrument: InstrumentRef
): readonly Caveat[] {
  if (!abstained) {
    return []
  }

  return [
    {
      code: 'market-data.volatility-abstained-at-high',
      detail: {
        ticker: instrument.ticker,
        proximity: BREAKOUT_PROXIMITY_FRACTION,
        sessions: CRYPTO_BREAKOUT_SESSIONS,
      },
    },
  ]
}
