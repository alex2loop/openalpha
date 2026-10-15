import type { CalendarPolicy } from '@/trading/kernel/config'
import type { FactorPolicy, GoldFactorId, LevelPolicy } from '@/trading/kernel/factor'
import type {
  BoardLotPolicy,
  InstrumentRef,
  Ticker,
  TickSizePolicy,
} from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { ReferenceRange } from '@/trading/markets/evidence'
import { GOLD_FACTOR_IDS } from '@/trading/kernel/factor'
import { marketRef, region, ticker } from '@/trading/kernel/instrument'
import {
  DEFAULT_HIGH_CONVICTION_AT,
  DEFAULT_MEDIUM_CONVICTION_AT,
  DEFAULT_MINIMUM_AGREEMENT,
  DEFAULT_MINIMUM_COVERAGE_FRACTION,
  equalWeights,
  RANK_HIGHER_IS_BULLISH,
  RANK_LOWER_IS_BULLISH,
} from '@/trading/markets/factor-scoring'

/** Bump on any change below. Outcome tracking compares it, which is why these are code, not config. */
export const GOLD_STRATEGY_VERSION = '1.0.0'

export const GOLD_MARKET_REF = marketRef('gold')
export const GOLD_REGION = region('global')

const WORLD_GOLD_TICKER: Ticker = ticker('XAUUSD')
export const SILVER_TICKER: Ticker = ticker('XAGUSD')

/** The one identity for world gold. `detect` collapses every accepted alias onto it, so the ref
 *  that reaches a provider, the store, and a ledger key is the same for `GOLD`, `XAU`, `XAUUSD`. */
export const WORLD_GOLD_REF: InstrumentRef = {
  market: GOLD_MARKET_REF,
  ticker: WORLD_GOLD_TICKER,
}

/** COMEX runs around the clock on a weekday and its day is UTC, so the session has no open or
 *  close worth naming - but it prints no Saturday or Sunday bar. The weekend has to be declared or
 *  every window here counts calendar days: 250 of those hold 173 bars, which turns a year's range
 *  into eight months and leaves the 250-session ratio with no start bar to read. */
export const WORLD_GOLD_CALENDAR: CalendarPolicy = Object.freeze({
  timezone: 'UTC',
  sessionOpenLocalTime: '00:00',
  sessionCloseLocalTime: '23:59',
  weekendDays: Object.freeze([0, 6]),
  continuous: true,
})

export const TREND_LOOKBACK_SESSIONS = 50
export const RATIO_LOOKBACK_SESSIONS = 250
/** Sessions asked for beyond the ones actually read. A weekend-only calendar cannot subtract the
 *  ~10 exchange holidays a year holds, so a window sized to the exact count comes back that many
 *  bars short — and a lookback that reads its first bar by index then never fires at all. */
const HOLIDAY_HEADROOM_SESSIONS = 12
/** One bar beyond the longest lookback, so a full-window ratio change is computable, plus the
 *  headroom that keeps the window holding that many bars in a year with holidays in it. */
export const EVIDENCE_SESSIONS = RATIO_LOOKBACK_SESSIONS + 1 + HOLIDAY_HEADROOM_SESSIONS

/** A year of daily closes: the window the overview places today's price within. */
export const RANGE_SESSIONS = 250

/** Turnover and volatility windows for gold statistics, measured from its own bars. */
export const GOLD_LIQUIDITY_SESSIONS = 20
export const GOLD_VOLATILITY_SESSIONS = 20

export const WORLD_TICK: TickSizePolicy = Object.freeze({
  bands: Object.freeze([Object.freeze({ tickSize: 0.01 })]),
})

/** A thousandth of an ounce: a whole-ounce lot would move every position in four-thousand-dollar
 *  steps and round most of them to nothing. */
export const GOLD_BOARD_LOT: BoardLotPolicy = Object.freeze({ size: 0.001 })

/** COMEX trades through the operator's night, so a stored plan is read against a price that has
 *  moved since it was written. Parity is where its levels stop paying for their own risk. */
export const GOLD_MINIMUM_RISK_REWARD = 1

/** Measured on COMEX daily bars 2011-2026, entries above their 50-session average, scored as the
 *  outcome scorer scores a call: banking a third at one risk unit and trailing the rest returned
 *  -0.04R and 0.47R a long trade in 2011-18 and 2019-26, against -0.14R and 0.44R for the whole
 *  position at 1.5R; a far target without the trail won the bull years and lost most in the bear
 *  ones. The short arm banks at its target and trails the rest. */
export const GOLD_LEVEL_POLICY: LevelPolicy = Object.freeze({
  atrSessions: 14,
  stopVolatilityMultiplier: { short: 1.5, long: 2 },
  targetRiskMultiplier: { short: 1.5, long: 3 },
  takeProfitRiskMultiplier: { short: 1.5, long: 1 },
  trail: Object.freeze({ sessions: 22, volatilityMultiplier: 3, minimumStopMultiplier: 1 }),
})

// Weights are equal because this project ships no backtest that would justify anything else, and a
// fabricated weighting would make the composite look better-founded than it is. The three inverted
// factors — real rate, USD, gold/silver ratio — carry their sign in `lower-is-bullish` rather than
// by negating the raw input at the call site, so one place answers "is a rising DXY bullish?".
export const FACTOR_POLICY: FactorPolicy<GoldFactorId> = Object.freeze({
  weights: equalWeights(GOLD_FACTOR_IDS),
  normalization: Object.freeze({
    'real-rate': RANK_LOWER_IS_BULLISH,
    usd: RANK_LOWER_IS_BULLISH,
    'gold-silver-ratio': RANK_LOWER_IS_BULLISH,
    trend: Object.freeze({ kind: 'linear', bearishAt: -0.1, bullishAt: 0.1 } as const),
    'official-demand': RANK_HIGHER_IS_BULLISH,
    inflation: RANK_HIGHER_IS_BULLISH,
    // The VIX level, read as the stress a haven bid answers. Neutral at its median since 1990,
    // 17.8; the bullish end is the stress reading the US regime bands it at, and the bearish end
    // sits near its calmest decile. Deliberately not the regime composite: that folds in real rates
    // and the dollar, which score gold the other way above, and a risk-off read already shrinks
    // this sleeve.
    'safe-haven': Object.freeze({
      kind: 'linear',
      bearishAt: 12,
      neutralAt: 18,
      bullishAt: 30,
    } as const),
  }),
  minimumCoverageFraction: DEFAULT_MINIMUM_COVERAGE_FRACTION,
  minimumAgreement: DEFAULT_MINIMUM_AGREEMENT,
  // Not measured, and not measurable: this market has no screen, so its composite is only ever read
  // one instrument at a time and there is no cross-section to fit a spread to. The band is a coarse
  // read of |score| here, and the score is what a suggestion argues from.
  mediumConvictionAt: DEFAULT_MEDIUM_CONVICTION_AT,
  highConvictionAt: DEFAULT_HIGH_CONVICTION_AT,
})

/** A rank factor consumes a percentile, and gold has no cross-section to rank against — one metal
 *  is its own population. These declared ranges are what turn a level into a position in [0, 1]:
 *  the strategy states the span it considers meaningful, and a value outside it clamps rather than
 *  extrapolating. They are strategy parameters under `GOLD_STRATEGY_VERSION`, never config. */
export const MACRO_REFERENCE_RANGES: Readonly<Partial<Record<MacroSeriesId, ReferenceRange>>> =
  Object.freeze({
    // The 10-year TIPS yield over 2015-2026: -1.19 to 2.52 across 2,160 sessions. The old top of 3
    // was never reached, spending a sixth of the scale on a level that has not occurred, while the
    // old floor of -1 clamped 4% of sessions at the one end gold's thesis actually turns on.
    'us-real-rate': Object.freeze({ low: -1.2, high: 2.6 }),
    // Banded against DTWEXBGS (Jan-2006=100), not DXY — see fred.ts `US_DOLLAR_INDEX_SERIES`.
    // Deliberately the post-2022 regime rather than the full series: the dollar sat at 85-100
    // through 2014, and spanning that would leave every current reading inside the bottom third.
    // Over 2022-2026 this clamps nothing — 114.2 to 130.0 observed.
    'usd-index': Object.freeze({ low: 110, high: 130 }),
    // CPI year-over-year, 2007-2025: -2.10 to 9.06 over 227 prints. [0, 6] clamped 13.7% of them —
    // every deflationary month and the whole 2021-22 spike, which are the two states a gold
    // inflation factor exists to tell apart.
    'us-inflation-yoy': Object.freeze({ low: -2, high: 9 }),
  })

/** Change in the gold/silver ratio over `RATIO_LOOKBACK_SESSIONS`; a ±20% move spans the whole
 *  scale. */
export const RATIO_CHANGE_RANGE: ReferenceRange = Object.freeze({ low: -0.2, high: 0.2 })
